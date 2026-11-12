/**
 * Offline, point-in-time event backtest (event-backtest-v1). RESEARCH ONLY.
 *
 * Not wired to any route, UI, schedule or live decision. It replays dated
 * events against daily bars supplied by the caller (fixtures today) and
 * reports what a rule would have done, next to SPY with the same dollars.
 * It makes no claim about historical profitability: Sentinel's real cases
 * have only been collected prospectively, and historical news timestamps
 * have not been independently verified.
 *
 * Timing rules (the order of clocks):
 *   published → first observed → assessed (signal) → order → fill → exit.
 *   An order is placed at the signal time plus `latencyMinutes`, and fills at
 *   the OPEN of the first daily bar that starts at or after the order time —
 *   never on a bar that began before the information existed.
 * Costs, all explicit: half the assumed spread on each side, a fee in basis
 * points on each side, plus slippage in basis points. A missing entry or exit
 * bar is a rejected fill, reported, never filled at a guessed price.
 * Prices must be on one adjustment basis; the engine does not adjust.
 */
export const BACKTEST_VERSION = 'event-backtest-v1';

export type Bar = { date: string; open: number; close: number }; // date = session date YYYY-MM-DD; open at SESSION_OPEN_UTC
export type BacktestEvent = { id: string; symbol: string; publishedAt: string; firstObservedAt: string; assessedAt: string; signal: boolean };
export type Assumptions = { latencyMinutes: number; holdSessions: number; spreadBps: number; feeBps: number; slippageBps: number; notional: number; sessionOpenUtc: string };
export const DEFAULT_ASSUMPTIONS: Assumptions = { latencyMinutes: 15, holdSessions: 20, spreadBps: 10, feeBps: 5, slippageBps: 5, notional: 1000, sessionOpenUtc: '14:30' };

export type Trade = {
  eventId: string; symbol: string; status: 'filled' | 'rejected' | 'skipped'; reason: string | null;
  orderAt: string | null; entryDate: string | null; exitDate: string | null;
  entryPrice: number | null; exitPrice: number | null; costs: number | null;
  netReturnPct: number | null; spyReturnPct: number | null; vsSpyPct: number | null;
};

const openTime = (date: string, a: Assumptions) => `${date}T${a.sessionOpenUtc}:00.000Z`;

/** First bar whose open is at or after `t`. */
function firstBarAtOrAfter(bars: Bar[], t: string, a: Assumptions) {
  const i = bars.findIndex(b => openTime(b.date, a) >= t);
  return i < 0 ? null : i;
}

export function runBacktest(events: BacktestEvent[], bars: Record<string, Bar[]>, a: Assumptions = DEFAULT_ASSUMPTIONS) {
  const problems: string[] = [];
  for (const [s, list] of Object.entries(bars)) for (let i = 1; i < list.length; i++) if (list[i].date <= list[i - 1].date) problems.push(`${s}: bars out of order at ${list[i].date}`);
  if (problems.length) throw new Error('Invalid bar series: ' + problems.join('; '));
  const spy = bars.SPY ?? [];
  const side = (a.spreadBps / 2 + a.feeBps + a.slippageBps) / 10000;
  const trades: Trade[] = [...events].sort((x, y) => x.assessedAt.localeCompare(y.assessedAt) || x.id.localeCompare(y.id)).map(e => {
    const t: Trade = { eventId: e.id, symbol: e.symbol, status: 'skipped', reason: null, orderAt: null, entryDate: null, exitDate: null, entryPrice: null, exitPrice: null, costs: null, netReturnPct: null, spyReturnPct: null, vsSpyPct: null };
    if (!(e.publishedAt <= e.firstObservedAt && e.firstObservedAt <= e.assessedAt)) { t.reason = 'clocks out of order (published ≤ observed ≤ assessed required)'; return t; }
    if (!e.signal) { t.reason = 'no signal'; return t; }
    const orderAt = new Date(Date.parse(e.assessedAt) + a.latencyMinutes * 60000).toISOString();
    t.orderAt = orderAt;
    const list = bars[e.symbol] ?? [], i = firstBarAtOrAfter(list, orderAt, a);
    if (i === null) { t.status = 'rejected'; t.reason = 'no bar after the order time'; return t; }
    const j = i + a.holdSessions;
    if (j >= list.length) { t.status = 'rejected'; t.reason = `fewer than ${a.holdSessions} sessions after entry`; return t; }
    const si = spy.findIndex(b => b.date === list[i].date), sj = spy.findIndex(b => b.date === list[j].date);
    if (si < 0 || sj < 0) { t.status = 'rejected'; t.reason = 'SPY has no matching entry or exit session'; return t; }
    const entry = list[i].open * (1 + side), exit = list[j].open * (1 - side);
    const shares = a.notional / entry;
    Object.assign(t, {
      status: 'filled', entryDate: list[i].date, exitDate: list[j].date, entryPrice: entry, exitPrice: exit,
      costs: shares * (list[i].open * side + list[j].open * side),
      netReturnPct: (exit / entry - 1) * 100,
      // Benchmark pays the same costs, so the comparison isolates selection.
      spyReturnPct: ((spy[sj].open * (1 - side)) / (spy[si].open * (1 + side)) - 1) * 100,
    });
    t.vsSpyPct = t.netReturnPct! - t.spyReturnPct!;
    return t;
  });
  const filled = trades.filter(t => t.status === 'filled');
  const gaps = filled.map(t => t.vsSpyPct!).sort((x, y) => x - y), m = gaps.length;
  return {
    version: BACKTEST_VERSION, assumptions: a, trades,
    summary: { events: events.length, signals: events.filter(e => e.signal).length, filled: m, rejected: trades.filter(t => t.status === 'rejected').length,
      medianVsSpyPct: m ? (m % 2 ? gaps[(m - 1) / 2] : (gaps[m / 2 - 1] + gaps[m / 2]) / 2) : null, beatSpy: filled.filter(t => t.vsSpyPct! > 0).length },
    caveats: ['Fixture or supplied bars only; not a claim about historical profitability.', 'Single adjustment basis assumed; splits/dividends are not adjusted here.', 'Delistings and point-in-time universe membership are not modelled.', 'No market calendar beyond the bars supplied.'],
  };
}
