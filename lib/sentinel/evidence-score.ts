/**
 * Evidence score 0–100 (evidence-score-v1).
 *
 * A published checklist: each check is pass, fail or unknown, and is worth a
 * fixed number of points. The score is the sum of the points of the checks that
 * pass. It measures how much stored evidence supports a closer look. It is NOT a
 * probability, a forecast or an expected return. Approved by the founder on
 * 2026-11-12 (AGENTS.md invariant 6, as amended).
 *
 * Rules (from invariant 3):
 *  - An unknown check scores 0 and is shown as unknown, never as passed.
 *  - When the known checks are worth less than MIN_COVERAGE points, there is no
 *    score at all (status 'insufficient'), because a number would mislead.
 *
 * Every input is a stored, sourced record: news topics and company role from
 * the rule classifier, P/E from an IEX midpoint and reported EPS, and annual
 * and quarterly figures from SEC filings. No model output is used.
 *
 * The weights are an untested hypothesis, chosen before any outcomes were
 * examined. Whether higher scores go with better outcomes is measured per score
 * band; see `scoreBand`.
 */
import type { Figure } from './financial';

export const EVIDENCE_SCORE_VERSION = 'evidence-score-v1';
export const MIN_COVERAGE = 60;
const MATERIAL_TOPICS = ['Earnings or financial results', 'Regulation or legal matter', 'Acquisition or transaction'];
const DAY = 86400000;

export type CheckState = 'pass' | 'fail' | 'unknown';
export type EvidenceCheck = { id: string; label: string; points: number; state: CheckState; detail: string; source: string | null };
export type EvidenceScore = {
  version: typeof EVIDENCE_SCORE_VERSION;
  status: 'scored' | 'insufficient';
  score: number | null;
  band: ScoreBand | null;
  coverage: number;
  checks: EvidenceCheck[];
  meaning: string;
};
export type ScoreBand = 'Strong evidence' | 'Mixed evidence' | 'Weak evidence';
export type QuarterlyRevenue = {
  latestEnd: string; latestValue: number; priorEnd: string; priorValue: number;
  changePercent: number; accession: string; filed: string; rawEventId: string;
} | null;

export const SCORE_MEANING = 'Evidence score: how much stored, sourced evidence supports a closer look, from a published checklist. It is not a probability or a forecast of returns.';

export function scoreBand(score: number | null): ScoreBand | null {
  if (score === null || !Number.isFinite(score)) return null;
  return score >= 70 ? 'Strong evidence' : score >= 40 ? 'Mixed evidence' : 'Weak evidence';
}

/** Latest directly reported quarter of revenue vs the same quarter a year earlier, same tag. */
export function quarterlyRevenueYoY(quarterly: Figure[] | undefined, asOf: string): QuarterlyRevenue {
  const rows = (quarterly ?? []).filter(f => f.metric === 'revenue' && f.confidence === 'reported' && typeof f.value === 'number' && f.inputs.length === 1 && (!f.known_from || f.known_from <= asOf));
  const latest = rows.sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
  if (!latest) return null;
  const tag = latest.inputs[0].source_tag;
  const prior = rows.find(f => {
    const gap = (Date.parse(latest.period_end) - Date.parse(f.period_end)) / DAY;
    return gap >= 350 && gap <= 380 && f.inputs[0].source_tag === tag;
  });
  if (!prior || !(prior.value! > 0)) return null;
  const i = latest.inputs[0];
  return {
    latestEnd: latest.period_end, latestValue: latest.value!, priorEnd: prior.period_end, priorValue: prior.value!,
    changePercent: (latest.value! - prior.value!) / prior.value! * 100,
    accession: i.accession, filed: i.filed, rawEventId: i.raw_event_id,
  };
}

const pct = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

/** Pure. Input is the stored fields of a discovery case. */
export function evidenceScore(input: {
  topics?: string[] | null;
  relevance?: { level?: string } | null;
  price?: any;
  brief?: any;
  quarterlyRevenue?: QuarterlyRevenue | undefined;
  asOf: string;
}): EvidenceScore {
  const checks: EvidenceCheck[] = [];
  const add = (id: string, label: string, points: number, state: CheckState, detail: string, source: string | null) =>
    checks.push({ id, label, points, state, detail, source });
  const ev = (label: string) => (input.brief?.evidence ?? []).find((e: any) => e.label === label);
  const recent = (e: any) => {
    if (!e?.periodEnd || typeof e.value !== 'number') return false;
    const age = Date.parse(input.asOf) - Date.parse(e.periodEnd + 'T23:59:59.999Z');
    return Number.isFinite(age) && age >= 0 && age <= 550 * DAY;
  };
  const secSource = (e: any) => (e?.accession ? `SEC filing ${e.accession}, period ending ${e.periodEnd}` : null);

  // E1 — the news is a material event type.
  const topics = input.topics;
  if (!Array.isArray(topics)) add('E1', 'Material event', 15, 'unknown', 'Headline topics were not recorded.', null);
  else {
    const hit = topics.find(t => MATERIAL_TOPICS.includes(t));
    add('E1', 'Material event', 15, hit ? 'pass' : 'fail', hit ? `${hit}` : topics.length ? `${topics.join(', ')} is not a material event type` : 'No event type recognised', 'Headline topic rules');
  }

  // E2 — the company is named directly in the headline.
  const level = input.relevance?.level;
  add('E2', 'Company named directly', 15, level === 'direct_candidate' ? 'pass' : level ? 'fail' : 'unknown',
    level === 'direct_candidate' ? 'The headline names this company.' : level ? 'The company’s role in the headline is unclear.' : 'Company role was not assessed.', level ? 'Headline relevance rules' : null);

  // E3 — valuation is in a sane range.
  const ratio = input.price?.status === 'indicative' ? input.price.ratio : null;
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) add('E3', 'Valuation sanity (P/E 0–30)', 15, 'unknown', input.price?.reason ?? 'No eligible P/E.', null);
  else add('E3', 'Valuation sanity (P/E 0–30)', 15, ratio > 0 && ratio <= 30 ? 'pass' : 'fail', `P/E ${ratio.toFixed(1)}`, `IEX midpoint ÷ annual diluted EPS (year to ${input.price.periodEnd ?? 'unknown'})`);

  // E4 — latest quarterly release: revenue up on the same quarter last year.
  const q = input.quarterlyRevenue;
  if (!q) add('E4', 'Latest quarter: revenue growing', 15, 'unknown', 'No comparable reported quarter is available.', null);
  else add('E4', 'Latest quarter: revenue growing', 15, q.changePercent > 0 ? 'pass' : 'fail', `${pct(q.changePercent)} vs same quarter a year earlier (quarter to ${q.latestEnd})`, `SEC filing ${q.accession}`);

  // E5 — latest annual revenue up on the prior year.
  const rev = ev('Revenue');
  if (!recent(rev) || typeof rev.changePercent !== 'number') add('E5', 'Annual revenue growing', 10, 'unknown', 'No recent comparable annual revenue.', null);
  else add('E5', 'Annual revenue growing', 10, rev.changePercent > 0 ? 'pass' : 'fail', `${pct(rev.changePercent)} year on year`, secSource(rev));

  // E6 — profitable in the latest year.
  const ni = ev('Net income');
  if (!recent(ni)) add('E6', 'Profitable', 10, 'unknown', 'No recent annual net income.', null);
  else add('E6', 'Profitable', 10, ni.value > 0 ? 'pass' : 'fail', ni.value > 0 ? 'Net income positive in the latest year.' : 'Net loss in the latest year.', secSource(ni));

  // E7 — the business generates cash.
  const cfo = ev('Operating cash flow');
  if (!recent(cfo)) add('E7', 'Generates operating cash', 10, 'unknown', 'No recent annual operating cash flow.', null);
  else add('E7', 'Generates operating cash', 10, cfo.value > 0 ? 'pass' : 'fail', cfo.value > 0 ? 'Operating cash flow positive in the latest year.' : 'Operating cash flow negative in the latest year.', secSource(cfo));

  // E8 — the company data was fresh when assessed.
  if (typeof input.brief?.stale !== 'boolean') add('E8', 'Fresh company data', 10, 'unknown', 'Data freshness was not recorded.', null);
  else add('E8', 'Fresh company data', 10, input.brief.stale ? 'fail' : 'pass', input.brief.stale ? 'SEC data needed a refresh at assessment time.' : 'SEC data refreshed within 24 hours of assessment.', 'Sentinel SEC refresh log');

  const coverage = checks.filter(c => c.state !== 'unknown').reduce((s, c) => s + c.points, 0);
  const sum = checks.filter(c => c.state === 'pass').reduce((s, c) => s + c.points, 0);
  const scored = coverage >= MIN_COVERAGE;
  return {
    version: EVIDENCE_SCORE_VERSION,
    status: scored ? 'scored' : 'insufficient',
    score: scored ? sum : null,
    band: scored ? scoreBand(sum) : null,
    coverage,
    checks,
    meaning: SCORE_MEANING,
  };
}

/** Score for a stored case: the recorded score if present, else recomputed from its stored fields (quarter unknown). */
export function caseEvidenceScore(c: any): EvidenceScore {
  if (c?.evidenceScore?.version === EVIDENCE_SCORE_VERSION) return c.evidenceScore;
  return evidenceScore({
    topics: c?.event?.analysis?.topics ?? null,
    relevance: c?.identity?.relevance ?? null,
    price: c?.price, brief: c?.brief,
    quarterlyRevenue: c?.quarterlyRevenue ?? null,
    asOf: c?.createdAt ?? new Date(0).toISOString(),
  });
}
