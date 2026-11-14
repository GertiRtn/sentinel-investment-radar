// Market model for one stock around one event (`market-model-v1`). Pure: no network, no database.
//
// 1. Market sensitivity: ordinary least squares on matched daily returns,
//      r_stock(t) = alpha + beta · r_SPY(t) + e(t)
//    estimated on up to 252 matched return days ending at the last close before publication
//    (at least 120 required). Daily simple close-to-close returns on dates where BOTH have a completed bar;
//    a return always spans the same two dates for the stock and SPY.
// 2. Event move: for matched sessions after that close (1, 5 and 20 when available),
//      stock move      S = Π(1 + r_stock) − 1                       (compounded)
//      market move     M = Π(1 + r_SPY) − 1
//      expected move   E = Π(1 + beta · r_SPY) − 1                  (beta only: the intercept is NOT used, because
//                                                                     a past average drift is not a market-based expectation)
//      market-adjusted A = S − E
//    Also reported, for transparency: the version that includes the intercept (E_alpha, A_alpha), the standard
//    cumulative abnormal return CAR = Σ (r_stock − alpha − beta·r_SPY), and the existing simple S − M.
//
// Gross: no trading costs. Prices are Alpaca IEX bars with adjustment "all" (splits and dividends), so returns
// approximate total return as adjusted when fetched. A regression describes the past; it is not a forecast,
// a probability or evidence that the event caused the move.

import { nyDate, closeInstant } from './case-context';

export const MARKET_MODEL_VERSION = 'market-model-v1';
export const ESTIMATION = { maxDays: 252, minDays: 120, minCoverage: 0.9, maxStaleSessions: 3 };
export const HORIZONS = [1, 5, 20] as const;

type Closes = Map<string, number>;

/** Completed, positive closes by New York session date. A session that had not closed when fetched is dropped. */
export function closesOf(payload: any, fetchedAt: string): Closes {
  const m: Closes = new Map();
  for (const b of Array.isArray(payload?.bars) ? payload.bars : []) {
    if (typeof b?.t !== 'string' || !Number.isFinite(Date.parse(b.t)) || typeof b.c !== 'number' || !Number.isFinite(b.c) || !(b.c > 0)) continue;
    const d = nyDate(b.t);
    if (closeInstant(d) > fetchedAt) continue;
    m.set(d, b.c);
  }
  return m;
}

export type Fit = { alpha: number; beta: number; r2: number; betaSe: number; n: number; residualSd: number };
/** OLS with intercept. Null when there are fewer than 3 points or the market returns have (near) zero variance. */
export function ols(x: number[], y: number[]): Fit | null {
  const n = x.length;
  if (n < 3 || n !== y.length) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  if (!(sxx > 1e-12)) return null;
  const beta = sxy / sxx, alpha = my - beta * mx;
  let ssr = 0;
  for (let i = 0; i < n; i++) { const e = y[i] - alpha - beta * x[i]; ssr += e * e; }
  const r2 = syy > 0 ? Math.max(0, Math.min(1, 1 - ssr / syy)) : 0;
  const residualSd = Math.sqrt(ssr / (n - 2));
  return { alpha, beta, r2, betaSe: residualSd / Math.sqrt(sxx), n, residualSd };
}

/** Plain-English description of the fit. "Most" is said only when R² > 0.5. */
export function fitWords(r2: number) {
  const pct = Math.round(r2 * 100);
  if (r2 > 0.5) return `Most of its day-to-day movement (about ${pct}%) lined up with the market.`;
  if (r2 >= 0.2) return `Some of its day-to-day movement (about ${pct}%) lined up with the market; the rest was specific to the stock.`;
  return `Little of its day-to-day movement (about ${pct}%) lined up with the market; most was specific to the stock.`;
}
export function betaWords(beta: number) {
  const b = Math.abs(beta) < 0.05 ? '0' : beta.toFixed(1);
  if (beta < 0) return `Over this period the stock tended to move the opposite way to the market: about ${b}% for each 1% move in SPY, on average.`;
  return `Over this period the stock tended to move about ${b}% for each 1% move in the market (SPY), on average.`;
}

export function marketModel(input: { stock: any; spy: any; symbol: string; publishedAt: string | null; caseAt: string; fetchedAt: string; source: string; adjustment: string; rawIds: string[] }) {
  const base = { version: MARKET_MODEL_VERSION, symbol: input.symbol, source: input.source, adjustment: input.adjustment, fetchedAt: input.fetchedAt, rawIds: input.rawIds,
    basis: 'Gross, before any trading costs. Prices adjusted for splits and dividends as known when fetched, so returns approximate total return.',
    limits: ['IEX is a single exchange; its closes can differ from the consolidated close.', 'Beta and fit describe one past period and change over time. They are not a forecast.', 'A market-adjusted move is not evidence that the event caused it: other news, the sector and chance also move prices.'],
    peers: peerComparison() };
  const unavailable = (reason: string, needed: string) => ({ ...base, status: 'unavailable' as const, reason, needed, sensitivity: null, event: null });
  if (input.adjustment !== 'all') return unavailable('The stock and market prices are not on the same adjustment basis.', 'Bars adjusted for splits and dividends for both series.');
  if (!input.publishedAt || !Number.isFinite(Date.parse(input.publishedAt))) return unavailable('The event has no valid publication time.', 'A publication time.');
  const s = closesOf(input.stock, input.fetchedAt), m = closesOf(input.spy, input.fetchedAt);
  const spyDays = [...m.keys()].sort(), days = spyDays.filter(d => s.has(d));
  const lastPre = days.filter(d => closeInstant(d) < input.publishedAt!).at(-1);
  if (!lastPre) return unavailable('No completed session before the event in the fetched prices.', 'Daily prices from before the event.');
  // Stale: the stock's last bar before the event must be within a few SPY sessions of the market's last pre-event close.
  const spyLastPre = spyDays.filter(d => closeInstant(d) < input.publishedAt!).at(-1)!;
  const staleBy = spyDays.indexOf(spyLastPre) - spyDays.indexOf(lastPre);
  if (staleBy > ESTIMATION.maxStaleSessions) return unavailable(`The stock's last price before the event is ${staleBy} sessions older than the market's.`, 'Recent stock prices up to the event.');

  // Estimation: matched daily returns ending at lastPre (inclusive), at most 252 of them.
  const i = days.indexOf(lastPre), startIdx = Math.max(1, i - ESTIMATION.maxDays + 1);
  const xs: number[] = [], ys: number[] = [];
  for (let k = startIdx; k <= i; k++) { const a = days[k - 1], b = days[k]; xs.push(m.get(b)! / m.get(a)! - 1); ys.push(s.get(b)! / s.get(a)! - 1); }
  const from = days[startIdx - 1], to = lastPre;
  const spySessions = spyDays.filter(d => d > from && d <= to).length, coverage = spySessions ? xs.length / spySessions : 0;
  if (xs.length < ESTIMATION.minDays) return unavailable(`Only ${xs.length} matched trading days before the event; at least ${ESTIMATION.minDays} are needed.`, `At least ${ESTIMATION.minDays} days of stock and SPY prices before the event.`);
  if (coverage < ESTIMATION.minCoverage) return unavailable(`The stock has prices on only ${Math.round(coverage * 100)}% of market sessions in the window.`, 'Prices on at least 90% of market sessions.');
  const fit = ols(xs, ys);
  if (!fit) return unavailable('The market returns in the window have no variation, so a sensitivity cannot be estimated.', 'Varying market returns.');

  const sensitivity = { ...fit, from, to, matchedDays: xs.length, marketSessions: spySessions, missingSessions: spySessions - xs.length, knownAtAssessment: closeInstant(to) <= input.caseAt,
    betaText: betaWords(fit.beta), fitText: fitWords(fit.r2), alphaDailyPct: fit.alpha * 100,
    note: 'Estimated only from prices before the event. Includes an intercept (alpha); beta ±1.96 standard errors gives a rough range.', betaLow: fit.beta - 1.96 * fit.betaSe, betaHigh: fit.beta + 1.96 * fit.betaSe };

  // Event window: matched sessions after lastPre.
  const after = days.slice(i + 1);
  const horizons = HORIZONS.filter(h => h <= after.length).map(h => {
    let S = 1, M = 1, E = 1, Ea = 1, car = 0;
    for (let k = 0; k < h; k++) {
      const a = k === 0 ? lastPre : after[k - 1], b = after[k];
      const rs = s.get(b)! / s.get(a)! - 1, rm = m.get(b)! / m.get(a)! - 1;
      S *= 1 + rs; M *= 1 + rm; E *= 1 + fit.beta * rm; Ea *= 1 + fit.alpha + fit.beta * rm; car += rs - fit.alpha - fit.beta * rm;
    }
    const end = after[h - 1], pct = (v: number) => (v - 1) * 100;
    return { sessions: h, from: lastPre, to: end, stockPct: pct(S), marketPct: pct(M), expectedPct: pct(E), adjustedPct: pct(S) - pct(E),
      withAlpha: { expectedPct: pct(Ea), adjustedPct: pct(S) - pct(Ea) }, carPct: car * 100, simpleVsSpyPct: pct(S) - pct(M),
      laterInformation: closeInstant(end) > input.caseAt };
  });
  const event = { lastCloseBeforeEvent: lastPre, publishedAt: input.publishedAt, assessedAt: input.caseAt, sessionsAvailable: after.length, horizons,
    note: horizons.length ? 'Measured after the event; marked as later information when it closed after Sentinel assessed the case.' : 'No completed session after the event yet.' };
  return { ...base, status: 'ok' as const, reason: null, needed: null, sensitivity, event };
}

/** Peer comparison is not offered: audited 2026-11-14, see docs/HANDOFF.md. */
export function peerComparison() {
  return { status: 'unavailable' as const,
    reason: 'Sentinel has no dated list of comparable companies.',
    needed: 'A peer list as it stood on the event date, and archived prices for each peer over the same days. Sentinel stores only today’s SEC industry code, and only for companies it has looked at.' };
}
