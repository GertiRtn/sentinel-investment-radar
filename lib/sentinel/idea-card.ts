/**
 * Idea card (idea-card-v1, 2026-11-13): one case, read as a possible idea.
 *
 * Pure and deterministic. It rearranges records Sentinel already holds: the
 * stored case, the "What changed?" context, the evidence checklist, the
 * event-company match and the owner's Practice holdings. No model text, no
 * estimated numbers, no upside figure, no probability (invariants 5-7).
 *
 * "view" is Sentinel's judgment from fixed, published rules. It says whether
 * the case is worth the owner's research time and how much is unknown. It is
 * not a forecast and not an instruction to trade.
 */
import type { EventMatch } from './event-match';

export const IDEA_CARD_VERSION = 'idea-card-v1';
type Line = { text: string; kind: 'reported_claim' | 'fact' | 'computed' | 'interpretation' | 'missing'; detail?: string | null };
export type PortfolioFit = { status: 'known'; heldInPractice: boolean; heldInExperiment: boolean; openPositions: number; cashCents: number; startCents: number; standardPositionCents: number; weightIfAddedPct: number | null; largestSymbol: string | null; note: string } | { status: 'unknown'; reason: string };

const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

export function portfolioFit(input: { symbol: string; manual: { open: { symbol: string; amountCents: number }[]; cashCents: number; startCents: number } | null; autoOpenSymbols: string[]; standardPositionCents: number }): PortfolioFit {
  if (!input.manual) return { status: 'unknown', reason: 'Practice holdings could not be loaded.' };
  const m = input.manual, invested = m.open.reduce((s, p) => s + p.amountCents, 0), total = m.cashCents + invested;
  const largest = [...m.open].sort((a, b) => b.amountCents - a.amountCents)[0] ?? null;
  return {
    status: 'known', heldInPractice: m.open.some(p => p.symbol === input.symbol), heldInExperiment: input.autoOpenSymbols.includes(input.symbol),
    openPositions: m.open.length, cashCents: m.cashCents, startCents: m.startCents, standardPositionCents: input.standardPositionCents,
    weightIfAddedPct: total > 0 && m.cashCents >= input.standardPositionCents ? input.standardPositionCents / total * 100 : null,
    largestSymbol: largest?.symbol ?? null,
    note: 'Based on your virtual Practice positions at cost. Sentinel does not know your real holdings, and has no sector or industry data, so overlap with what you already own is unknown.',
  };
}

export function ideaCard(input: { kase: any; context: any; score: any; match: EventMatch; fit: PortfolioFit }) {
  const { kase, context: ctx, score, match } = input;
  const v2 = kase?.decision?.version === 'research-screen-v2', conclusion = String(kase?.conclusion ?? '');
  const topics: string[] = kase?.event?.analysis?.topics ?? [];
  const unknownChecks = (score?.checks ?? []).filter((c: any) => c.state === 'unknown');
  const failed = (kase?.rules ?? []).filter((r: any) => r && r.passed === false).map((r: any) => `${r.id} ${r.detail}`);

  // --- Sentinel's rule-based view ------------------------------------------------
  let label: string, text: string, tone: 'research' | 'watch' | 'wait' | 'doubt';
  if (match.level === 'name_conflict') { tone = 'doubt'; label = 'Probably not about this company'; text = match.reason + ' Treat everything below as unverified until you have read the original report.'; }
  else if (!v2) { tone = 'wait'; label = 'No judgment (older screen)'; text = 'This case was assessed with the first screen, which only checked that data existed. Sentinel does not form a view from it.'; }
  else if (conclusion === 'INVESTIGATE') { tone = 'research'; label = 'Worth your research time now'; text = 'It meets all three research rules: a material event, the company in a direct role, and a P/E between 0 and 30. That is a reason to read further, not a recommendation.'; }
  else if (conclusion === 'MONITOR') { tone = 'watch'; label = 'Watch, not a priority'; text = `The data is complete but it fails ${failed.length ? failed.join('; ') : 'at least one research rule'}.`; }
  else { tone = 'wait'; label = 'Not enough data to judge'; text = String(kase?.decision?.reason ?? kase?.reason ?? 'Required inputs are missing.'); }
  if (match.level === 'ticker_only' || match.level === 'named_in_summary') text += ` Company match is unconfirmed: ${match.reason}`;
  const uncertainty = score?.score === null || score?.score === undefined
    ? `Evidence is too thin to score: only ${score?.coverage ?? 0} of 100 checklist points could be checked.`
    : `Evidence ${score.score}/100 (${String(score.band ?? '').toLowerCase()}); ${unknownChecks.length} of ${(score.checks ?? []).length} checks could not be run${unknownChecks.length ? ': ' + unknownChecks.map((c: any) => c.label).join(', ') : ''}. The score counts evidence; it is not a chance of gain.`;

  // --- Why now -------------------------------------------------------------------
  const whyNow: Line[] = [];
  if (kase?.event?.headline) whyNow.push({ kind: 'reported_claim', text: kase.event.headline, detail: `${kase.event.source ?? 'Unknown source'}, published ${kase.event.publishedAt ?? 'at an unknown time'}. Headline and provider summary only; the article was not read.` });
  if (topics.length) whyNow.push({ kind: 'interpretation', text: `Sorted as: ${topics.join(', ')}.`, detail: topics.every(t => t === 'Analyst opinion') ? 'An analyst opinion is a view, not a company announcement.' : 'Keyword sorting of the headline, not a verified event.' });
  const role = kase?.identity?.relevance;
  if (role) whyNow.push({ kind: 'interpretation', text: role.level === 'direct_candidate' ? 'The headline wording puts the company in a direct role.' : 'The company’s role in this report is unclear.', detail: role.reason ?? null });

  // --- Evidence for / against ----------------------------------------------------
  const change = (r: any): string | null => r && r.changePct !== null ? `${r.label} ${pct(r.changePct)} vs ${r.comparison} (to ${r.latest?.period?.end ?? 'unknown'})` : null;
  const rows: any[] = [...(ctx?.business ?? [])];
  const evidenceFor: Line[] = [], counter: Line[] = [];
  for (const r of rows) { const t = change(r); if (!t) continue; const good = r.changePct > 0; (good ? evidenceFor : counter).push({ kind: 'computed', text: t, detail: `SEC filing ${r.latest?.source?.accession ?? 'unknown'}, filed ${String(r.latest?.sourceTime ?? 'unknown').slice(0, 10)}` }); }
  for (const s of ctx?.supports ?? []) evidenceFor.push({ kind: 'interpretation', text: s.text, detail: s.mustHold ? `Must hold: ${s.mustHold}` : null });
  for (const s of ctx?.risks ?? []) counter.push({ kind: 'interpretation', text: s.text, detail: s.wrongIf ? `Wrong if: ${s.wrongIf}` : null });
  const pe = kase?.price;
  if (pe?.status === 'indicative' && Number.isFinite(pe.ratio)) (pe.ratio > 0 && pe.ratio <= 30 ? evidenceFor : counter).push({ kind: 'computed', text: `P/E ${pe.ratio.toFixed(1)} (${pe.priceLabel ?? 'IEX midpoint'} ÷ last annual diluted EPS)`, detail: pe.basis === 'last_close' ? 'Uses the last daily close, not a live price. A low P/E alone is not evidence of value.' : 'A low P/E alone is not evidence of value.' });
  if (match.level !== 'named_in_headline') counter.unshift({ kind: 'interpretation', text: match.label + '.', detail: match.reason });
  counter.push({ kind: 'missing', text: 'The price may already reflect this news.', detail: 'Sentinel has no analyst expectations or guidance history. Load the price context below to see the move before and after the report.' });

  // --- Missing -------------------------------------------------------------------
  const missing: string[] = [
    'Upside or fair value: not estimated. Sentinel has no validated method for it and will not invent one.',
    'What the market expected before the report (consensus, prior guidance).',
    ...unknownChecks.map((c: any) => `${c.label}: ${c.detail}`),
    ...(ctx?.missing ?? []),
  ].filter((x, i, a) => a.indexOf(x) === i).slice(0, 12);

  return {
    version: IDEA_CARD_VERSION, caseId: kase?.id ?? null, symbol: kase?.symbol ?? null, company: kase?.identity?.name ?? null,
    security: { status: kase?.security?.status ?? 'unverified', text: kase?.security?.status === 'candidate_common' ? 'Ordinary US share (provider and SEC ticker agree); share basis not independently verified' : (kase?.security?.reason ?? 'Security type not verified') },
    eventMatch: match,
    ideaType: { type: 'Event-driven', horizon: 'Days to months. Outcomes are measured at 5, 20, 60 and 120 trading days against SPY.', note: 'Long-term theme research is not built yet, so every case today starts from a news report.' },
    view: { tone, label, text, uncertainty, basis: 'Fixed published rules (research-screen-v2, evidence-score-v1, event-match-v1). Not a forecast, a probability or advice to trade.' },
    whyNow, evidenceFor: evidenceFor.slice(0, 8), counter: counter.slice(0, 8), missing, nextChecks: (ctx?.nextChecks ?? []).slice(0, 5),
    fit: input.fit,
  };
}
