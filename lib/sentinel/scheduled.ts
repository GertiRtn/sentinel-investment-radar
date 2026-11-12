import { env } from 'cloudflare:workers';
import { database, iso } from '@/db/store';
import { checkWatchlistNews, refreshWatchlistFilings } from './pipeline';
import { collectDiscovery } from './discovery-collector';
import { assessDiscoveryBatch } from './discovery-case';
import { observeOneOutcome } from './outcome-collector';

/**
 * Cron Trigger work for the own-Cloudflare host. Replaces the ChatGPT
 * scheduled task that called the MCP tool once an hour.
 *
 * The old hourly call ran every stage in one request, which is the likely
 * cause of partial scans. Here each schedule runs its own stages in its own
 * invocation, so a slow stage cannot starve the others:
 *
 *   DISCOVERY  every 15 min: market news discovery, then one assessment batch
 *   WATCHLIST  hourly at :07: saved-company filings, then saved-company news
 *   OUTCOMES   hourly at :37: forward outcome observations, bounded batch
 *
 * Every run appends one `scheduled_run` record (append-only, like everything
 * else) so throughput and failures can be measured rather than assumed.
 * Keep these strings identical to `triggers.crons` in deploy/cloudflare/wrangler.jsonc.
 */
export const SCHEDULES = {
  DISCOVERY: '*/15 * * * *',
  WATCHLIST: '7 * * * *',
  OUTCOMES: '37 * * * *',
} as const;

const OUTCOME_LIMIT = 10;
const OUTCOME_BUDGET_MS = 25_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type StageResult = { name: string; status: string; ms: number; summary: Record<string, unknown> };
type Env = { SENTINEL_HOST?: string; SENTINEL_OWNER_ID?: string; SENTINEL_OWNER_EMAIL?: string; SEC_CONTACT_EMAIL?: string };

async function stage(name: string, run: () => Promise<Record<string, unknown>>): Promise<StageResult> {
  const started = Date.now();
  try {
    const summary = await run();
    return { name, status: String(summary.status ?? 'complete'), ms: Date.now() - started, summary };
  } catch (e) {
    return { name, status: 'failed', ms: Date.now() - started, summary: { message: e instanceof Error ? e.message : 'Stage failed' } };
  }
}

const count = (items: any[], key: string) =>
  items.reduce((acc: Record<string, number>, x: any) => { const k = String(x?.[key] ?? 'unknown'); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});

async function discoveryStages(owner: string, email: string) {
  return [
    await stage('discovery', async () => {
      const r: any = await collectDiscovery(owner);
      return { status: r.status, window: r.window, pages: r.pages, newCount: r.newCount };
    }),
    await stage('assessment', async () => {
      const r: any = await assessDiscoveryBatch(owner, email);
      const cases = r.items.map((x: any) => x.case).filter(Boolean);
      return { status: r.status, attempted: r.items.length, statuses: count(r.items, 'status'), conclusions: count(cases, 'conclusion') };
    }),
  ];
}

async function watchlistStages(owner: string, email: string) {
  return [
    await stage('filings', async () => {
      const r: any[] = await refreshWatchlistFilings(owner, email);
      return { status: r.some(x => x.status === 'failed') ? 'partial' : 'complete', checked: r.length, statuses: count(r, 'status') };
    }),
    await stage('watchlist-news', async () => {
      const r: any = await checkWatchlistNews(owner);
      const newCases = r.results.reduce((n: number, x: any) => n + (x.items?.length ?? 0), 0);
      return { status: r.results.some((x: any) => x.status === 'failed') ? 'partial' : 'complete', checked: r.checked, newCases, statuses: count(r.results, 'status') };
    }),
  ];
}

async function outcomeStages(owner: string) {
  return [
    await stage('outcomes', async () => {
      const started = Date.now(), statuses: Record<string, number> = {};
      let attempts = 0;
      while (attempts < OUTCOME_LIMIT && Date.now() - started < OUTCOME_BUDGET_MS) {
        const r: any = await observeOneOutcome(owner);
        if (r.status === 'idle') break;
        attempts++;
        statuses[r.status] = (statuses[r.status] ?? 0) + 1;
      }
      return { status: attempts ? 'complete' : 'idle', attempts, statuses, limit: OUTCOME_LIMIT };
    }),
  ];
}

/** Runs the stages for one Cron Trigger. Returns the record it appended (or why it did nothing). */
export async function runScheduled(cron: string) {
  const e = env as unknown as Env;
  if (e.SENTINEL_HOST !== 'cloudflare') return { status: 'skipped', reason: 'Cron work only runs on the own-Cloudflare host.' };

  const startedAt = iso();
  const owner = e.SENTINEL_OWNER_ID?.trim();
  const email = (e.SEC_CONTACT_EMAIL || e.SENTINEL_OWNER_EMAIL || '').trim();
  let stages: StageResult[];

  if (!owner) {
    console.error('Sentinel cron: SENTINEL_OWNER_ID is not set; nothing was run.');
    return { status: 'misconfigured', reason: 'SENTINEL_OWNER_ID is not set.' };
  } else if (!EMAIL.test(email)) {
    stages = [{ name: 'configuration', status: 'failed', ms: 0, summary: { message: 'A valid SEC contact email (SEC_CONTACT_EMAIL or SENTINEL_OWNER_EMAIL) is required. Nothing was checked.' } }];
  } else if (cron === SCHEDULES.DISCOVERY) {
    stages = await discoveryStages(owner, email);
  } else if (cron === SCHEDULES.WATCHLIST) {
    stages = await watchlistStages(owner, email);
  } else if (cron === SCHEDULES.OUTCOMES) {
    stages = await outcomeStages(owner);
  } else {
    stages = [{ name: 'routing', status: 'failed', ms: 0, summary: { message: `No stages are assigned to cron "${cron}". Check deploy/cloudflare/wrangler.jsonc against SCHEDULES.` } }];
  }

  const record = {
    version: 'scheduled-run-v1',
    cron,
    startedAt,
    finishedAt: iso(),
    status: stages.every(s => s.status !== 'failed') ? 'complete' : stages.some(s => s.status !== 'failed') ? 'partial' : 'failed',
    stages,
  };
  try {
    await database()
      .prepare("INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'scheduled_run',NULL,?)")
      .bind(crypto.randomUUID(), owner, record.finishedAt, JSON.stringify(record))
      .run();
  } catch (err) {
    console.error('Sentinel cron: could not record the run', err instanceof Error ? err.message : err);
  }
  return record;
}
