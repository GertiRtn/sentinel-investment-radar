/**
 * Three-way comparison (`decision-compare-v1`, 2026-11-16). Pure: no fetching, no storage, no trade.
 *
 * "What would acting change in this portfolio?" From one starting Practice state and one budget, three options are
 * computed the same way: keep the portfolio, add the stock, add SPY. Each shows cash remaining, estimated costs
 * (entry and exit separately), the direct weight of the stock, and the whole-portfolio result under the SAME stated
 * market scenarios (an SPY move applied through each holding's own measured beta).
 *
 * The scenarios are fixed hypothetical market moves, identical for all three options. They are approximations:
 * they do not capture company-specific events, liquidity shocks or concentration risk, and they are not forecasts.
 * A holding without enough price history has no beta, and then the option's scenarios are "unavailable":
 * a beta is never assumed.
 */
import { ols } from './market-model';

export const COMPARE_VERSION = 'decision-compare-v1';
export const COMPARE_POLICY = Object.freeze({ costBpsPerSide: 15, spyMoves: [-0.10, 0, 0.10], betaMaxDays: 252, betaMinDays: 120 });
export const SCENARIO_LABEL = 'Beta-based scenarios are approximations. They do not capture company-specific events, liquidity shocks or concentration risk.';

export type Beta = { beta: number; r2: number; days: number; from: string; to: string };
/** Beta from daily closes on matched dates: up to 252 returns, at least 120, OLS with intercept. Null when the history is too short. */
export function betaFromCloses(stock: Map<string, number> | null | undefined, spy: Map<string, number> | null | undefined): Beta | null {
  if (!stock || !spy) return null;
  const dates = [...stock.keys()].filter(d => spy.has(d)).sort(), x: number[] = [], y: number[] = [], used: string[] = [];
  for (let k = 1; k < dates.length; k++) { x.push(spy.get(dates[k])! / spy.get(dates[k - 1])! - 1); y.push(stock.get(dates[k])! / stock.get(dates[k - 1])! - 1); used.push(dates[k]); }
  const n = Math.min(x.length, COMPARE_POLICY.betaMaxDays);
  if (n < COMPARE_POLICY.betaMinDays) return null;
  const fit = ols(x.slice(-n), y.slice(-n));
  return fit ? { beta: fit.beta, r2: fit.r2, days: n, from: used[used.length - n], to: used[used.length - 1] } : null;
}

export type Holding = { symbol: string; valueCents: number | null };
export type Mandate = { reservePct: number; maxPositionPct: number } | null;
export type CompareInput = { symbol: string; budgetCents: number; cashCents: number; holdings: Holding[]; betas: Record<string, Beta | null | undefined>; mandate?: Mandate };
const fee = (cents: number) => Math.ceil(cents * COMPARE_POLICY.costBpsPerSide / 10_000);

export function compareDecision(i: CompareInput) {
  if (!Number.isSafeInteger(i.budgetCents) || i.budgetCents < 100) throw new Error('Budget must be at least $1.');
  if (!Number.isSafeInteger(i.cashCents) || i.cashCents < 0) throw new Error('Invalid cash.');
  const merged = new Map<string, number | null>();
  for (const h of i.holdings) { const p = merged.get(h.symbol); merged.set(h.symbol, merged.has(h.symbol) ? (p === null || h.valueCents === null ? null : p! + h.valueCents) : h.valueCents); }
  const unpriced = [...merged.entries()].filter(([, v]) => v === null).map(([s]) => s);
  const before = unpriced.length ? null : i.cashCents + [...merged.values()].reduce((s: number, v) => s + (v as number), 0);

  const option = (id: 'keep' | 'stock' | 'spy', label: string, add: string | null) => {
    const base = { id, label, add };
    if (add && i.budgetCents > i.cashCents) return { ...base, status: 'unavailable' as const, reason: `Not enough practice cash: the budget is $${(i.budgetCents / 100).toFixed(2)} and cash is $${(i.cashCents / 100).toFixed(2)}.` };
    const entry = add ? fee(i.budgetCents) : 0, invested = add ? i.budgetCents - entry : 0, exit = add ? fee(invested) : 0;
    const pos = new Map(merged); if (add) pos.set(add, pos.has(add) ? (pos.get(add) === null ? null : pos.get(add)! + invested) : invested);
    const cash = i.cashCents - (add ? i.budgetCents : 0);
    const total = before === null ? null : before - entry;
    const stockValue = pos.get(i.symbol) ?? 0;
    const weight = total === null || pos.get(i.symbol) === null ? null : total > 0 ? stockValue / total * 100 : 0;
    const noBeta = [...pos.keys()].filter(s => s !== 'SPY' && !i.betas[s]);
    const why = unpriced.length ? `No current price for ${unpriced.join(', ')}.` : noBeta.length ? `Not enough price history to measure a beta for ${noBeta.join(', ')} (at least ${COMPARE_POLICY.betaMinDays} matched days are needed).` : null;
    const scenarios = COMPARE_POLICY.spyMoves.map(m => {
      if (why) return { spyMove: m, status: 'unavailable' as const, reason: why };
      const value = cash + [...pos.entries()].reduce((s, [sym, v]) => s + Math.round(v! * (1 + (sym === 'SPY' ? 1 : i.betas[sym]!.beta) * m)), 0);
      return { spyMove: m, status: 'computed' as const, valueCents: value, changeCents: value - before!, changePct: (value - before!) / before! * 100 };
    });
    const m = i.mandate ?? null;
    const mandate = !m ? { status: 'none' as const, text: 'No mandate set: no cash reserve or position limit is configured for Practice.' }
      : total === null || weight === null ? { status: 'unavailable' as const, text: 'Mandate check unavailable: a holding has no current price.' }
      : { status: 'checked' as const, reserveOk: cash / total * 100 >= m.reservePct, positionOk: Math.max(...[...pos.values()].map(v => v! / total * 100), 0) <= m.maxPositionPct, text: `Cash reserve ${m.reservePct}% and largest position ${m.maxPositionPct}% (your mandate).` };
    return { ...base, status: 'computed' as const, cashAfterCents: cash, costs: { entryCents: entry, exitCents: exit, note: add ? `${COMPARE_POLICY.costBpsPerSide / 100}% of the trade value on each side, modeled. Exit is estimated at today's value.` : 'No trade, no cost.' },
      investedCents: invested, totalAfterCents: total, stockWeightPct: weight, positions: pos.size, scenarios, mandate };
  };

  return {
    version: COMPARE_VERSION, symbol: i.symbol, budgetCents: i.budgetCents,
    start: { cashCents: i.cashCents, holdings: [...merged.entries()].map(([symbol, valueCents]) => ({ symbol, valueCents })), totalCents: before },
    options: [option('keep', 'Keep the portfolio', null), option('stock', `Add ${i.symbol}`, i.symbol), option('spy', 'Add SPY', 'SPY')],
    betas: Object.fromEntries([...new Set([...merged.keys(), i.symbol])].filter(s => s !== 'SPY').map(s => [s, i.betas[s] ?? null])),
    scenarioLabel: SCENARIO_LABEL, scenarioMethod: 'Each holding moves by its measured beta × the SPY move; SPY moves by the SPY move; cash is unchanged. The same three SPY moves are applied to every option.',
    es95: { status: 'not_computed' as const, text: '20-session expected shortfall: not computed in this version.' },
    note: 'Virtual Practice positions only. A comparison of fixed hypothetical scenarios, not a forecast and not advice. Nothing is traded or stored by this comparison.',
  };
}
