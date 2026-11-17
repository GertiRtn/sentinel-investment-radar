// Investment case (`investment-case-v1`): research prototype of spec v3.2 (claude/sentinel-investment-case-spec-v3.2-2026-11-15.md).
// Pure: no network, no database. Deterministic rules over data known at the case's assessment time.
//
// It answers "where should I investigate first, and what do we know?". It never answers whether today's price is
// attractive: every result carries `priceOpportunity: not_established`. Its verdicts are research priorities, are not
// fed into notifications, rankings or experiments, and use no buy/sell language.
//
// Rules that the spec left open and are decided here (reported in the PR):
//  - An unavailable or unchecked input is unknown, never "not a concern".
//  - Mechanism state precedence: not applicable > contradicted > supported > not established. Every condition, including
//    a concern under a not-applicable mechanism, is still listed.
//  - Turnaround viability needs a SUPPORTED runway check or positive comparable annual operating cash flow.
//  - Company size uses weighted diluted shares (the cover-page share count is not collected); it is labelled approximate.

import { caseEventMatch } from './event-match';

export const INVESTMENT_CASE_VERSION = 'investment-case-v1';
export type State = 'supported' | 'concern' | 'unavailable' | 'not_checked' | 'not_applicable';
export type Fig = { metric: string; value: number | null; period_end: string; inputs?: any[] };
export type Bar = { date: string; close: number };
export type Check = { id: string; label: string; category: 'essential' | 'business' | 'price' | 'event'; state: State; text: string; source: string | null; value?: any };

export const LIMITS = { lowPrice: 5, smallCompany: 300e6, cashBacked: 0.5, quarterDrop: -25, marginDrop: 5, debtMultiple: 4, runwayYears: 2, steepFall: -30, steepVsSpy: -25, growthMin: 10, listingDays: 365 };
const LABEL: Record<State, string> = { supported: 'Supported', concern: 'Concern', unavailable: 'Unavailable', not_checked: 'Not checked', not_applicable: 'Not applicable' };

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;
const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
const usd = (v: number) => { const a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}M` : `${s}$${Math.round(a).toLocaleString('en-US')}`; };
const src = (f?: Fig) => { const i = f?.inputs?.[0]; return i ? `${i.form ?? 'SEC filing'} filed ${i.filed ?? 'unknown date'}${i.accession ? ` (${i.accession})` : ''}` : null; };
const series = (figs: Fig[], metric: string) => figs.filter(f => f.metric === metric && typeof f.value === 'number' && Number.isFinite(f.value)).sort((a, b) => a.period_end.localeCompare(b.period_end));
const at = (figs: Fig[], metric: string, end: string) => series(figs, metric).find(f => f.period_end === end);
const yearBefore = (figs: Fig[], metric: string, end: string) => series(figs, metric).find(f => { const d = days(f.period_end, end); return d >= 350 && d <= 380; });
/** Financial companies (banks, brokers, insurers, asset managers): SIC 6000-6799 except REITs (6798). From today's SEC code. */
export function isFinancial(sic: string | null | undefined) { const n = Number(sic); return Number.isFinite(n) && n >= 6000 && n <= 6799 && n !== 6798; }

export type Input = {
  kase: any; sic: string | null; annual: Fig[]; quarterly: Fig[]; filings: { form: string; items: string | null; filed_at: string }[] | null;
  stock: Bar[] | null; spy: Bar[] | null; verification: { state: string; checkedAt: string | null } | null; computedAt: string;
};

export function checks(i: Input) {
  const fin = isFinancial(i.sic), asOf = String(i.kase?.createdAt ?? ''), a = i.annual, q = i.quarterly, out: Check[] = [];
  const push = (c: Check) => { out.push(c); return c; };
  const na = (why: string) => ({ state: 'not_applicable' as State, text: why });

  // ---- essentials
  const cik = i.kase?.identity?.cik, name = i.kase?.identity?.name;
  push({ id: 'identity', label: 'Company identity', category: 'essential', state: /^\d{10}$/.test(String(cik ?? '')) && name ? 'supported' : 'unavailable', text: name ? `${name} (SEC CIK ${cik})` : 'No single SEC company for this case.', source: 'SEC identity on the case' });
  const last = i.stock?.at(-1) ?? null;
  push({ id: 'price', label: 'Price before the case', category: 'essential', state: last ? 'supported' : 'unavailable', text: last ? `Last close before assessment: $${last.close.toFixed(2)} on ${last.date} (IEX).` : 'No completed IEX close before the assessment.', source: last ? 'Alpaca IEX daily bars' : null, value: last });
  const rev = series(a, 'revenue').at(-1), ni = series(a, 'net_income').at(-1), ocf = series(a, 'cfo').at(-1);
  push({ id: 'revenue', label: 'Latest annual revenue', category: 'essential', state: rev ? 'supported' : 'unavailable', text: rev ? `${usd(rev.value!)} for the year to ${rev.period_end}.` : 'No annual revenue known at the assessment time.', source: src(rev) });
  for (const [id, label, f] of [['net_income', 'Latest annual net income', ni], ['ocf', 'Latest annual operating cash flow', ocf]] as const)
    push({ id, label, category: 'essential', ...(fin ? na('Financial company: used differently, not essential here.') : { state: f ? 'supported' : 'unavailable', text: f ? `${usd(f.value!)} for the year to ${f.period_end}.` : 'Not known at the assessment time.' }), source: src(f) } as Check);

  // ---- business checks (only these count as business concerns)
  const sameYear = ni && ocf && ni.period_end === ocf.period_end;
  push({ id: 'cash_backed', label: 'Profit backed by cash', category: 'business', source: src(ocf),
    ...(fin ? na('Financial company: operating cash flow does not measure the same thing.')
      : !ni || !ocf || !sameYear ? { state: 'unavailable', text: 'Annual net income and operating cash flow for the same year are not both known.' }
      : ni.value! <= 0 ? na('Loss year: net income is not positive, so there is no profit to back.')
      : ocf.value! <= 0 ? { state: 'concern', text: `Net income ${usd(ni.value!)} but operating cash flow ${usd(ocf.value!)} (year to ${ni.period_end}).` }
      : ocf.value! < LIMITS.cashBacked * ni.value! ? { state: 'concern', text: `Operating cash flow ${usd(ocf.value!)} is below half of net income ${usd(ni.value!)}.` }
      : { state: 'supported', text: `Operating cash flow ${usd(ocf.value!)} vs net income ${usd(ni.value!)} (year to ${ni.period_end}).` }) } as Check);

  const ra = series(a, 'revenue'), r3 = ra.slice(-3), gapOk = (x: Fig, y: Fig) => { const d = days(x.period_end, y.period_end); return d >= 330 && d <= 400; }, annualKnown = r3.length === 3 && gapOk(r3[0], r3[1]) && gapOk(r3[1], r3[2]);
  const annualDown2 = annualKnown && r3[2].value! < r3[1].value! && r3[1].value! < r3[0].value!;
  const lq = series(q, 'revenue').at(-1), lqPrev = lq ? yearBefore(q, 'revenue', lq.period_end) : undefined;
  const qChange = lq && lqPrev && lqPrev.value! > 0 ? (lq.value! / lqPrev.value! - 1) * 100 : null;
  const qDrop = qChange !== null && qChange < LIMITS.quarterDrop;
  push({ id: 'revenue_trend', label: 'Revenue trend', category: 'business', source: src(lq) ?? src(rev),
    ...(annualDown2 || qDrop ? { state: 'concern', text: [annualDown2 ? 'Annual revenue fell two years running.' : null, qDrop ? `Latest quarter ${pct(qChange!)} on the same quarter a year earlier.` : null].filter(Boolean).join(' ') }
      : annualKnown && qChange !== null ? { state: 'supported', text: `No two-year annual decline; latest quarter ${pct(qChange)} on a year earlier.` }
      : { state: 'unavailable', text: `${annualKnown ? '' : 'Fewer than three comparable annual revenues. '}${qChange === null ? 'No comparable quarter a year earlier.' : ''}`.trim() }), value: { quarterChangePct: qChange, latestQuarterEnd: lq?.period_end ?? null } } as Check);

  const margin = (figs: Fig[], end: string) => { const r = at(figs, 'revenue', end), o = at(figs, 'operating_income', end); return r && o && r.value! > 0 ? (o.value! / r.value!) * 100 : null; };
  const mEnd = ra.at(-1)?.period_end, mPrevEnd = mEnd ? yearBefore(a, 'revenue', mEnd)?.period_end : undefined;
  const m1 = mEnd ? margin(a, mEnd) : null, m0 = mPrevEnd ? margin(a, mPrevEnd) : null;
  push({ id: 'margin_trend', label: 'Operating margin trend', category: 'business', source: src(at(a, 'operating_income', mEnd ?? '')),
    ...(fin ? na('Financial company: operating margin is not comparable.') : m1 === null || m0 === null ? { state: 'unavailable', text: 'Operating income and revenue for two comparable years are not both known.' }
      : m1 - m0 < -LIMITS.marginDrop ? { state: 'concern', text: `Operating margin ${m1.toFixed(1)}% vs ${m0.toFixed(1)}% a year earlier.` }
      : { state: 'supported', text: `Operating margin ${m1.toFixed(1)}% vs ${m0.toFixed(1)}% a year earlier.` }), value: { margin: m1, prior: m0 } } as Check);

  const dEnd = ocf?.period_end ?? ra.at(-1)?.period_end ?? '';
  const dc = at(a, 'debt_combined', dEnd), dn = at(a, 'debt_noncurrent', dEnd), dcur = at(a, 'debt_current', dEnd), cash = at(a, 'cash', dEnd);
  const debt = dc ? dc.value! : dn ? dn.value! + (dcur?.value ?? 0) : null;
  push({ id: 'debt', label: 'Debt', category: 'business', source: src(dc ?? dn),
    ...(fin ? na('Financial company: deposits and borrowings are part of the business.') : debt === null ? { state: 'unavailable', text: 'No debt figure is tagged for the latest year.' }
      : cash && cash.value! >= debt ? { state: 'supported', text: `Net cash: cash ${usd(cash.value!)} vs debt ${usd(debt)}.` }
      : !ocf || ocf.period_end !== dEnd ? { state: 'unavailable', text: `Debt ${usd(debt)}; operating cash flow for the same year is not known.` }
      : ocf.value! <= 0 ? { state: 'unavailable', text: `Debt ${usd(debt)}${cash ? `, cash ${usd(cash.value!)}` : ''}. Ratio not computable: operating cash flow is not positive.` }
      : debt <= LIMITS.debtMultiple * ocf.value! ? { state: 'supported', text: `Debt ${usd(debt)} is ${(debt / ocf.value!).toFixed(1)}× operating cash flow.` }
      : { state: 'concern', text: `Debt ${usd(debt)} is ${(debt / ocf.value!).toFixed(1)}× operating cash flow.` }) } as Check);

  const cashNow = ocf ? at(a, 'cash', ocf.period_end) : undefined;
  push({ id: 'runway', label: 'Cash runway', category: 'business', source: src(cashNow),
    ...(fin ? na('Financial company: not measured this way.') : !ocf ? { state: 'unavailable', text: 'Operating cash flow not known.' }
      : ocf.value! >= 0 ? na('Operating cash flow is not negative, so no cash burn to fund.')
      : !cashNow ? { state: 'unavailable', text: `Burning ${usd(-ocf.value!)} a year; cash for the same date is not tagged.` }
      : cashNow.value! < LIMITS.runwayYears * -ocf.value! ? { state: 'concern', text: `Cash ${usd(cashNow.value!)} covers ${(cashNow.value! / -ocf.value!).toFixed(1)} years of operating cash burn.` }
      : { state: 'supported', text: `Cash ${usd(cashNow.value!)} covers ${(cashNow.value! / -ocf.value!).toFixed(1)} years of operating cash burn.` }) } as Check);

  const notices = i.filings === null ? null : i.filings.filter(f => /^8-K/.test(f.form) && /\b3\.01\b/.test(f.items ?? '') && f.filed_at <= asOf.slice(0, 10) && days(f.filed_at, asOf) <= LIMITS.listingDays);
  push({ id: 'listing', label: 'Listing notice', category: 'business', source: 'SEC filing index (8-K items)',
    ...(notices === null ? { state: 'unavailable', text: 'The filing list was not available.' } : notices.length ? { state: 'concern', text: `8-K item 3.01 (notice of delisting or rule failure) filed ${notices.map(n => n.filed_at).join(', ')}.` } : { state: 'supported', text: 'No 8-K item 3.01 in the 12 months before the assessment.' }) } as Check);

  // ---- price context (never a business concern)
  const eps = series(a, 'eps_diluted').at(-1);
  push({ id: 'pe_usable', label: 'P/E meaningful', category: 'price', source: src(eps),
    ...(!eps ? { state: 'unavailable', text: 'Annual diluted EPS not known.' } : eps.value! > 0 ? { state: 'supported', text: `Latest annual diluted EPS $${eps.value!.toFixed(2)} is positive.` } : na(`P/E not meaningful: latest annual diluted EPS $${eps.value!.toFixed(2)}.`)) } as Check);
  push({ id: 'pe_history', label: 'P/E against its own history', category: 'price', state: 'not_checked', text: 'Not built in the prototype.', source: null });
  const sm = new Map((i.spy ?? []).map(b => [b.date, b.close])), matched = (i.stock ?? []).filter(b => sm.has(b.date));
  let steep: any = null;
  if (matched.length > 126) { const to = matched.at(-1)!, from = matched[matched.length - 127], s = (to.close / from.close - 1) * 100, m = (sm.get(to.date)! / sm.get(from.date)! - 1) * 100; steep = { from: from.date, to: to.date, stockPct: s, spyPct: m, steep: s < LIMITS.steepFall && s - m < LIMITS.steepVsSpy }; }
  push({ id: 'steep_fall', label: 'Steep fall', category: 'price', source: 'Alpaca IEX daily bars', value: steep,
    ...(steep ? { state: 'supported', text: `${steep.steep ? 'Yes' : 'No'}: ${pct(steep.stockPct)} over 6 months vs SPY ${pct(steep.spyPct)} (${steep.from} – ${steep.to}).` } : { state: 'unavailable', text: 'Fewer than 6 months of matched prices before the assessment.' }) } as Check);

  // ---- event
  const topics: string[] = i.kase?.event?.analysis?.topics ?? [], analystOnly = topics.length > 0 && topics.every(t => t === 'Analyst opinion');
  const match = caseEventMatch(i.kase);
  push({ id: 'event_named', label: 'Company named in the event', category: 'event', source: 'Stored headline and provider summary', value: { level: match.level, analystOnly },
    ...(analystOnly ? na('Analyst opinion: not a company event.') : match.level === 'name_conflict' ? { state: 'concern', text: match.reason } : match.level === 'named_in_headline' ? { state: 'supported', text: match.reason } : { state: 'unavailable', text: match.reason }) } as Check);
  const v = i.verification?.state ?? 'not_checked';
  push({ id: 'event_filing', label: 'Event backed by a company filing', category: 'event', source: 'event-verify-v1', value: { checkedAt: i.verification?.checkedAt ?? null, laterThanAssessment: !!(i.verification?.checkedAt && i.verification.checkedAt > asOf) },
    ...(v === 'supported' ? { state: 'supported', text: 'A company 8-K names the headline counterparty.' } : v === 'conflicting' ? { state: 'concern', text: 'A company filing conflicts with the headline.' }
      : v === 'wrong_company' || v === 'not_company_event' ? na('Not checked against filings: wrong company or not a company event.') : v === 'not_checked' ? { state: 'not_checked', text: 'Headline only: no company filing examined.' } : { state: 'unavailable', text: 'Filings examined or unreadable: not enough evidence.' }) } as Check);

  return { checks: out, financial: fin, steep, quarterChangePct: qChange, latestMargin: m1, eps: eps?.value ?? null };
}

/** Screening characteristics and flags. Never verdict caps, never counted as concerns. */
export function characteristics(i: Input, c: ReturnType<typeof checks>) {
  const last = i.stock?.at(-1) ?? null, sh = series(i.annual, 'shares_diluted').at(-1);
  const value = last && sh ? last.close * sh.value! : null;
  return [
    { id: 'low_price', label: 'Low share price', state: last ? (last.close < LIMITS.lowPrice ? 'flagged' : 'clear') : 'unavailable', text: last ? (last.close < LIMITS.lowPrice ? `Under $${LIMITS.lowPrice} ($${last.close.toFixed(2)}). A screening characteristic: tradability, spreads and costs depend on the security, broker and quotes, which Sentinel can't see.` : `$${last.close.toFixed(2)}.`) : 'No price.' },
    { id: 'small_company', label: 'Small company (approximate)', state: value === null ? 'unavailable' : value < LIMITS.smallCompany ? 'flagged' : 'clear', text: value === null ? 'Share count or price not known.' : `About ${usd(value)}: last close × weighted diluted shares for the year to ${sh!.period_end}. Approximate: the cover-page share count is not collected yet.` },
    { id: 'liquidity', label: 'Liquidity', state: 'unavailable', text: 'Unknown: Sentinel sees only IEX volume, a lower bound on real trading.' },
    { id: 'share_count', label: 'Share-count change', state: 'unavailable', text: 'Not assessed: the cover-page share count (as filed) is not collected, and Sentinel does not assume the series is split-adjusted.' },
  ];
}

export type CondStatus = 'met' | 'not_met' | 'concern' | 'unknown' | 'not_applicable';
type Cond = { label: string; status: CondStatus; detail: string };
const fromCheck = (ch: Check | undefined, label: string): Cond => !ch ? { label, status: 'unknown', detail: 'Not computed.' }
  : { label, status: ch.state === 'supported' ? 'met' : ch.state === 'concern' ? 'concern' : ch.state === 'not_applicable' ? 'not_applicable' : 'unknown', detail: ch.text };
/** Precedence: not applicable > contradicted > supported > not established. Every condition is still listed. */
export function mechanismState(conds: Cond[]) {
  if (conds.some(c => c.status === 'not_applicable')) return 'not_applicable';
  if (conds.some(c => c.status === 'concern')) return 'contradicted';
  if (conds.length && conds.every(c => c.status === 'met')) return 'supported';
  return 'not_established';
}

export function mechanisms(i: Input, c: ReturnType<typeof checks>) {
  const by = Object.fromEntries(c.checks.map(x => [x.id, x])) as Record<string, Check>, q = i.quarterly, out: any[] = [];
  const mk = (id: string, label: string, conds: Cond[], missing: string[], observations: any[], extra: any = {}) => {
    const state = c.financial && id !== 'deal' ? 'not_applicable' : mechanismState(conds);
    out.push({ id, label, state, conditions: conds, supportedCount: conds.filter(x => x.status === 'met').length, missing, observations, note: c.financial && id !== 'deal' ? 'No mechanisms are designed for financial companies yet.' : null, ...extra });
  };
  const steep = c.steep, qc = c.quarterChangePct;

  mk('held_up', 'Business held up while the price fell', [
    { label: 'Steep fall', status: steep ? (steep.steep ? 'met' : 'not_met') : 'unknown', detail: by.steep_fall.text },
    fromCheck(by.cash_backed, 'Profit backed by cash'),
    fromCheck(by.revenue_trend, 'Revenue trend not a concern'),
    { label: 'Latest quarter revenue at or above a year earlier', status: qc === null ? 'unknown' : qc >= 0 ? 'met' : 'not_met', detail: qc === null ? 'No comparable quarter.' : `${pct(qc)} on the same quarter a year earlier.` },
  ], ['Why the price fell', 'What the market expects (no source)'],
  [{ id: 'revenue_yoy', rule: 'revenue_yoy_nonneg', label: 'Revenue vs the same period a year earlier', baseline: qc }, { id: 'ocf', rule: 'ocf_positive', label: 'Operating cash flow (comparable period)', baseline: null }, { id: 'margin', rule: 'margin_vs_baseline', label: 'Operating margin vs baseline', baseline: c.latestMargin }]);

  const ra = series(i.annual, 'revenue'), ar = ra.at(-1), ap = ar ? yearBefore(i.annual, 'revenue', ar.period_end) : undefined;
  const annualGrowth = ar && ap && ap.value! > 0 ? (ar.value! / ap.value! - 1) * 100 : null;
  mk('growth', 'Growth with valuation context', [
    { label: `Annual revenue growth ≥ ${LIMITS.growthMin}%`, status: annualGrowth === null ? 'unknown' : annualGrowth >= LIMITS.growthMin ? 'met' : 'not_met', detail: annualGrowth === null ? 'No comparable prior year.' : `${pct(annualGrowth)} (year to ${ar!.period_end}).` },
    { label: `Latest quarter growth ≥ ${LIMITS.growthMin}% on a year earlier`, status: qc === null ? 'unknown' : qc >= LIMITS.growthMin ? 'met' : 'not_met', detail: qc === null ? 'No comparable quarter.' : `${pct(qc)}.` },
    fromCheck(by.cash_backed, 'Profit backed by cash'),
    fromCheck(by.pe_usable, 'Current P/E meaningful'),
  ], ['Whether growth is already in the price (no expectations source)', 'P/E against its own history (not built yet)'],
  [{ id: 'revenue_growth', rule: 'revenue_growth', label: 'Revenue growth vs a year earlier', baseline: qc }, { id: 'margin', rule: 'margin_vs_baseline', label: 'Operating margin vs baseline', baseline: c.latestMargin }]);

  // Distress: a confirmed problem and an improvement matched to it, year on year in each of the two latest quarters.
  const two = (metric: 'revenue' | 'cfo' | 'margin') => {
    const ends = [...new Set(series(q, 'revenue').map(f => f.period_end))].slice(-2);
    if (ends.length < 2) return { status: 'unknown' as CondStatus, detail: 'Fewer than two quarters known.' };
    const val = (end: string) => metric === 'margin' ? (() => { const r = at(q, 'revenue', end), o = at(q, 'operating_income', end); return r && o && r.value! > 0 ? o.value! / r.value! : null; })() : at(q, metric, end)?.value ?? null;
    const prior = (end: string) => { const p = yearBefore(q, 'revenue', end)?.period_end; return p ? val(p) : null; };
    const res = ends.map(e => { const now = val(e), before = prior(e); return now === null || before === null ? null : metric === 'revenue' ? before > 0 && now / before - 1 > 0 : now > before; });
    if (res.some(r => r === null)) return { status: 'unknown' as CondStatus, detail: metric === 'cfo' ? 'Single-quarter operating cash flow for both quarters and a year earlier is not known (10-Qs usually report year to date).' : 'A comparable quarter a year earlier is missing.' };
    return { status: (res.every(Boolean) ? 'met' : 'not_met') as CondStatus, detail: `${res.filter(Boolean).length} of the last 2 quarters better than a year earlier (quarters to ${ends.join(', ')}).` };
  };
  const problems = [
    by.revenue_trend.state === 'concern' ? { problem: 'Revenue decline', ...two('revenue') } : null,
    by.cash_backed.state === 'concern' || by.runway.state === 'concern' ? { problem: 'Cash burn or weak cash conversion', ...two('cfo') } : null,
    by.margin_trend.state === 'concern' ? { problem: 'Margin decline', ...two('margin') } : null,
  ].filter(Boolean) as { problem: string; status: CondStatus; detail: string }[];
  const otherProblems = ['debt', 'listing'].filter(k => by[k].state === 'concern').map(k => by[k].label);
  const ocfFig = series(i.annual, 'cfo').at(-1);
  const viability: Cond = by.runway.state === 'supported' ? { label: 'Can fund itself', status: 'met', detail: by.runway.text }
    : by.runway.state === 'concern' ? { label: 'Can fund itself', status: 'concern', detail: by.runway.text }
    : ocfFig && ocfFig.value! > 0 && by.ocf.state === 'supported' ? { label: 'Can fund itself', status: 'met', detail: `Annual operating cash flow positive (${usd(ocfFig.value!)}).` }
    : { label: 'Can fund itself', status: 'unknown', detail: 'Neither a supported runway check nor positive annual operating cash flow.' };
  if (!problems.length && !otherProblems.length) {
    out.push({ id: 'distress', label: 'Distress with a specific improvement', state: c.financial ? 'not_applicable' : 'not_applicable', conditions: [], supportedCount: 0, missing: [], observations: [], note: c.financial ? 'No mechanisms are designed for financial companies yet.' : 'No confirmed business problem, so this mechanism does not apply.' });
  } else {
    const improvement: Cond = problems.find(p => p.status === 'met') ? { label: 'Improvement matched to the problem', status: 'met', detail: problems.filter(p => p.status === 'met').map(p => `${p.problem}: ${p.detail}`).join(' ') }
      : problems.length ? { label: 'Improvement matched to the problem', status: problems.every(p => p.status === 'not_met') ? 'not_met' : 'unknown', detail: problems.map(p => `${p.problem}: ${p.detail}`).join(' ') }
      : { label: 'Improvement matched to the problem', status: 'unknown', detail: `No improvement signal is defined for ${otherProblems.join(' and ').toLowerCase()} in the prototype (financing needs term analysis).` };
    mk('distress', 'Distress with a specific improvement', [{ label: 'Confirmed business problem', status: 'met', detail: [...problems.map(p => p.problem), ...otherProblems].join(', ') }, improvement, viability],
      ['Why the improvement may last', 'Whether the problem is cyclical or structural', ...(otherProblems.length ? ['Financing improvement (not assessable in the prototype)'] : [])],
      [{ id: 'improvement', rule: 'improvement_positive', label: 'Matched improvement vs a year earlier', baseline: null }]);
  }

  const vf = by.event_filing;
  out.push({ id: 'deal', label: 'Verified deal: for investigation', state: vf.state === 'supported' ? 'supported' : vf.state === 'concern' ? 'contradicted' : vf.state === 'not_applicable' ? 'not_applicable' : 'not_established',
    conditions: [fromCheck(vf, 'A company 8-K names the counterparty')], supportedCount: vf.state === 'supported' ? 1 : 0,
    missing: ['Value and duration', 'Margin', 'Additional or replacement business', 'Closing', 'Financing', 'Whether the filing matches the headline claim'],
    observations: [{ id: 'deal_status', rule: 'deal_status', label: 'Closed (8-K 2.01) / terminated (1.02) / no update', baseline: null }],
    note: 'Never makes a case a research priority on its own.' });
  return out;
}

export const VERDICT_TEXT: Record<string, string> = {
  insufficient: 'Insufficient evidence', turnaround: 'Turnaround candidate: high risk', priority: 'Research priority',
  material: 'Material concerns: thesis not established', watch: 'Watch: thesis unproven',
};

/** First match wins. A research priority, never a statement that the price is attractive. */
export function verdict(c: ReturnType<typeof checks>, mech: any[]) {
  const by = Object.fromEntries(c.checks.map(x => [x.id, x])) as Record<string, Check>, m = Object.fromEntries(mech.map(x => [x.id, x]));
  const essentials = ['identity', 'price', 'revenue', ...(c.financial ? [] : ['net_income', 'ocf'])].filter(k => by[k].state !== 'supported');
  const concerns = c.checks.filter(x => x.category === 'business' && x.state === 'concern');
  const named = by.event_named, supportedThesis = ['held_up', 'growth'].filter(k => m[k]?.state === 'supported');
  if (essentials.length || named.value?.level === 'name_conflict' || by.event_filing.state === 'concern')
    return { id: 'insufficient', text: VERDICT_TEXT.insufficient, why: [essentials.length ? `Essential input unavailable: ${essentials.map(k => by[k].label.toLowerCase()).join(', ')}.` : null, named.value?.level === 'name_conflict' ? 'Probably a different company.' : null, by.event_filing.state === 'concern' ? 'A company filing conflicts with the headline.' : null].filter(Boolean).join(' ') };
  if (m.distress?.state === 'supported') return { id: 'turnaround', text: VERDICT_TEXT.turnaround, why: 'A confirmed problem with a matched improvement in each of the last two quarters, and the company can fund itself. The recovery may not continue.' };
  if (named.state === 'supported' && !named.value?.analystOnly && supportedThesis.length)
    return { id: 'priority', text: VERDICT_TEXT.priority, why: `${supportedThesis.map(k => m[k].label).join(' and ')}: every condition supported, and the company is named in its own event. The price question is not answered.` };
  if (concerns.length >= 2 && !['held_up', 'growth', 'distress'].some(k => m[k]?.state === 'supported'))
    return { id: 'material', text: VERDICT_TEXT.material, why: `Confirmed concerns: ${concerns.map(x => x.label.toLowerCase()).join(', ')}. No mechanism in the current library is supported.` };
  return { id: 'watch', text: VERDICT_TEXT.watch, why: c.financial ? 'Financial company: no mechanisms are designed for it yet.' : supportedThesis.length && named.value?.analystOnly ? 'A business mechanism is supported, but the event is an analyst opinion, not a company event.' : 'No mechanism is fully supported by the evidence yet.' };
}

export function assessInvestmentCase(i: Input) {
  const c = checks(i), ch = characteristics(i, c), mech = mechanisms(i, c), v = verdict(c, mech);
  return {
    version: INVESTMENT_CASE_VERSION, spec: 'claude/sentinel-investment-case-spec-v3.2-2026-11-15.md', caseId: i.kase?.id ?? null, symbol: i.kase?.symbol ?? null,
    asOf: i.kase?.createdAt ?? null, computedAt: i.computedAt, retrospective: Date.parse(i.computedAt) - Date.parse(String(i.kase?.createdAt)) > 86400000,
    companyType: c.financial ? 'financial' : 'non_financial', verdict: v,
    priceOpportunity: { status: 'not_established', why: 'Sentinel has no reliable source of market expectations and no sourced inputs for a range of future outcomes.', context: { steepFall: c.steep, eps: c.eps, peAtAssessment: i.kase?.price?.status === 'indicative' ? i.kase.price.ratio : null } },
    checks: c.checks, characteristics: ch, mechanisms: mech,
    concerns: c.checks.filter(x => x.category === 'business' && x.state === 'concern').map(x => x.label),
    gaps: c.checks.filter(x => x.state === 'unavailable' || x.state === 'not_checked').map(x => `${x.label}: ${LABEL[x.state].toLowerCase()}`),
    use: 'Research prototype. Not used for notifications, rankings or experiments. Not advice.',
  };
}

// ---- later observations: rules fixed in advance (spec section 7) ----
export type Obs = 'held' | 'mixed' | 'failed' | 'not_yet' | 'unavailable';
export function observe(rule: string, baseline: number | null, value: number | null | string | undefined): Obs {
  if (value === undefined) return 'not_yet';
  if (value === null) return 'unavailable';
  if (rule === 'deal_status') return 'unavailable'; // records what happened to the deal, not whether a thesis held
  const v = Number(value);
  if (!Number.isFinite(v)) return 'unavailable';
  switch (rule) {
    case 'revenue_yoy_nonneg': return v >= 0 ? 'held' : 'failed';
    case 'revenue_growth': return v >= 5 ? 'held' : v >= 0 ? 'mixed' : 'failed';
    case 'ocf_positive': return v > 0 ? 'held' : 'failed';
    case 'improvement_positive': return v > 0 ? 'held' : 'failed';
    case 'margin_vs_baseline': if (baseline === null) return 'unavailable'; return v >= baseline - 2 ? 'held' : v >= baseline - 5 ? 'mixed' : 'failed';
    default: return 'unavailable';
  }
}
/** Per mechanism over two filings: held if all held at both; failed if any observation failed at both; else mixed. */
export function combine(perFiling: Obs[][]): Obs {
  if (perFiling.length < 2 || perFiling.some(f => f.includes('not_yet'))) return 'not_yet';
  if (perFiling.some(f => f.includes('unavailable'))) return 'unavailable';
  if (perFiling.every(f => f.every(o => o === 'held'))) return 'held';
  const n = perFiling[0].length;
  for (let k = 0; k < n; k++) if (perFiling.every(f => f[k] === 'failed')) return 'failed';
  return 'mixed';
}
