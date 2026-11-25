/**
 * Discovery funnel counts (`discovery-funnel-v1`, 2026-11-16). Pure and read-only: it counts stored records and
 * changes nothing about collection, the queue or assessment. Definitions follow `discoveryQueue()`:
 * the unit is a (report, symbol) pair, eligibility is `priority = 'topic match'`, the queue window is 96 hours and
 * a failed attempt cools down for 6 hours.
 */
export const FUNNEL_VERSION = 'discovery-funnel-v1';
export const FUNNEL_WINDOWS = [24, 96, 168] as const;
export const COOLDOWN_HOURS = 6;
const HOUR = 3_600_000;

export type FunnelCandidate = { id: string; createdAt: string; priority: string; symbols: string[] };
export type FunnelCase = { candidateId: string; symbol: string; conclusion: string; direction: string; matchLevel: string };
export type FunnelAttempt = { candidateId: string; symbol: string; createdAt: string };

export function funnelCounts(input: { now: string; windowHours: number; queueWindowHours: number; capacityPerRun: number; candidates: FunnelCandidate[]; cases: FunnelCase[]; attempts: FunnelAttempt[] }) {
  const now = Date.parse(input.now), since = now - input.windowHours * HOUR, key = (c: string, s: string) => c + '|' + s;
  const cases = new Map(input.cases.map(c => [key(c.candidateId, c.symbol), c]));
  const cooling = new Set(input.attempts.filter(a => Date.parse(a.createdAt) > now - COOLDOWN_HOURS * HOUR).map(a => key(a.candidateId, a.symbol)));
  const inWindow = input.candidates.filter(c => { const t = Date.parse(c.createdAt); return t > since && t <= now; });
  const n = { reports: inWindow.length, eligibleReports: 0, notEligibleReports: 0, pairs: 0, eligible: 0, notEligible: 0, assessed: 0, pending: 0, coolingDown: 0, agedOut: 0 };
  const byConclusion = { meetsRules: 0, watch: 0, notEnoughData: 0 }, byDirection: Record<string, number> = { positive: 0, neutral: 0, mixed: 0, negative: 0, not_company_news: 0 };
  const rejected = { notEligible: 0, wrongCompany: 0, badOrMixedNews: 0 };
  for (const c of inWindow) {
    const eligible = c.priority === 'topic match', symbols = [...new Set(c.symbols)];
    if (eligible) n.eligibleReports++; else n.notEligibleReports++;
    n.pairs += symbols.length;
    if (!eligible) { n.notEligible += symbols.length; rejected.notEligible += symbols.length; continue; }
    n.eligible += symbols.length;
    for (const s of symbols) {
      const k = cases.get(key(c.id, s));
      if (k) {
        n.assessed++;
        if (k.conclusion === 'INVESTIGATE') byConclusion.meetsRules++; else if (k.conclusion === 'MONITOR') byConclusion.watch++; else byConclusion.notEnoughData++;
        byDirection[k.direction] = (byDirection[k.direction] ?? 0) + 1;
        if (k.matchLevel === 'name_conflict') rejected.wrongCompany++;
        if (k.direction === 'negative' || k.direction === 'mixed') rejected.badOrMixedNews++;
      } else if (now - Date.parse(c.createdAt) > input.queueWindowHours * HOUR) n.agedOut++;
      else if (cooling.has(key(c.id, s))) n.coolingDown++;
      else n.pending++;
    }
  }
  const checks = [
    { name: 'Found = eligible + not eligible (reports)', left: n.reports, right: n.eligibleReports + n.notEligibleReports },
    { name: 'Found = eligible + not eligible (report × symbol)', left: n.pairs, right: n.eligible + n.notEligible },
    { name: 'Eligible = assessed + pending + cooling down + aged out', left: n.eligible, right: n.assessed + n.pending + n.coolingDown + n.agedOut },
    { name: 'Assessed = meets rules + watch + not enough data', left: n.assessed, right: byConclusion.meetsRules + byConclusion.watch + byConclusion.notEnoughData },
    { name: 'Assessed = good + neutral + mixed + bad news + not company news', left: n.assessed, right: byDirection.positive + byDirection.neutral + byDirection.mixed + byDirection.negative + byDirection.not_company_news },
  ].map(c => ({ ...c, ok: c.left === c.right, difference: c.left - c.right }));
  return {
    version: FUNNEL_VERSION, asOf: input.now, windowHours: input.windowHours, queueWindowHours: input.queueWindowHours,
    found: { reports: n.reports, pairs: n.pairs, definition: 'Distinct stored reports first observed in the window, and the (report, symbol) pairs they carry.' },
    deduplicated: { count: null, text: 'Not recorded: a report already stored is skipped at collection and no counter is kept.' },
    eligible: { reports: n.eligibleReports, pairs: n.eligible, definition: 'Reports whose headline matched a research topic ("topic match"). Only these enter the assessment queue.' },
    notEligible: { reports: n.notEligibleReports, pairs: n.notEligible, definition: 'Reports with no topic match ("unclassified"). Stored and shown, never assessed.' },
    assessed: { pairs: n.assessed, byConclusion, byNewsDirection: { good: byDirection.positive, neutral: byDirection.neutral, mixed: byDirection.mixed, bad: byDirection.negative, notCompanyNews: byDirection.not_company_news }, definition: 'Eligible pairs with a research case, by the stored screen conclusion and by news direction. "Not enough data" includes every conclusion other than meets rules or watch.' },
    pending: { pairs: n.pending, definition: `Eligible, no case, not cooling down, first observed within the last ${input.queueWindowHours} hours.` },
    coolingDown: { pairs: n.coolingDown, definition: `Eligible, no case, a failed attempt in the last ${COOLDOWN_HOURS} hours; retried later.` },
    agedOut: { pairs: n.agedOut, definition: `Eligible, no case, first observed more than ${input.queueWindowHours} hours ago: no longer in the queue.` },
    rejected: { ...rejected, definition: 'Three separate counts, never added together: not eligible (no topic match); assessed but probably a different company (name conflict); assessed but bad or mixed news (recorded and measured, never shown as an idea).' },
    capacity: { perRun: input.capacityPerRun, text: `Assessment capacity: up to ${input.capacityPerRun} pairs per run, within a time budget.` },
    reconciliation: { ok: checks.every(c => c.ok), checks },
    note: 'Counts of stored records. Research routing only; nothing here is a forecast.',
  };
}
