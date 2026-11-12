import {env} from 'cloudflare:workers';
import {database} from '@/db/store';
import {readShadow,storedReading,SHADOW_MAX_PER_RUN,SHADOW_RUN_BUDGET_MS} from './shadow-reader';

type ShadowEnv = { SHADOW_READER_ENABLED?: string; NVIDIA_API_KEY?: string; SHADOW_MODEL?: string };

/**
 * Shadow-read the discovery cases a batch just created. Evaluation only.
 * Runs after the batch has finished assessing, so it cannot change how many
 * cases are assessed, and never throws into the caller.
 */
export async function shadowReadCases(owner: string, items: any[], fetcher: typeof fetch = fetch) {
  const e = env as unknown as ShadowEnv;
  if (e.SHADOW_READER_ENABLED !== '1') return { status: 'disabled' as const, attempted: 0 };
  const started = Date.now(), statuses: Record<string, number> = {};
  let attempted = 0;
  try {
    const db = database();
    for (const item of items) {
      if (attempted >= SHADOW_MAX_PER_RUN || Date.now() - started >= SHADOW_RUN_BUDGET_MS) break;
      const kase = item?.case;
      if (!item?.created || !item?.caseId || !kase?.identity?.name) continue;
      attempted++;
      try {
        const reading = await readShadow(
          { headline: String(kase.event?.headline ?? ''), summary: kase.event?.providerSummary ?? null, company: String(kase.identity.name), ticker: String(kase.symbol) },
          { enabled: e.SHADOW_READER_ENABLED, key: e.NVIDIA_API_KEY, model: e.SHADOW_MODEL },
          fetcher,
        );
        const row = storedReading(item.caseId, String(kase.symbol), reading);
        await db.prepare("INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'shadow_reading',?,?)")
          .bind(crypto.randomUUID(), owner, row.createdAt, kase.identity.cik ? 'sec:' + kase.identity.cik : null, JSON.stringify(row)).run();
        statuses[reading.status] = (statuses[reading.status] ?? 0) + 1;
      } catch {
        statuses.failed = (statuses.failed ?? 0) + 1;
      }
    }
  } catch {
    return { status: 'failed' as const, attempted, statuses };
  }
  return { status: 'complete' as const, attempted, statuses };
}
