/**
 * Investment thesis panel (investment-thesis-v1, 2026-11-13). Pure and deterministic.
 *
 * It arranges what Sentinel already holds about ONE case into five questions:
 *   A why this case appeared · B what supports a thesis · C what challenges it ·
 *   D price and valuation · E what would change the view.
 * Inputs are the stored case, the "What changed?" context (evidence-pack-v1: SEC facts filed AND recorded by the
 * case time), the event-company match and, when the owner asked for it, the price context.
 *
 * Rules it keeps:
 *  - Every observation cites the periods compared and the filing it came from. A % change appears only when the
 *    context already judged the comparison valid.
 *  - Each observation says what it establishes and what it does not. Growth is never called attractive.
 *  - What cannot be assessed is listed as unknown, never as a risk and never as reassurance (invariant 3).
 *  - A probable wrong-company match gets no supporting observations at all.
 *  - No model text, no estimate, no target, no probability, no instruction (invariants 5–7).
 * It changes no case, screen, score, ranking or Practice record.
 */
import type { EventMatch } from './event-match';

export const THESIS_VERSION = 'investment-thesis-v1';
export const MAX_POINTS = 3;
type Src = { accession: string | null; url: string | null; filed: string | null; form: string | null };
export type Observation = {
  status: 'supported' | 'unknown'; topic: string; text: string; establishes: string;
  basis: string | null; periods: { latest: string | null; prior: string | null } | null; source: Src | null; cites: string[];
};

const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const src = (i: any): Src => ({ accession: i?.source?.accession ?? null, url: i?.source?.url ?? null, filed: i?.sourceTime ? String(i.sourceTime).slice(0, 10) : null, form: i?.form ?? null });
const NOT_PRICE = 'It says nothing about whether the shares are attractive at the current price.';

function matchStatus(m: EventMatch) {
  if (m.level === 'named_in_headline') return { status: 'supported' as const, label: 'Supported', text: `${m.reason} That supports the match; it does not prove the company is the main subject.` };
  if (m.level === 'name_conflict') return { status: 'likely_wrong' as const, label: 'Likely wrong company', text: m.reason };
  return { status: 'uncertain' as const, label: 'Uncertain', text: m.reason };
}

function eventType(kase: any) {
  const topics: string[] = kase?.event?.analysis?.topics ?? [], role = kase?.identity?.relevance;
  if (topics.length && topics.every(t => t === 'Analyst opinion')) return { type: 'analyst_opinion' as const, label: 'Analyst opinion', text: 'The headline reports an analyst’s view (a rating or price-target change). It is an opinion about the company, not something the company announced.' };
  if (role?.level === 'direct_candidate' && role.role === 'possible event subject' && topics.some(t => t !== 'Analyst opinion')) return { type: 'company_report' as const, label: 'Reads as a company announcement', text: 'The headline wording has the company itself reporting or announcing something. Sentinel has not checked it against a company filing.' };
  if (role?.level === 'direct_candidate') return { type: 'about_company' as const, label: 'Report about the company', text: 'The headline has something happening to the company (for example a lawsuit or an offer). The source of the claim is the news provider, not the company.' };
  return { type: 'unclear' as const, label: 'Kind of report unclear', text: 'The stored headline does not show whether this is a company announcement, an opinion or a mention.' };
}

/** Rows of the context by evidence-pack id prefix. */
const rowOf = (ctx: any, prefix: string) => [...(ctx?.business ?? []), ...(ctx?.position ?? [])].find((r: any) => String(r?.latest?.id ?? '').startsWith(prefix)) ?? null;

function changeObs(r: any, topic: string, establishesUp: string, establishesDown: string): Observation | null {
  if (!r || r.changePct === null || r.changePct === undefined) return null;
  const up = r.changePct > 0;
  return { status: 'supported', topic, text: `${r.label} ${up ? 'rose' : r.changePct < 0 ? 'fell' : 'was flat'} ${pct(r.changePct)}: ${r.latest.display} vs ${r.prior.display}.`,
    establishes: up ? establishesUp : establishesDown, basis: `vs ${r.comparison}`, periods: { latest: r.latest?.period?.end ?? null, prior: r.prior?.period?.end ?? null }, source: src(r.latest), cites: [r.latest.id, r.prior.id] };
}
function levelObs(r: any, topic: string, text: (d: string) => string, establishes: string): Observation {
  return { status: 'supported', topic, text: text(r.latest.display), establishes, basis: 'latest reported period (a level, not a change)', periods: { latest: r.latest?.period?.end ?? null, prior: null }, source: src(r.latest), cites: [r.latest.id] };
}
const unknown = (topic: string, text: string): Observation => ({ status: 'unknown', topic, text, establishes: 'Unknown is not a risk and not reassurance: Sentinel could not check this.', basis: null, periods: null, source: null, cites: [] });

export function buildThesis(input: { kase: any; context: any; match: EventMatch; price?: any | null }) {
  const { kase, context: ctx, match } = input, ev = kase?.event ?? {}, company = kase?.identity?.name ?? 'this company';
  const m = matchStatus(match), type = eventType(kase), wrong = m.status === 'likely_wrong';
  const qRev = rowOf(ctx, 'Q:revenue:'), aRev = rowOf(ctx, 'A:revenue:'), qNi = rowOf(ctx, 'Q:net_income:'), aNi = rowOf(ctx, 'A:net_income:'), aCfo = rowOf(ctx, 'A:cfo:'), aOp = rowOf(ctx, 'A:operating_income:');
  const dil = rowOf(ctx, 'A:share_count_yoy:'), debt = rowOf(ctx, 'A:total_debt:'), cash = rowOf(ctx, 'A:cash:');
  const val = (r: any) => (r && typeof r.latest?.value === 'number' ? r.latest.value as number : null);

  // ---- B and C: every candidate observation, in a fixed order of importance ----
  const supports: Observation[] = [], challenges: Observation[] = [];
  const put = (o: Observation | null, positive: boolean) => { if (o) (positive ? supports : challenges).push(o); };
  const revUp = 'Establishes that reported sales grew over this period. It does not show why (price, volume or an acquisition) or that growth will continue. ' + NOT_PRICE;
  const revDown = 'Establishes that reported sales shrank over this period. It does not show whether the cause is temporary.';
  // Order: one revenue comparison (the latest quarter if valid, else the year), profitability, cash flow, then the rest.
  const revRows = [qRev, aRev].filter(r => r && r.changePct != null), ni = val(aNi), cfo = val(aCfo);
  const rev = (r: any) => put(changeObs(r, 'Revenue', revUp, revDown), r.changePct > 0);
  if (revRows[0]) rev(revRows[0]);
  if (ni !== null) put(levelObs(aNi, 'Profitability', d => ni > 0 ? `Net income was ${d} in the latest reported year.` : `Net income was ${d} in the latest reported year: a loss.`,
    ni > 0 ? 'Establishes that the company was profitable in that year. It does not show whether one-off items drove the profit. ' + NOT_PRICE : 'Establishes that the company lost money in that year. Persistent losses have to be funded by cash, debt or new shares.'), ni > 0);
  if (cfo !== null) put(levelObs(aCfo, 'Cash flow', d => cfo > 0 ? `Operating cash flow was ${d} in the latest reported year.` : `Operating cash flow was ${d} in the latest reported year: the business used cash.`,
    cfo > 0 ? 'Establishes that operations produced cash in that year, before investment spending. ' + NOT_PRICE : 'Establishes that operations consumed cash in that year.'), cfo > 0);
  const niRow = qNi?.changePct != null ? qNi : aNi?.changePct != null ? aNi : null;
  if (niRow) put(changeObs(niRow, 'Profit trend', 'Establishes that reported profit grew over this period. One-off items can produce the same pattern. ' + NOT_PRICE, 'Establishes that reported profit fell over this period.'), niRow.changePct > 0);
  if (aOp?.changePct != null) put(changeObs(aOp, 'Operating profit', 'Establishes that operating profit grew year on year. ' + NOT_PRICE, 'Establishes that operating profit fell year on year.'), aOp.changePct > 0);
  if (revRows[1]) rev(revRows[1]);
  const d = val(dil);
  if (d !== null && d > 5) challenges.push(levelObs(dil, 'Dilution', x => `Diluted share count changed by ${x} year on year.`, 'Establishes that each existing share now owns a smaller part of the company.'));
  const dv = val(debt), cv = val(cash);
  if (dv !== null && cv !== null && dv > cv && cfo !== null && cfo <= 0) challenges.push({ status: 'supported', topic: 'Funding', text: `Total debt ${debt.latest.display} exceeds cash ${cash.latest.display} while operating cash flow is negative.`, establishes: 'Establishes a funding gap on the reported figures. It does not show the debt’s maturity or available credit.', basis: 'latest reported balance sheet and year', periods: { latest: debt.latest?.period?.end ?? null, prior: null }, source: src(debt.latest), cites: [debt.latest.id, cash.latest.id, aCfo.latest.id] });
  const pe = kase?.price;
  if (pe?.status === 'indicative' && Number.isFinite(pe.ratio) && pe.ratio > 30) challenges.push({ status: 'supported', topic: 'Valuation', text: `Indicative P/E is ${pe.ratio.toFixed(1)}, above the research screen’s ceiling of 30.`, establishes: 'Establishes that the price is high relative to last year’s reported earnings. It does not show the shares are overpriced: growth or one-off items can explain it.', basis: `${pe.priceLabel ?? 'IEX midpoint'} ÷ annual diluted EPS`, periods: { latest: pe.periodEnd ?? null, prior: null }, source: { accession: pe.accession ?? null, url: null, filed: pe.filed ?? null, form: '10-K' }, cites: [] });

  // Event-level challenges come first: they question whether the figures matter to this report at all.
  const lead: Observation[] = [];
  if (m.status !== 'supported') lead.push({ status: 'supported', topic: 'Company match', text: wrong ? `The report is probably not about ${company}.` : `It is not confirmed that the report concerns ${company}.`, establishes: m.text, basis: 'stored headline and provider summary', periods: null, source: { accession: null, url: ev.url ?? null, filed: null, form: null }, cites: ['N:headline'] });
  if (type.type === 'analyst_opinion') lead.push({ status: 'supported', topic: 'Kind of report', text: 'This is an analyst opinion, not a company event.', establishes: 'Establishes only that an analyst changed a view. Nothing about the business changed in this report.', basis: 'headline wording', periods: null, source: { accession: null, url: ev.url ?? null, filed: null, form: null }, cites: ['N:headline'] });
  // What could not be assessed is said so, after the supported points.
  const unknowns: Observation[] = [];
  if (!revRows.length) unknowns.push(unknown('Revenue trend', 'Revenue trend: unknown. No valid year-on-year revenue comparison was recorded by the case time.'));
  if (ni === null) unknowns.push(unknown('Profitability', 'Profitability: unknown. No annual net income was recorded by the case time.'));
  if (cfo === null) unknowns.push(unknown('Cash flow', 'Cash flow: unknown. No annual operating cash flow was recorded by the case time.'));
  unknowns.push(unknown('Expectations', 'Whether the report beat or missed expectations: unknown. Sentinel has no analyst estimates or guidance history.'));

  const allChallenges = [...lead, ...challenges];
  const shownChallenges = [...allChallenges, ...unknowns].slice(0, MAX_POINTS);
  const shownSupports = wrong ? [] : supports.slice(0, MAX_POINTS);

  // ---- D: price and valuation ----
  const p = input.price ?? null;
  const win = (w: any) => w ? { label: w.label, from: w.from, to: w.to, sessions: w.sessions, stockPct: w.stockPct, spyPct: w.spyPct, vsSpyPct: w.vsSpyPct, timing: w.knownAtCaseTime ? 'known_at_assessment' as const : 'later_than_assessment' as const } : null;
  const priceMove = !p || p.status === 'not_loaded' ? { status: 'not_loaded' as const, reason: 'Daily prices are fetched only when you ask.' }
    : p.status !== 'ok' ? { status: 'unavailable' as const, reason: String(p.reason ?? 'No price data.') }
    : { status: 'ok' as const, symbol: p.symbol, benchmark: 'SPY', before: win(p.before), after: win(p.after), beforeMissing: p.before ? null : (p.reason ?? 'Not enough sessions before the report.'), lastCloseBeforeEvent: p.lastCloseBeforeEvent, source: p.source, adjustment: p.adjustment, fetchedAt: p.fetchedAt };
  const valuation = pe?.status === 'indicative' && Number.isFinite(pe.ratio)
    ? { status: 'indicative' as const, pe: pe.ratio as number, priceBasis: pe.basis === 'last_close' ? 'Last completed daily close on IEX (not a live price)' : 'Live IEX quote midpoint', priceLabel: pe.priceLabel ?? 'IEX midpoint', price: pe.price ?? null, priceTime: pe.quoteTime ?? null,
        epsPeriod: { start: pe.periodStart ?? null, end: pe.periodEnd ?? null }, eps: pe.eps ?? null, epsFiled: pe.filed ?? null, accession: pe.accession ?? null,
        limitation: 'Uses last year’s reported diluted EPS, not the latest twelve months or forecasts. Share basis, share classes and later splits are not independently verified.' }
    : { status: 'unavailable' as const, reason: String(pe?.reason ?? 'No P/E was computed for this case.') };

  // ---- E: research questions, from the case and its gaps ----
  const topics: string[] = ev?.analysis?.topics ?? [], questions: { question: string; why: string }[] = [];
  if (m.status !== 'supported') questions.push({ question: `Does the original report actually concern ${company}?`, why: 'Open the source and check which company it names. Everything else on this page depends on that.' });
  else questions.push({ question: type.type === 'analyst_opinion' ? 'What reasoning and assumptions are behind the analyst’s change?' : `What exactly did ${company} report, and does it include one-off items?`, why: 'Sentinel read only the headline and the provider’s summary, not the article or the filing.' });
  if (topics.includes('Earnings or financial results')) questions.push({ question: 'How did the results compare with the company’s own guidance and with what analysts expected?', why: 'Sentinel has no expectations data, so it cannot tell a good surprise from a result that was already expected.' });
  else if (topics.includes('Acquisition or transaction')) questions.push({ question: 'Is the deal agreed or only proposed, what is the price, and how is it financed?', why: 'A headline rarely gives the terms, and they decide whether the deal adds or destroys value.' });
  else if (topics.includes('Regulation or legal matter')) questions.push({ question: 'What is the scope, timing and financial size of the decision or claim?', why: 'The headline does not say how much of the business is exposed.' });
  if (valuation.status === 'unavailable') questions.push({ question: 'What do the shares cost relative to earnings?', why: `Sentinel could not compute a P/E: ${valuation.reason}` });
  else if (priceMove.status === 'ok' && priceMove.before && Math.abs(priceMove.before.vsSpyPct) >= 10) questions.push({ question: `The shares moved ${pct(priceMove.before.vsSpyPct)} against SPY in the ${priceMove.before.sessions} sessions before the report. What was already expected?`, why: 'A large move before the news can mean the market anticipated it. The move itself does not show that.' });
  else if (ctx?.business?.every((r: any) => !String(r?.latest?.id ?? '').startsWith('Q:'))) questions.push({ question: 'Has a more recent quarter been filed than the figures shown here?', why: 'No quarterly figures were recorded by the case time, so the annual numbers may be out of date.' });
  else questions.push({ question: 'How much had the shares already moved before this report?', why: priceMove.status === 'ok' ? 'Compare the “before” and “since” moves below with SPY over the same dates.' : 'Load the price context below to compare the stock with SPY over the same dates.' });

  // ---- One-line summary for the dashboard: the same observations, not a second opinion ----
  const reason = wrong ? null : shownSupports[0] ?? null, counter = shownChallenges[0] ?? null;
  return {
    version: THESIS_VERSION, caseId: kase?.id ?? null, symbol: kase?.symbol ?? null, company: kase?.identity?.name ?? null, asOf: kase?.createdAt ?? null,
    promoted: !wrong,
    appeared: { headline: ev.headline ?? null, url: ev.url ?? null, source: ev.source ?? null, publishedAt: ev.publishedAt ?? null, firstObservedAt: ev.firstObservedAt ?? null, assessedAt: kase?.createdAt ?? null,
      readNote: 'Reported claim. Sentinel read the headline and the provider’s summary only, not the article.', match: m, eventType: type },
    supports: shownSupports,
    supportsNote: wrong ? `Not shown. The stored figures belong to ${company}, which is probably not the company in this report, so they say nothing about it.`
      : shownSupports.length ? null : 'No supporting observation could be drawn from SEC figures recorded by the case time. That is a gap in the evidence, not a negative finding.',
    challenges: shownChallenges, challengesNote: allChallenges.length ? null : 'No evidence-supported counterpoint was found in the recorded figures. That is not evidence of safety.',
    counts: { supports: wrong ? 0 : supports.length, challenges: allChallenges.length, unknowns: unknowns.length },
    priceValuation: { valuation, priceMove, expectations: 'Unknown. Sentinel has no analyst estimates or guidance history.',
      caveat: 'A price move around a report does not show the report caused it, that the market missed it, or that the shares are cheap or dear.' },
    questions: questions.slice(0, MAX_POINTS),
    summary: {
      reason: reason ? { text: reason.text, basis: reason.basis, period: reason.periods?.latest ?? null } : null,
      reasonNote: wrong ? 'Not offered as an idea: probably a different company.' : reason ? null : `No sourced supporting observation yet. ${type.label}.`,
      counter: counter ? { text: counter.text, status: counter.status } : null,
    },
    basis: 'Fixed rules over stored, sourced records. No AI model ran. Not a forecast, a valuation or advice.',
  };
}
