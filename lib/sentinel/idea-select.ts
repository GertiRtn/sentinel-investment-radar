/**
 * Which cases to put in front of the owner first (idea-select-v1, 2026-11-13). Pure.
 *
 * This is research routing (invariant 6): it decides what to read first. It is not a forecast and a
 * selected case is not a recommendation.
 *
 *  - "meets_rules": screen v2 says INVESTIGATE and the headline names the company.
 *  - "closest": not selected by the rules, but the evidence checklist is at least CLOSEST_MIN_SCORE and
 *    nothing says it is the wrong company. Shown so the page is never empty without an explanation, and
 *    always with what it fails or lacks.
 * Left out: probable company mismatches, analyst-opinion-only reports (a view, not a company event),
 * cases from the first screen, and cases with too little evidence to score.
 * One row per company; at most MAX_IDEAS, rule-meeting cases first, then by evidence score, then newest.
 */
export const IDEA_SELECT_VERSION = 'idea-select-v1';
export const IDEA_WINDOW_DAYS = 7, MAX_IDEAS = 5, CLOSEST_MIN_SCORE = 60;
export type LightCase = {
  id: string; symbol: string; createdAt: string; status: string; conclusion: string; screenVersion: string | null; reason: string | null;
  score: number | null; matchLevel: string; topics: string[]; priceStatus: string | null; securityStatus: string | null;
};
export type Tier = 'meets_rules' | 'closest';

const BLOCKERS: [RegExp, string][] = [
  [/price-to-reported-earnings|P\/E/i, 'no usable price or earnings figure for a P/E'],
  [/revenue evidence/i, 'recent revenue figures missing'],
];

export function selectIdeas(cases: LightCase[], now: string) {
  const since = new Date(Date.parse(now) - IDEA_WINDOW_DAYS * 86400000).toISOString();
  const recent = cases.filter(c => c.symbol && c.createdAt >= since && c.createdAt <= now);
  const v2 = recent.filter(c => c.screenVersion === 'research-screen-v2');
  const tierOf = (c: LightCase): Tier | null => {
    if (c.screenVersion !== 'research-screen-v2' || c.status !== 'complete' || c.matchLevel === 'name_conflict') return null;
    if (c.conclusion === 'INVESTIGATE' && c.matchLevel === 'named_in_headline') return 'meets_rules';
    if (c.topics.length > 0 && c.topics.every(t => t === 'Analyst opinion')) return null;
    return c.score !== null && c.score >= CLOSEST_MIN_SCORE ? 'closest' : null;
  };
  const rank = (t: Tier) => (t === 'meets_rules' ? 0 : 1);
  const best = new Map<string, { c: LightCase; tier: Tier }>();
  for (const c of recent) {
    const tier = tierOf(c); if (!tier) continue;
    const cur = best.get(c.symbol);
    if (!cur || rank(tier) < rank(cur.tier) || (rank(tier) === rank(cur.tier) && ((c.score ?? -1) > (cur.c.score ?? -1) || ((c.score ?? -1) === (cur.c.score ?? -1) && c.createdAt > cur.c.createdAt)))) best.set(c.symbol, { c, tier });
  }
  const ordered = [...best.values()].sort((a, b) => rank(a.tier) - rank(b.tier) || (b.c.score ?? -1) - (a.c.score ?? -1) || b.c.createdAt.localeCompare(a.c.createdAt) || a.c.id.localeCompare(b.c.id));
  const picked = ordered.slice(0, MAX_IDEAS).map(x => ({ caseId: x.c.id, symbol: x.c.symbol, tier: x.tier }));

  const count = (f: (c: LightCase) => boolean) => v2.filter(f).length;
  const waits = v2.filter(c => c.conclusion === 'WAIT'), blockers = new Map<string, number>();
  for (const c of waits) {
    const hit = c.securityStatus && c.securityStatus !== 'candidate_common' ? 'security type not confirmed as an ordinary US share'
      : c.status !== 'complete' ? 'ticker could not be matched to one SEC company'
      : BLOCKERS.find(([re]) => re.test(c.reason ?? ''))?.[1] ?? 'other missing inputs';
    blockers.set(hit, (blockers.get(hit) ?? 0) + 1);
  }
  const meets = ordered.filter(x => x.tier === 'meets_rules').length;
  const counts = {
    assessed: recent.length, currentScreen: v2.length, olderScreen: recent.length - v2.length,
    meetsRules: count(c => c.conclusion === 'INVESTIGATE'), watch: count(c => c.conclusion === 'MONITOR'), notEnoughData: waits.length,
    wrongCompany: count(c => c.matchLevel === 'name_conflict'), analystOnly: count(c => c.topics.length > 0 && c.topics.every(t => t === 'Analyst opinion')),
  };
  const topBlockers = [...blockers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, n]) => ({ reason, cases: n }));
  const headline = !recent.length ? `No cases were assessed in the last ${IDEA_WINDOW_DAYS} days.`
    : meets ? `${meets} compan${meets === 1 ? 'y meets' : 'ies meet'} all three research rules. Start there.`
    : picked.length ? `No case met all three research rules in the last ${IDEA_WINDOW_DAYS} days. These ${picked.length === 1 ? 'is the closest' : 'are the closest'}, with what each one lacks.`
    : `No case met the research rules or came close in the last ${IDEA_WINDOW_DAYS} days.`;
  return { version: IDEA_SELECT_VERSION, windowDays: IDEA_WINDOW_DAYS, picked, counts, topBlockers, headline,
    note: 'Order is for reading, not a forecast. Meeting the rules does not mean a share is cheap or will rise.' };
}

/** Compact card for the list, from the full idea card and context. Nothing new is computed here. */
export function ideaBrief(kase: any, context: any, idea: any, score: any, tier: Tier) {
  const changes = [...(context?.business ?? [])].filter((r: any) => r.changePct !== null).slice(0, 3).map((r: any) => ({
    label: r.label, changePct: r.changePct, comparison: r.comparison, periodEnd: r.latest?.period?.end ?? null,
    accession: r.latest?.source?.accession ?? null, url: r.latest?.source?.url ?? null, filed: r.latest?.sourceTime ? String(r.latest.sourceTime).slice(0, 10) : null,
  }));
  const pe = kase?.price?.status === 'indicative' && Number.isFinite(kase.price.ratio) ? { value: kase.price.ratio, label: kase.price.priceLabel ?? 'IEX midpoint', lastClose: kase.price.basis === 'last_close', periodEnd: kase.price.periodEnd ?? null } : null;
  const topics: string[] = kase?.event?.analysis?.topics ?? [];
  return {
    caseId: kase.id, tier, symbol: kase.symbol, company: kase?.identity?.name ?? null,
    identity: { confirmed: !!idea.eventMatch?.confirmed, label: idea.eventMatch?.label ?? 'Unknown', reason: idea.eventMatch?.reason ?? null, security: idea.security?.text ?? null },
    event: { headline: kase?.event?.headline ?? null, url: kase?.event?.url ?? null, source: kase?.event?.source ?? null, publishedAt: kase?.event?.publishedAt ?? null, assessedAt: kase.createdAt, topics },
    kind: { label: 'Event-driven', note: topics.includes('Analyst opinion') ? 'Includes an analyst opinion, which is a view rather than a company event.' : 'Starts from a news report. Sentinel has no long-term theme research yet.' },
    conclusion: kase.conclusion, view: { tone: idea.view.tone, label: idea.view.label, text: idea.view.text },
    score: { score: score?.score ?? null, band: score?.band ?? null, coverage: score?.coverage ?? 0, meaning: 'Counts sourced evidence. Not a chance of gain.' },
    changes, changesNote: changes.length ? null : 'No valid year-on-year comparison in the SEC figures recorded by the case time.',
    valuation: pe ? { status: 'indicative', ...pe, note: 'A low P/E alone is not evidence of value.' } : { status: 'unavailable', reason: kase?.price?.reason ?? 'No P/E.' },
    expectations: 'Unknown: Sentinel has no analyst expectations or guidance history.',
    counterpoint: idea.counter?.[0] ?? null, missing: (idea.missing ?? []).slice(0, 2), nextCheck: idea.nextChecks?.[0] ?? null,
  };
}
