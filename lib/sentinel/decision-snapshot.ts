/**
 * Decision snapshot and review (`decision-snapshot-v1`, 2026-11-16). Pure: no fetching, no storage.
 *
 * A snapshot freezes what was known and computed when the owner looked at a decision: the price, the implied
 * expectations, the Practice state, the three alternatives and one dated checkpoint with a specific condition
 * chosen from fixed templates. It is stored once and never changed. A review is computed later, stored as its own
 * record, and answers three separate questions that are never merged into one right/wrong:
 *   1. Did the business expectation materialize? (the checkpoint condition, from a filing made after the snapshot)
 *   2. Did the investment perform? (the stock since the snapshot, net of modeled costs)
 *   3. Did it do better than the alternatives after costs? (against SPY and against keeping the portfolio)
 * A stock can rise while the thesis fails, or fall while the thesis held. "Not yet" and "unavailable" are answers.
 */
import type { Figure } from './financial';

export const SNAPSHOT_VERSION = 'decision-snapshot-v1';
export const REVIEW_VERSION = 'decision-review-v1';
export const COST_BPS_PER_SIDE = 15;
export const CHECKPOINT_DAYS = 100; // one quarterly reporting cycle plus filing time
const DAY = 86_400_000, C = COST_BPS_PER_SIDE / 10_000;

export const CHECKPOINTS = {
  quarterly_revenue_yoy: 'Next filing: reported quarterly revenue at or above the same quarter a year earlier.',
  quarterly_net_income_positive: 'Next filing: reported quarterly net income above zero.',
  annual_cash_flow_positive: 'Next annual filing: operating cash flow minus capital expenditure above zero.',
} as const;
export type CheckpointId = keyof typeof CHECKPOINTS;
export const isCheckpoint = (x: unknown): x is CheckpointId => typeof x === 'string' && x in CHECKPOINTS;

const latestEnd = (figs: Figure[], metric: string, by: string) => figs.filter(f => f.metric === metric && f.value !== null && f.known_from !== null && f.known_from <= by).map(f => f.period_end).sort().at(-1) ?? null;
/** What the checkpoint is measured from: the latest periods already filed when the snapshot was saved. */
export function checkpointFor(id: CheckpointId, savedAt: string, annual: Figure[], quarterly: Figure[]) {
  return { template: id, condition: CHECKPOINTS[id], dueBy: new Date(Date.parse(savedAt) + CHECKPOINT_DAYS * DAY).toISOString().slice(0, 10),
    baseline: { latestQuarterEnd: latestEnd(quarterly, id === 'quarterly_net_income_positive' ? 'net_income' : 'revenue', savedAt), latestAnnualEnd: latestEnd(annual, 'cfo', savedAt) },
    note: 'Checked against the first filing made after this snapshot that reports a later period. Fixed template; no model text.' };
}

type Thesis = { status: 'met' | 'not_met' | 'not_yet' | 'overdue' | 'unavailable'; text: string; waitingFor?: string; evidence?: { periodEnd: string; value: number; compared?: { periodEnd: string; value: number } | null; accession: string | null; filed: string | null } };
/** Which filing the checkpoint waits for, in words. */
export function waitingForText(cp: ReturnType<typeof checkpointFor>, savedAt: string) {
  const d = savedAt.slice(0, 10);
  if (cp.template === 'annual_cash_flow_positive') return `a 10-K filed after ${d} reporting a fiscal year that ends after ${cp.baseline.latestAnnualEnd ?? 'the latest year on file'}.`;
  return `a 10-Q filed after ${d} reporting a quarter that ends after ${cp.baseline.latestQuarterEnd ?? 'the latest quarter on file'}. A fourth quarter reported only in a 10-K does not count: it is not a separate three-month figure.`;
}
export function evaluateCheckpoint(cp: ReturnType<typeof checkpointFor>, savedAt: string, now: string, annual: Figure[], quarterly: Figure[]): Thesis {
  const later = (figs: Figure[], metric: string, after: string | null) => figs.filter(f => f.metric === metric && f.value !== null && f.known_from !== null && f.known_from > savedAt && f.known_from <= now && (!after || f.period_end > after)).sort((a, b) => a.period_end.localeCompare(b.period_end))[0] ?? null;
  const ev = (f: Figure, compared: Figure | null = null) => ({ periodEnd: f.period_end, value: f.value!, compared: compared ? { periodEnd: compared.period_end, value: compared.value! } : null, accession: f.inputs[0]?.accession ?? null, filed: f.inputs[0]?.filed ?? null });
  const waitingFor = waitingForText(cp, savedAt);
  const overdue = Date.parse(cp.dueBy + 'T23:59:59.999Z') < Date.parse(now);
  // Overdue: the due date has passed with no qualifying filing. It is not a "no": the filing may still come.
  const notYet: Thesis = overdue
    ? { status: 'overdue', text: `Overdue: no qualifying filing by the due date (${cp.dueBy}). Waiting for: ${waitingFor}`, waitingFor }
    : { status: 'not_yet', text: `Not yet: no filing made after this snapshot reports a later period. Waiting for: ${waitingFor}`, waitingFor };
  if (cp.template === 'quarterly_revenue_yoy') {
    const f = later(quarterly, 'revenue', cp.baseline.latestQuarterEnd); if (!f) return notYet;
    const prior = quarterly.find(p => p.metric === 'revenue' && p.value !== null && Math.abs((Date.parse(f.period_end) - Date.parse(p.period_end)) / DAY - 365) <= 12) ?? null;
    if (!prior) return { status: 'unavailable', text: 'Unavailable: the same quarter a year earlier is not reported as a separate three-month figure.', evidence: ev(f) };
    return { status: f.value! >= prior.value! ? 'met' : 'not_met', text: `Quarter to ${f.period_end}: revenue ${f.value! >= prior.value! ? 'at or above' : 'below'} the quarter to ${prior.period_end}.`, evidence: ev(f, prior) };
  }
  if (cp.template === 'quarterly_net_income_positive') {
    const f = later(quarterly, 'net_income', cp.baseline.latestQuarterEnd); if (!f) return notYet;
    return { status: f.value! > 0 ? 'met' : 'not_met', text: `Quarter to ${f.period_end}: net income ${f.value! > 0 ? 'above' : 'at or below'} zero.`, evidence: ev(f) };
  }
  const cfo = later(annual, 'cfo', cp.baseline.latestAnnualEnd); if (!cfo) return notYet;
  const capex = annual.find(p => p.metric === 'capex' && p.period_end === cfo.period_end && p.value !== null && p.confidence === 'reported') ?? null;
  if (!capex || cfo.confidence !== 'reported') return { status: 'unavailable', text: 'Unavailable: capital expenditure is not reported for the same annual period.', evidence: ev(cfo) };
  const v = cfo.value! - capex.value!;
  return { status: v > 0 ? 'met' : 'not_met', text: `Year to ${cfo.period_end}: operating cash flow minus capital expenditure ${v > 0 ? 'above' : 'at or below'} zero.`, evidence: { ...ev(cfo), value: v } };
}

/** Return after 15 bp on entry and 15 bp on exit. */
export const netOfCosts = (gross: number) => (1 - C) * (1 + gross) * (1 - C) - 1;

/**
 * Performance from the snapshot's price date to the latest completed close, from one adjusted daily series per
 * symbol (so dividends and splits are treated alike on both dates). Keeping the portfolio means the budget stays in cash.
 */
export function performance(entryDate: string | null, budgetCents: number, stock: Record<string, number> | null, spy: Record<string, number> | null) {
  const una = (text: string) => ({ investment: { status: 'unavailable' as const, text }, alternatives: { status: 'unavailable' as const, text } });
  if (!entryDate) return una('Unavailable: the snapshot has no price date.');
  if (!stock || !spy) return una('Unavailable: daily prices could not be read.');
  const exitDate = Object.keys(stock).filter(d => d > entryDate && spy[d] > 0).sort().at(-1);
  if (!exitDate) { const t = 'Not yet: no session has closed since the snapshot’s price.'; return { investment: { status: 'not_yet' as const, text: t }, alternatives: { status: 'not_yet' as const, text: t } }; }
  if (!(stock[entryDate] > 0) || !(spy[entryDate] > 0)) return una(`Unavailable: no IEX close for the stock and SPY on ${entryDate}.`);
  const sg = stock[exitDate] / stock[entryDate] - 1, mg = spy[exitDate] / spy[entryDate] - 1, sn = netOfCosts(sg), mn = netOfCosts(mg);
  const cents = (r: number) => Math.round(budgetCents * r);
  return {
    investment: { status: 'computed' as const, entryDate, exitDate, grossReturn: sg, netReturn: sn, resultCents: cents(sn), text: `From the close on ${entryDate} to the close on ${exitDate}, after ${COST_BPS_PER_SIDE} bp on each side.` },
    alternatives: { status: 'computed' as const, entryDate, exitDate,
      stock: { netReturn: sn, resultCents: cents(sn) }, spy: { grossReturn: mg, netReturn: mn, resultCents: cents(mn) }, keep: { netReturn: 0, resultCents: 0, note: 'The budget stays in cash.' },
      stockMinusSpy: sn - mn, stockMinusKeep: sn, text: 'Same dates, same modeled costs, same budget. Adjusted IEX daily closes.' },
  };
}

export function reviewSnapshot(input: { snapshot: any; now: string; secError?: string | null; annual: Figure[] | null; quarterly: Figure[] | null; stock: Record<string, number> | null; spy: Record<string, number> | null }) {
  const s = input.snapshot, perf = performance(s.price?.sessionDate ?? null, s.budgetCents, input.stock, input.spy);
  const business: Thesis = !input.annual || !input.quarterly ? { status: 'unavailable', text: 'Unavailable: ' + (input.secError ?? 'the company’s SEC figures could not be read.') } : evaluateCheckpoint(s.checkpoint, s.savedAt, input.now, input.annual, input.quarterly);
  return { version: REVIEW_VERSION, snapshotId: s.id ?? null, reviewedAt: input.now,
    business: { question: 'Did the business expectation materialize?', condition: s.checkpoint.condition, dueBy: s.checkpoint.dueBy, ...business },
    investment: { question: 'Did the investment perform?', ...perf.investment },
    alternatives: { question: 'Did it do better than the alternatives after costs?', ...perf.alternatives },
    note: 'Three separate results. A stock can rise while the thesis fails, or fall while the thesis held. Virtual; not advice.' };
}

/**
 * What was on screen vs what was saved (2026-11-16). The snapshot is always recalculated on the server when Save is
 * pressed; the comparison the browser showed is used only to say whether any figure changed in between. It is never
 * stored and never replaces a saved value. Compared: the budget, the starting portfolio total, and for each option its
 * status, cash after, entry and exit costs, invested amount, stock weight (to 0.1 point) and the value under each
 * market scenario.
 */
export type SavedCheck = { status: 'matches' | 'differs' | 'not_checked'; text: string; shownPreparedAt: string | null; differences: { option: string; field: string; shown: unknown; saved: unknown }[] };
const FIELDS: [string, (o: any) => unknown][] = [
  ['status', o => o?.status ?? null], ['cash after', o => o?.cashAfterCents ?? null], ['cost to enter', o => o?.costs?.entryCents ?? null], ['cost to exit (estimate)', o => o?.costs?.exitCents ?? null],
  ['invested', o => o?.investedCents ?? null], ['stock weight', o => (typeof o?.stockWeightPct === 'number' ? Math.round(o.stockWeightPct * 10) / 10 : null)],
];
export function compareShownToSaved(shown: any, saved: any): SavedCheck {
  if (!shown || typeof shown !== 'object' || !Array.isArray(shown.options)) return { status: 'not_checked', text: 'No on-screen comparison was sent, so the saved values could not be checked against it.', shownPreparedAt: null, differences: [] };
  const d: SavedCheck['differences'] = [], push = (option: string, field: string, a: unknown, b: unknown) => { if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) d.push({ option, field, shown: a ?? null, saved: b ?? null }); };
  push('all', 'budget', shown.budgetCents, saved?.budgetCents);
  push('all', 'starting portfolio', shown.start?.totalCents, saved?.start?.totalCents);
  const byId = (c: any) => new Map((Array.isArray(c?.options) ? c.options : []).map((o: any) => [String(o?.id), o]));
  const a = byId(shown), b = byId(saved);
  for (const id of new Set([...a.keys(), ...b.keys()]) as Set<string>) {
    const x: any = a.get(id), y: any = b.get(id), label = String(y?.label ?? x?.label ?? id);
    for (const [field, get] of FIELDS) push(label, field, get(x), get(y));
    const moves = new Set([...(x?.scenarios ?? []), ...(y?.scenarios ?? [])].map((s: any) => s?.spyMove));
    for (const m of moves) {
      const sx = x?.scenarios?.find((s: any) => s?.spyMove === m), sy = y?.scenarios?.find((s: any) => s?.spyMove === m);
      push(label, `if SPY moves ${m > 0 ? '+' : ''}${Math.round(m * 100)}%`, sx?.status === 'computed' ? sx.valueCents : sx?.status ?? null, sy?.status === 'computed' ? sy.valueCents : sy?.status ?? null);
    }
  }
  return d.length
    ? { status: 'differs', text: `${d.length} figure${d.length === 1 ? '' : 's'} changed between the comparison on screen and the moment you pressed save. The saved values are the recalculated ones.`, shownPreparedAt: typeof shown.preparedAt === 'string' ? shown.preparedAt : null, differences: d }
    : { status: 'matches', text: 'Every figure matches the comparison that was on screen.', shownPreparedAt: typeof shown.preparedAt === 'string' ? shown.preparedAt : null, differences: [] };
}
