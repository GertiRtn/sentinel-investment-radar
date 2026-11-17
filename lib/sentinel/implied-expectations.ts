/**
 * What the price assumes (`implied-expectations-v1`, 2026-11-16). Pure: no fetching, no storage.
 *
 * A reverse discounted-cash-flow reading: given today's market value of the common equity and the last reported
 * annual cash flow (operating cash flow minus capital expenditure), which constant five-year growth in that cash
 * flow makes its present value equal the market value, at stated illustrative assumptions? It answers "what does
 * the price already assume", next to the company's own reported history. It is not a forecast, not a statement
 * about whether the price is right, and it produces no value for the shares.
 *
 * One basis, stated on every result: EQUITY. Market value of common equity (price × cover-page shares) against
 * CFO − capex, which is after interest paid. Debt is never subtracted from market value and enterprise value is
 * never used; net debt is shown beside the result as context only.
 *
 * Unknown is never a pass: every input that cannot be established makes the result `unavailable` with the exact
 * reason, and every check that could not run is listed as "not checked".
 */
import type { Figure, FinancialFact } from './financial';
import { cashflowScenarios, DCF_ASSUMPTIONS } from './cashflow-scenarios';

export const IMPLIED_VERSION = 'implied-expectations-v3'; // v3 (2026-11-16): split check, share-class check, stale share-count block, NCI and preferred limits (xbrl-tags-v3)
// v2 (2026-11-16): xbrl-tags-v2 figures, SEC load state, ADR rule, checks-not-run line
export const MAX_SHARE_COUNT_AGE_DAYS = 400; // older than this, the count may predate splits, buybacks or new classes: no market value
export const MAX_CLAIM_SHARE = 0.10;         // NCI or preferred above ~10% of market value: the headline is held back (provisional)
/** Stock-split check between the cover-page date and the price date, from IEX closes with no adjustment and with split adjustment only. */
export type SplitCheck =
  | { state: 'none'; coverSession: string; priceSession: string; source: string }
  | { state: 'split'; factor: number; ratio: string; coverSession: string; priceSession: string; source: string }
  | { state: 'unclear'; factor: number; coverSession: string; priceSession: string; source: string }
  | { state: 'not_run'; reason: string };
/**
 * raw/split-adjusted close ratio on the cover-page session, divided by the same ratio on the price session, is the
 * split factor between them (1 = no split). A usual split ratio (SPLIT_RATIOS, within 0.5%) adjusts the share count;
 * anything else is `unclear` and holds the result back. Dividends do not enter: the split-only series has none.
 */
/** Split ratios companies use: k-for-1 up to 50, 1-for-k up to 100, and 3-for-2, 5-for-4, 4-for-3, 5-for-2. Anything else is "unclear". */
export const SPLIT_RATIOS: [number, number][] = [...Array.from({ length: 49 }, (_, k) => [k + 2, 1] as [number, number]), ...Array.from({ length: 99 }, (_, k) => [1, k + 2] as [number, number]), [3, 2], [5, 4], [4, 3], [5, 2]];
export function splitCheck(raw: Record<string, number> | null, split: Record<string, number> | null, coverDate: string, priceDate: string, source = 'Alpaca IEX daily closes, adjustment raw and split'): SplitCheck {
  if (!raw || !split) return { state: 'not_run', reason: 'unadjusted and split-adjusted IEX prices could not be read' };
  const days = Object.keys(raw).filter(d => split[d] > 0 && raw[d] > 0).sort();
  const on = (d: string) => days.filter(x => x <= d).at(-1) ?? null;
  const cs = on(coverDate), ps = on(priceDate);
  if (!cs || (Date.parse(coverDate) - Date.parse(cs)) / DAY > 7) return { state: 'not_run', reason: `no IEX close within 7 days before the cover-page date ${coverDate}` };
  if (!ps) return { state: 'not_run', reason: 'no IEX close on or before the price date' };
  const factor = (raw[cs] / split[cs]) / (raw[ps] / split[ps]);
  if (Math.abs(factor - 1) < 0.005) return { state: 'none', coverSession: cs, priceSession: ps, source };
  for (const [n, m] of SPLIT_RATIOS) if (Math.abs(n / m / factor - 1) < 0.005) return { state: 'split', factor: n / m, ratio: `${n}-for-${m}`, coverSession: cs, priceSession: ps, source };
  return { state: 'unclear', factor, coverSession: cs, priceSession: ps, source };
}
/** Tickers listed for the same SEC company other than this one (SEC writes BRK-B, IEX BRK.B). */
export const otherListings = (symbol: string, tickers: string[]) => [...new Set(tickers.map(t => t.toUpperCase().replace(/-/g, '.')))].filter(t => t !== symbol.toUpperCase().replace(/-/g, '.'));
export const ADR_FORMS = ['20-F', '20-F/A', '40-F', '40-F/A'];
/** How the company's SEC data was read. `parserCurrent`: the last successful read used the current fact parser (share counts and xbrl-tags-v2). */
export type SecState = { state: 'loaded'; parserCurrent: boolean; tagList: string } | { state: 'not_loaded' } | { state: 'failed'; error: string };
export const SEC_MESSAGES = {
  notLoaded: 'SEC data not loaded yet: no successful SEC read is stored for this company.',
  failed: (e: string) => `SEC read failed: ${e} This is a read error, not missing data; stored records are kept. Try again later.`,
  shareNotLoaded: 'Share count not loaded yet: this company\u2019s SEC data was stored before Sentinel read cover-page share counts. It loads at the next SEC refresh, or with \u201cLoad share counts\u201d below.',
  shareNotReported: 'Official share count: the company\u2019s filings report no cover-page count (dei:EntityCommonStockSharesOutstanding).',
  adr: (form: string) => `Unavailable: ADR ratio not stored. The share count comes from a ${form}, which counts the company\u2019s ordinary shares; how many of them one US-listed share represents is not stored, so the market value cannot be worked out.`,
  olderTags: ' This company\u2019s SEC data was stored before the wider tag list (xbrl-tags-v2); it may load at the next SEC refresh.',
};
const NOT_RUN_LABEL: Record<string, string> = { leverage: 'debt (not tagged)', nci: 'noncontrolling interests', preferred: 'preferred stock', company_type: 'company type (no industry code)', share_classes: 'share classes', splits: 'stock splits' };
export const GROWTH_RANGE = Object.freeze({ min: -0.30, max: 0.40 });
export const SENSITIVITY = Object.freeze({ discount: [0.10, 0.12, 0.14], terminalGrowth: [0.01, 0.02, 0.03] });
export const MAX_DEBT_TO_OCF = 4;          // the investment-case debt threshold (provisional)
export const MAX_PRICE_AGE_DAYS = 5;       // as price-basis-v2
export const SHARE_COUNT_STALE_DAYS = 200; // shown as a caveat, never hidden
const DAY = 86_400_000;

export type PriceInput = { value: number; at: string; basis: string; source: string; rawEventId: string | null } | null;

/** Present value of `base` growing at `g` for `years`, then at `terminalGrowth` for ever, discounted at `discount`. */
export function presentValue(base: number, g: number, discount: number, terminalGrowth: number, years: number) {
  let pv = 0;
  for (let y = 1; y <= years; y++) pv += base * (1 + g) ** y / (1 + discount) ** y;
  return pv + base * (1 + g) ** years * (1 + terminalGrowth) / (discount - terminalGrowth) / (1 + discount) ** years;
}

export type Solved = { status: 'solved'; growth: number } | { status: 'outside_range'; side: 'below' | 'above'; text: string };
/** Bisection on growth within GROWTH_RANGE. Present value rises with growth, so the answer is unique or outside the range. */
export function solveGrowth(marketValue: number, base: number, discount: number, terminalGrowth: number, years: number): Solved {
  const f = (g: number) => presentValue(base, g, discount, terminalGrowth, years) - marketValue;
  const pctText = (x: number) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;
  if (f(GROWTH_RANGE.min) > 0) return { status: 'outside_range', side: 'below', text: `Outside range: even ${pctText(GROWTH_RANGE.min)} a year for ${years} years gives more than the market value.` };
  if (f(GROWTH_RANGE.max) < 0) return { status: 'outside_range', side: 'above', text: `Outside range: even ${pctText(GROWTH_RANGE.max)} a year for ${years} years gives less than the market value.` };
  let lo: number = GROWTH_RANGE.min, hi: number = GROWTH_RANGE.max;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) hi = mid; else lo = mid; }
  return { status: 'solved', growth: (lo + hi) / 2 };
}

const fig = (figures: Figure[], metric: string, end: string) => figures.find(f => f.metric === metric && f.period_end === end && f.value !== null) ?? null;
const ref = (f: FinancialFact) => ({ tag: f.source_tag, accession: f.accession, form: f.form, filed: f.filed, knownFrom: f.known_from, periodEnd: f.period_end, rawEventId: f.raw_event_id });

/** Reported CFO − capex for up to five annual periods, oldest first, with the change on a positive base. History, never a forecast. */
export function cashFlowHistory(figures: Figure[], asOf: string) {
  const ends = [...new Set(figures.filter(f => f.metric === 'cfo' && f.confidence === 'reported' && f.value !== null).map(f => f.period_end))].sort().filter(e => e + 'T23:59:59.999Z' <= asOf);
  const rows = ends.map(end => {
    const cfo = fig(figures, 'cfo', end), capex = fig(figures, 'capex', end);
    const a = cfo?.inputs[0], b = capex?.inputs[0];
    const comparable = !!a && !!b && cfo!.confidence === 'reported' && capex!.confidence === 'reported' && !!a.period_start && a.period_start === b.period_start && capex!.value! >= 0;
    return { periodEnd: end, value: comparable ? cfo!.value! - capex!.value! : null, accession: a?.accession ?? null, filed: a?.filed ?? null };
  }).slice(-5);
  return rows.map((r, i) => {
    const prev = i > 0 ? rows[i - 1] : null, gap = prev ? (Date.parse(r.periodEnd) - Date.parse(prev.periodEnd)) / DAY : null;
    const consecutive = gap !== null && gap >= 330 && gap <= 400;
    return { ...r, changePct: r.value !== null && prev?.value != null && prev.value > 0 && consecutive ? (r.value / prev.value - 1) * 100 : null,
      changeNote: r.value === null ? 'CFO or capex not reported for a matching period' : !prev ? 'first period shown' : !consecutive ? 'previous year missing' : prev.value == null ? 'previous year unavailable' : prev.value <= 0 ? 'previous year was zero or negative: no percentage' : null };
  });
}

export type ImpliedInput = {
  symbol: string; asOf: string; sic: string | null; figures: Figure[];
  shareFact: FinancialFact | null;   // latestShareCount(...) or null
  price: PriceInput;
  sec?: SecState;   // absent = loaded with the current parser (pure tests and offline scripts)
  split?: SplitCheck;      // absent = not run (the result is held back)
  otherTickers?: string[]; // other listings of the same SEC company (from otherListings)
};

export function impliedExpectations(i: ImpliedInput) {
  const { discount, terminalGrowth, years } = DCF_ASSUMPTIONS;
  const assumptions = { discount, terminalGrowth, years, growthRange: GROWTH_RANGE, label: 'Illustrative assumptions, not estimates for this company.' };
  const basis = { id: 'equity', text: 'Equity basis: market value of the common shares (price × cover-page share count) compared with operating cash flow minus capital expenditure, which is after interest paid. Debt is not subtracted and enterprise value is not used.' };
  const missing: string[] = [], caveats: { id: string; state: 'not_checked' | 'note'; text: string }[] = [
    { id: 'sbc', state: 'note', text: 'Share-based compensation is not deducted from the cash flow.' },
    { id: 'borrowing', state: 'note', text: 'Net borrowing and repayment are not modelled.' },
  ];
  const now = Date.parse(i.asOf), sec: SecState = i.sec ?? { state: 'loaded', parserCurrent: true, tagList: 'xbrl-tags-v2' };
  if (sec.state === 'not_loaded') missing.push(SEC_MESSAGES.notLoaded);
  if (sec.state === 'failed') missing.push(SEC_MESSAGES.failed(sec.error));
  const secOk = sec.state === 'loaded', current = sec.state === 'loaded' && sec.parserCurrent;

  // Company type
  const sicN = i.sic && /^\d{3,4}$/.test(i.sic) ? Number(i.sic) : null;
  const financial = sicN !== null && sicN >= 6000 && sicN <= 6799;
  if (financial) missing.push(`Financial company (SIC ${i.sic}): operating cash flow minus capital expenditure does not describe a bank, insurer or broker, so this calculation does not apply.`);
  if (sicN === null) caveats.push({ id: 'company_type', state: 'not_checked', text: 'Company type: not checked (no SEC industry code stored).' });

  // Share count
  const sf = i.shareFact;
  let shares: null | { value: number; coverDate: string; ageDays: number; stale: boolean; source: ReturnType<typeof ref> } = null;
  if (!secOk) { /* the SEC reason above covers it */ }
  else if (!sf) missing.push(current ? SEC_MESSAGES.shareNotReported : SEC_MESSAGES.shareNotLoaded);
  else if (ADR_FORMS.includes(sf.form)) missing.push(SEC_MESSAGES.adr(sf.form));
  else if (sf.metric === 'shares_outstanding_multiclass') { missing.push(`Multi-class: per-share unavailable. The filing of ${sf.filed} reports ${sf.value} share counts; they are not summed.`); caveats.push({ id: 'share_classes', state: 'not_checked', text: 'Share classes: not checked. Several share counts are reported and their prices and conversion ratios are not stored, so they are not summed.' }); }
  else if (Math.floor((now - Date.parse(sf.period_end + 'T00:00:00Z')) / DAY) > MAX_SHARE_COUNT_AGE_DAYS) missing.push(`Share count too old: the latest cover-page count is from ${sf.period_end} (${sf.form} filed ${sf.filed}), more than ${MAX_SHARE_COUNT_AGE_DAYS} days before the price. Splits, buybacks or new share classes since then would make the market value wrong.`);
  else {
    const age = Math.floor((now - Date.parse(sf.period_end + 'T00:00:00Z')) / DAY);
    shares = { value: sf.value, coverDate: sf.period_end, ageDays: age, stale: age > SHARE_COUNT_STALE_DAYS, source: ref(sf) };
    if (shares.stale) caveats.push({ id: 'share_count_age', state: 'note', text: `The share count is ${age} days old (cover date ${sf.period_end}); buybacks or new shares since then are not reflected.` });
  }

  // Share classes: another listing of the same SEC company may be another class with its own count and economic weight.
  const others = i.otherTickers ?? [];
  if (secOk && others.length) {
    missing.push(`Share classes: this SEC company also lists ${others.join(', ')}. The cover-page count may cover only some classes, and classes can carry different economic weight, so the market value cannot be summed without each class’s price and conversion ratio.`);
    if (!caveats.some(c => c.id === 'share_classes')) caveats.push({ id: 'share_classes', state: 'not_checked', text: `Share classes: not checked (${others.join(', ')} also listed).` });
  }

  // Price
  let price: null | (NonNullable<PriceInput> & { ageDays: number }) = null;
  if (!i.price || !(i.price.value > 0) || !Number.isFinite(Date.parse(i.price.at))) missing.push('Price: no timestamped IEX price is available.');
  else {
    const age = (now - Date.parse(i.price.at)) / DAY;
    if (age < 0 || age > MAX_PRICE_AGE_DAYS) missing.push(`Stale price: the latest price is from ${i.price.at.slice(0, 10)}, more than ${MAX_PRICE_AGE_DAYS} days before this calculation.`);
    else price = { ...i.price, ageDays: Math.floor(age) };
  }

  // Stock splits between the cover-page date and the price date: adjust a clean split, hold back anything else.
  const split: SplitCheck = i.split ?? { state: 'not_run', reason: 'not provided' };
  let splitFactor = 1;
  if (shares && price) {
    if (split.state === 'not_run') { missing.push(`Split check not run: ${split.reason}. Without it a share count from before a split could be mixed with a price from after it.`); caveats.push({ id: 'splits', state: 'not_checked', text: 'Stock splits: not checked.' }); }
    else if (split.state === 'unclear') missing.push(`Split check: the price series changed by a factor of ${split.factor.toFixed(3)} between ${split.coverSession} and ${split.priceSession}, which is not a clean split ratio. The share count cannot be put on the same basis as the price.`);
    else if (split.state === 'split') { splitFactor = split.factor; caveats.push({ id: 'split_adjusted', state: 'note', text: `Share count adjusted for a ${split.ratio} split between ${split.coverSession} and ${split.priceSession} (${shares.value.toLocaleString('en-US')} × ${split.factor} = ${Math.round(shares.value * split.factor).toLocaleString('en-US')}), from ${split.source}.` }); }
  }

  // Base cash flow: the same validity checks as the cash-flow scenarios (period, currency, filing, age, sign).
  const cf = cashflowScenarios(i.figures, i.asOf);
  if (secOk && cf.status !== 'illustrative') missing.push('Base cash flow: ' + cf.reason + (current ? '' : SEC_MESSAGES.olderTags));

  // Leverage against the equity basis, and net debt as context only.
  let leverage: { state: 'ok' | 'too_high' | 'not_checked'; debt: number | null; ocf: number | null; ratio: number | null; text: string } = { state: 'not_checked', debt: null, ocf: null, ratio: null, text: 'Leverage: not checked (no annual cash flow period).' };
  let netDebt: { value: number; debt: number; cash: number; periodEnd: string } | null = null;
  if (cf.status === 'illustrative') {
    const debt = fig(i.figures, 'total_debt', cf.periodEnd), cash = fig(i.figures, 'cash', cf.periodEnd);
    if (!debt) { leverage = { state: 'not_checked', debt: null, ocf: cf.cfo, ratio: null, text: 'Leverage: not checked. No supported debt tag is reported for this period, so "no debt" cannot be told from "untagged".' }; caveats.push({ id: 'leverage', state: 'not_checked', text: leverage.text }); }
    else {
      const ratio = cf.cfo! > 0 ? debt.value! / cf.cfo! : null;
      const high = ratio === null || ratio > MAX_DEBT_TO_OCF;
      leverage = { state: high ? 'too_high' : 'ok', debt: debt.value, ocf: cf.cfo, ratio, text: ratio === null ? 'Leverage: debt is reported but operating cash flow is not positive.' : `Debt is ${ratio.toFixed(1)}× operating cash flow (limit for this basis: ${MAX_DEBT_TO_OCF}×, provisional).` };
      if (high) missing.push(`Leverage too high for the equity basis: ${leverage.text} With this much debt, cash flow after interest says little about what belongs to shareholders.`);
      if (cash) netDebt = { value: debt.value! - cash.value!, debt: debt.value!, cash: cash.value!, periodEnd: cf.periodEnd };
    }
  }

  // Claims that rank with or ahead of common shareholders (xbrl-tags-v3). The cash flow is consolidated, so it includes
  // what belongs to minority owners and preferred holders. Book values against the market value; above ~10% the headline is held back.
  const mvForClaims = shares && price ? price.value * shares.value * splitFactor : null;
  const claims: Record<string, { value: number | null; periodEnd: string | null; share: number | null; state: string }> = {};
  const claimCheck = (id: 'nci' | 'preferred', parts: string[], label: string, subject: string, why: string) => {
    const at = cf.status === 'illustrative' ? cf.periodEnd : null, found = at ? parts.map(m => fig(i.figures, m, at)).filter(Boolean) as Figure[] : [];
    if (!at) { caveats.push({ id, state: 'not_checked', text: `${label}: not checked (no annual cash flow period).` }); claims[id] = { value: null, periodEnd: null, share: null, state: 'not_checked' }; return; }
    if (!found.length) { caveats.push({ id, state: 'not_checked', text: `${label}: not checked. No supported tag is reported for ${at}, so "none" cannot be told from "untagged".` }); claims[id] = { value: null, periodEnd: at, share: null, state: 'not_checked' }; return; }
    const value = found.reduce((t, f) => t + f.value!, 0), share = mvForClaims ? value / mvForClaims : null;
    claims[id] = { value, periodEnd: at, share, state: share === null ? 'reported' : share > MAX_CLAIM_SHARE ? 'too_large' : 'ok' };
    const amount = Math.abs(value) >= 1e9 ? `$${(value / 1e9).toFixed(2)}B` : `$${(value / 1e6).toFixed(1)}M`;
    if (value === 0) caveats.push({ id: id + '_checked', state: 'note', text: `${label}: none reported (0 at ${at}).` });
    else if (share !== null && share > MAX_CLAIM_SHARE) missing.push(`Held back: ${subject} about ${(share * 100).toFixed(0)}% of the market value (book value ${amount} at ${at}). ${why} Until they are valued separately, no figure is shown.`);
    else caveats.push({ id: id + '_checked', state: 'note', text: `${label}: book value ${amount} at ${at}${share !== null ? `, ${(share * 100).toFixed(1)}% of the market value (limit ${MAX_CLAIM_SHARE * 100}%)` : ''}; included in the cash flow, not deducted.` });
  };
  if (secOk) {
    claimCheck('nci', ['nci', 'nci_redeemable'], 'Noncontrolling interests', 'noncontrolling interests (minority owners in subsidiaries) are', 'The cash flow includes the minority owners’ share, so what the price assumes would not describe these shares.');
    claimCheck('preferred', ['preferred'], 'Preferred stock', 'preferred stock is', 'Preferred holders are paid before common shareholders, so the cash flow overstates what belongs to these shares.');
  }

  const history = cashFlowHistory(i.figures, i.asOf);
  const common = {
    split, claims,
    version: IMPLIED_VERSION, symbol: i.symbol, asOf: i.asOf, basis, assumptions, caveats, leverage,
    notRun: (() => { const ids = caveats.filter(c => c.state === 'not_checked').map(c => c.id); return { ids, text: ids.length ? `Checks not run: ${ids.map(x => NOT_RUN_LABEL[x] ?? x).join(', ')}.` : null }; })(),
    sec: sec.state === 'loaded' ? { state: 'loaded', parserCurrent: sec.parserCurrent, tagList: sec.tagList } : sec, canLoadShareCounts: secOk && !current,
    netDebtContext: netDebt ? { ...netDebt, note: 'Context only. Not subtracted from market value and not part of the calculation.' } : { value: null, note: 'Net debt unavailable: debt and cash are not both tagged for this period.' },
    history: { rows: history, note: 'The company’s own reported history. Not a forecast.' },
    opportunity: { status: 'not_established' as const, text: 'Whether reality may differ from what the price assumes: not established. Sentinel has no sourced expectations data; compare the implied growth with the reported history yourself.' },
    limitations: 'A reading of the price under stated illustrative assumptions. Not a forecast, not a statement about what the shares are worth, and not advice.',
  };
  if (missing.length || !shares || !price || cf.status !== 'illustrative') return { ...common, status: 'unavailable' as const, missing, inputs: { price, shares, baseCashFlow: cf.status === 'illustrative' ? cf.baseCashFlow : null } };

  const marketValue = price.value * shares.value * splitFactor, base = cf.baseCashFlow;
  const solved = solveGrowth(marketValue, base, discount, terminalGrowth, years);
  const cell = (d: number, t: number) => { const s = solveGrowth(marketValue, base, d, t, years); return { discount: d, terminalGrowth: t, growth: s.status === 'solved' ? s.growth : null, outside: s.status === 'outside_range' ? s.side : null }; };
  return {
    ...common, status: 'computed' as const, missing: [],
    marketValue: { value: marketValue, unit: 'USD', method: splitFactor === 1 ? 'price × cover-page shares outstanding' : `price × cover-page shares outstanding × ${splitFactor} (split adjustment)`, splitFactor,
      price: { value: price.value, at: price.at, basis: price.basis, source: price.source, rawEventId: price.rawEventId, ageDays: price.ageDays },
      shares: { value: shares.value, coverDate: shares.coverDate, ageDays: shares.ageDays, stale: shares.stale, ...shares.source } },
    baseCashFlow: { value: base, cfo: cf.cfo, capex: cf.capex, unit: 'USD', periodStart: cf.periodStart, periodEnd: cf.periodEnd, filed: cf.filed, accession: cf.accession, rawEventId: cf.rawEventId, method: 'reported operating cash flow minus reported capital expenditure (calculated)' },
    multiple: marketValue / base,
    implied: solved.status === 'solved'
      ? { status: 'solved' as const, growth: solved.growth, growthPct: Math.round(solved.growth * 10000) / 100, repricedValue: presentValue(base, solved.growth, discount, terminalGrowth, years),
          text: `At a ${(discount * 100).toFixed(0)}% discount rate and ${(terminalGrowth * 100).toFixed(0)}% growth after year ${years}, the price assumes this cash flow ${solved.growth >= 0 ? 'grows' : 'shrinks'} about ${Math.abs(solved.growth * 100).toFixed(1)}% a year for ${years} years.` }
      : { status: 'outside_range' as const, side: solved.side, text: solved.text },
    sensitivity: { discount: SENSITIVITY.discount, terminalGrowth: SENSITIVITY.terminalGrowth, cells: SENSITIVITY.discount.flatMap(d => SENSITIVITY.terminalGrowth.map(t => cell(d, t))), note: 'Implied five-year growth under other assumptions. "Outside range" means no growth between −30% and +40% fits.' },
  };
}
