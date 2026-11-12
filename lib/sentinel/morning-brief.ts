/**
 * Morning brief: the executive summary of the last 24 hours.
 *
 * Bottom line first, then the few cases worth a closer look, then what is
 * merely on the radar, then what changed on the watchlist; everything else is
 * behind a fold. Every sentence is assembled from stored records and rule
 * templates. Nothing here is model-written, and no number is estimated
 * (AGENTS.md invariants 5–7). Pure: the API route loads records, this shapes them.
 */

export const BRIEF_VERSION = 'morning-brief-v1';
export const BRIEF_WINDOW_HOURS = 24;
const MAX_TAKES = 3, MAX_RADAR = 6, MAX_WAITING = 25, STALE_RUN_HOURS = 3;

export type BriefCase = any; // a stored discovery_case body plus { id, createdAt }
export type WatchInput = { entityId: string; name: string; ticker: string | null; filings: { form: string; filedAt: string; accession: string }[]; headlines: { headline: string; url: string | null; publishedAt: string | null }[] };
export type BriefInput = {
  now: string;
  cases: BriefCase[];
  watch: WatchInput[];
  lastScan: { at: string; completed: boolean; pages: number | null } | null;
  pendingCount: number | null;
  lastOutcomeAt: string | null;
  outcomeCounts: Record<number, number>;
  shadow: { enabled: boolean; readings: number };
};

const fact = (label: string, value: string, source: string) => ({ label, value, source });
const time = (iso: string | null | undefined) => (iso ? iso.slice(11, 16) + ' UTC' : 'time unknown');

function money(v: number) {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}bn` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}m` : `${s}$${Math.round(a).toLocaleString('en-US')}`;
}

/** One supporting fact, always with its source; null when nothing reliable exists. */
export function keyFact(c: BriefCase) {
  if (c?.price?.status === 'indicative' && Number.isFinite(c.price.ratio)) {
    return fact('P/E', c.price.ratio.toFixed(1), `IEX midpoint ${time(c.price.quoteTime)} ÷ annual diluted EPS (year to ${c.price.periodEnd ?? 'unknown'})`);
  }
  const rev = (c?.brief?.evidence ?? []).find((e: any) => e.label === 'Revenue' && typeof e.value === 'number');
  if (rev) return fact('Revenue', money(rev.value), `SEC filing, period ending ${rev.periodEnd ?? 'unknown'}`);
  return null;
}

/** Plain reason a case with complete data still missed the screen, from its stored rule results. */
export function radarReason(c: BriefCase): string {
  const failed = (c?.rules ?? []).filter((r: any) => !r.passed).map((r: any) => r.id);
  const topics: string[] = c?.event?.analysis?.topics ?? [];
  const parts = failed.map((id: string) =>
    id === 'R1' ? (topics.length ? `${topics.join(', ')} is not a qualifying event` : 'No qualifying event type')
    : id === 'R2' ? "Company's role in the headline is unclear"
    : id === 'R3' ? (Number.isFinite(c?.price?.ratio) ? `P/E ${c.price.ratio.toFixed(1)} is outside 0–30` : 'No eligible P/E')
    : `Rule ${id} not met`);
  return parts.length ? parts.join(' · ') : (c?.reason ?? 'A screening rule was not met.');
}

function takeOf(c: BriefCase) {
  const a = c?.event?.analysis ?? {};
  return {
    caseId: c.id, symbol: c.symbol, company: c?.identity?.name ?? null, label: c.conclusion as string,
    statement: c?.event?.headline ?? '', url: c?.event?.url ?? null, source: c?.event?.source ?? null,
    publishedAt: c?.event?.publishedAt ?? null, assessedAt: c.createdAt,
    whyItMatters: a.whyReview?.[0] ?? null,
    checkFirst: a.questions?.[0] ?? 'Verify the original report and whether it concerns this company.',
    keyFact: keyFact(c),
  };
}

/** Latest case per symbol inside the window; screen-v2 cases only for takes and radar. */
function latestPerSymbol(cases: BriefCase[]) {
  const by = new Map<string, BriefCase>();
  for (const c of cases) { const prev = by.get(c.symbol); if (!prev || String(c.createdAt) > String(prev.createdAt)) by.set(c.symbol, c); }
  return [...by.values()].sort((a, b) => String(b?.event?.publishedAt ?? b.createdAt).localeCompare(String(a?.event?.publishedAt ?? a.createdAt)));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function buildMorningBrief(input: BriefInput) {
  const nowMs = Date.parse(input.now), since = new Date(nowMs - BRIEF_WINDOW_HOURS * 3600000).toISOString();
  const recent = latestPerSymbol(input.cases.filter(c => String(c.createdAt) >= since));
  const v2 = (c: BriefCase) => c?.decision?.version === 'research-screen-v2';
  const investigate = recent.filter(c => v2(c) && c.conclusion === 'INVESTIGATE');
  const monitor = recent.filter(c => v2(c) && c.conclusion === 'MONITOR')
    .sort((a, b) => (a.rules ?? []).filter((r: any) => !r.passed).length - (b.rules ?? []).filter((r: any) => !r.passed).length);
  const waiting = recent.filter(c => !(v2(c) && (c.conclusion === 'INVESTIGATE' || c.conclusion === 'MONITOR')));

  const watchChanges = input.watch.filter(w => w.filings.length || w.headlines.length);
  const scanAgeH = input.lastScan ? (nowMs - Date.parse(input.lastScan.at)) / 3600000 : null;
  const runStale = scanAgeH === null || scanAgeH > STALE_RUN_HOURS;
  const statusLevel: 'ok' | 'attention' | 'problem' = runStale ? 'problem' : input.lastScan && !input.lastScan.completed ? 'attention' : 'ok';

  // ---- the bottom line: conclusion first, then what changed, then anything that needs fixing
  const s: string[] = [];
  if (investigate.length === 1) s.push(`One case is worth a closer look: ${investigate[0].symbol} — ${investigate[0].event?.headline ?? 'see the take below'}.`);
  else if (investigate.length > 1) s.push(`${investigate.length} cases are worth a closer look, led by ${investigate[0].symbol} — ${investigate[0].event?.headline ?? ''}.`);
  else if (recent.length) s.push('No case met all three screening rules in the last 24 hours.');
  else s.push('Sentinel assessed no new cases in the last 24 hours.');
  if (monitor.length) s.push(`${plural(monitor.length, 'more case has', 'more cases have')} complete data but missed a rule.`);
  s.push(watchChanges.length ? `On your watchlist, ${watchChanges.map(w => w.name).join(', ')} ${watchChanges.length === 1 ? 'has' : 'have'} news or filings.` : 'Nothing new on your watchlist.');
  if (runStale) s.push(input.lastScan ? `No market scan has run for ${Math.floor(scanAgeH!)} hours — check the scheduled task.` : 'No market scan has been recorded yet.');
  else if (input.lastScan && !input.lastScan.completed) s.push(`The latest scan was partial${input.pendingCount !== null ? `; ${input.pendingCount} reports are queued` : ''}.`);

  const horizons = [5, 20, 60, 120].map(h => ({ horizon: h, observed: input.outcomeCounts[h] ?? 0 }));

  return {
    version: BRIEF_VERSION, preparedAt: input.now, windowHours: BRIEF_WINDOW_HOURS,
    bottomLine: s.join(' '),
    counts: { investigate: investigate.length, monitor: monitor.length, waiting: waiting.length, assessed: recent.length },
    takes: investigate.slice(0, MAX_TAKES).map(takeOf),
    moreTakes: Math.max(0, investigate.length - MAX_TAKES),
    radar: monitor.slice(0, MAX_RADAR).map(c => ({ ...takeOf(c), reason: radarReason(c) })),
    moreRadar: Math.max(0, monitor.length - MAX_RADAR),
    watchlist: { tracked: input.watch.map(w => w.name), changes: watchChanges },
    waiting: waiting.slice(0, MAX_WAITING).map(c => ({
      caseId: c.id, symbol: c.symbol, company: c?.identity?.name ?? null, statement: c?.event?.headline ?? '',
      label: v2(c) ? c.conclusion : (c?.decision?.version ? `${c.conclusion} (${c.decision.version})` : (c.conclusion ?? 'Unassessed')),
      missing: (c?.readiness?.blockers?.length ? c.readiness.blockers : c?.decision?.blockers?.length ? c.decision.blockers : [c.reason ?? c.status ?? 'Required data is missing.']).join(' '),
    })),
    moreWaiting: Math.max(0, waiting.length - MAX_WAITING),
    status: {
      level: statusLevel,
      lastScanAt: input.lastScan?.at ?? null, scanCompleted: input.lastScan?.completed ?? null,
      pendingCount: input.pendingCount, lastOutcomeAt: input.lastOutcomeAt,
      shadowReader: input.shadow.enabled ? `On · ${plural(input.shadow.readings, 'reading', 'readings')} in 24 h` : 'Off',
    },
    outcomes: { horizons, note: 'Every assessed case is tracked — including WAIT and MONITOR — so the rules can be tested. Counts only; no averages until samples are large enough to mean something.' },
  };
}
