/**
 * Discover ranking (discover-rank-v1): assessed cases, one row per symbol,
 * highest evidence score first. This is research routing (invariant 6): it
 * orders what to read first, it does not forecast returns.
 *
 * Order: scored cases by evidence score (ties: the stronger screen label, then
 * the newer report); then cases with no score, newest first. Several reports
 * on the same symbol are merged into one row and counted.
 */
import { caseEvidenceScore } from './evidence-score';

export const DISCOVER_RANK_VERSION = 'discover-rank-v1';
export const DISCOVER_WINDOW_DAYS = 7;
const LABEL_ORDER: Record<string, number> = { INVESTIGATE: 0, MONITOR: 1, WAIT: 2 };

export function rankCases(cases: any[], now: string, windowDays = DISCOVER_WINDOW_DAYS) {
  const since = new Date(Date.parse(now) - windowDays * 86400000).toISOString();
  const bySymbol = new Map<string, any[]>();
  for (const c of cases) if (c?.symbol && String(c.createdAt) >= since) bySymbol.set(c.symbol, [...(bySymbol.get(c.symbol) ?? []), c]);
  const rows = [...bySymbol.entries()].map(([symbol, list]) => {
    const scored = list.map(c => ({ c, e: caseEvidenceScore(c) }));
    // Representative case: the best-evidenced one; ties go to the newest.
    scored.sort((a, b) => (b.e.score ?? -1) - (a.e.score ?? -1) || String(b.c.createdAt).localeCompare(String(a.c.createdAt)));
    const { c, e } = scored[0];
    const v2 = c?.decision?.version === 'research-screen-v2';
    return {
      caseId: c.id, symbol, company: c?.identity?.name ?? null, headline: c?.event?.headline ?? '', url: c?.event?.url ?? null,
      source: c?.event?.source ?? null, publishedAt: c?.event?.publishedAt ?? null, assessedAt: c.createdAt,
      label: v2 ? c.conclusion : null, screenVersion: c?.decision?.version ?? null,
      score: e.score, band: e.band, coverage: e.coverage,
      whyRanked: whyRanked(e),
      otherReports: list.length - 1,
    };
  });
  rows.sort((a, b) => {
    if ((a.score === null) !== (b.score === null)) return a.score === null ? 1 : -1;
    return (b.score ?? 0) - (a.score ?? 0)
      || (LABEL_ORDER[a.label ?? ''] ?? 3) - (LABEL_ORDER[b.label ?? ''] ?? 3)
      || String(b.publishedAt ?? b.assessedAt).localeCompare(String(a.publishedAt ?? a.assessedAt));
  });
  return { version: DISCOVER_RANK_VERSION, windowDays, rows };
}

export function whyRanked(e: ReturnType<typeof caseEvidenceScore>): string {
  const pass = e.checks.filter(x => x.state === 'pass').map(x => x.label);
  const fail = e.checks.filter(x => x.state === 'fail').map(x => x.label);
  const unk = e.checks.filter(x => x.state === 'unknown').map(x => x.label);
  if (e.score === null) return `Not enough data to score (${e.coverage}/100 points known).` + (unk.length ? ` Unknown: ${unk.join(', ')}.` : '');
  return [pass.length && `Passes ${pass.join(', ')}`, fail.length && `fails ${fail.join(', ')}`, unk.length && `unknown ${unk.join(', ')}`].filter(Boolean).join('; ') + '.';
}
