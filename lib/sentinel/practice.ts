/**
 * Practice portfolio v2: virtual $10,000, live-marked, benchmarked against SPY.
 *
 * Pure: the API loads records and prices, this shapes them. Records are
 * append-only `practice_trade`, `practice_review` and `practice_mark` rows in
 * signal_log (invariant 1).
 *  - Prices are never typed by the user: open and close use a recorded IEX quote
 *    midpoint fetched by the server, with its raw-event id and time.
 *  - Every open also records the SPY price, so each position carries its own
 *    benchmark: the same dollars put into SPY at the same moment.
 *  - Conviction (0–100) is the user's own judgement, recorded before the outcome
 *    (invariant 5). The evidence score is copied from the stored case.
 *  - Returns are gross (no fees, taxes or slippage) and say so.
 */
import { scoreBand } from './evidence-score';

export const PRACTICE_VERSION = 'practice-v2';
export const PRACTICE_START_CENTS = 1_000_000; // $10,000
export const REVIEW_MILESTONES = [{ days: 7, label: '1 week' }, { days: 30, label: '1 month' }, { days: 90, label: '3 months' }] as const;
const DAY = 86400000;

export type PriceRef = { priceCents: number; at: string; rawEventId: string; source: string };
export type PracticeOpen = {
  version: typeof PRACTICE_VERSION; action: 'open'; sequence: number; positionId: string; symbol: string;
  amountCents: number; quantityMicros: number; price: PriceRef; spy: PriceRef;
  thesis: string; exitPlan: string; killCondition: string; conviction: number;
  caseId: string | null; evidenceScore: number | null; createdAt: string;
};
export type PracticeClose = {
  version: typeof PRACTICE_VERSION; action: 'close'; sequence: number; positionId: string; symbol: string;
  price: PriceRef; spy: PriceRef; reason: string; createdAt: string;
};
export type PracticeTrade = PracticeOpen | PracticeClose;
export type PracticeReview = { positionId: string; milestone: number; decision: 'keep' | 'close' | 'pass'; note: string; createdAt: string };
export type PracticeMark = { date: string; equityCents: number; benchmarkCents: number; at: string };
export type LivePrice = PriceRef & { stale: boolean };

const ret = (from: number, to: number) => (from > 0 ? (to - from) / from * 100 : null);
const value = (qtyMicros: number, priceCents: number) => Math.round(qtyMicros * priceCents / 1_000_000);
export const convictionBand = (c: number) => (c >= 70 ? 'High (70–100)' : c >= 40 ? 'Medium (40–69)' : 'Low (0–39)');

export function validateOpen(input: { amountCents: number; conviction: number; thesis: string; exitPlan: string; killCondition: string }, cashCents: number) {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 100) return 'Enter an amount of at least $1.';
  if (input.amountCents > cashCents) return 'Not enough practice cash for this amount.';
  if (!Number.isInteger(input.conviction) || input.conviction < 0 || input.conviction > 100) return 'Conviction must be a whole number from 0 to 100.';
  return null;
}

/** A quote can price a practice trade when it is a sane, recorded IEX quote. Closed-market quotes are allowed and labelled. */
export function priceFromQuote(q: any, nowIso: string): PriceRef | string {
  if (!q || !Number.isFinite(q.bid) || !Number.isFinite(q.ask) || q.bid <= 0 || q.ask < q.bid || !q.rawEventId) return 'No usable IEX quote is available for this symbol.';
  const mid = (q.bid + q.ask) / 2, spread = (q.ask - q.bid) / mid;
  if (spread > 0.02) return 'The IEX quote spread is wider than 2%, so the price is unreliable. Try again during market hours.';
  const age = Date.parse(nowIso) - Date.parse(q.sourceTime);
  if (!Number.isFinite(age) || age < 0 || age > 5 * DAY) return 'The latest IEX quote is too old to price a trade.';
  return { priceCents: Math.round(mid * 100), at: q.sourceTime, rawEventId: q.rawEventId, source: 'IEX midpoint' };
}

export function practiceState(input: { trades: PracticeTrade[]; reviews: PracticeReview[]; marks: PracticeMark[]; live: Record<string, LivePrice | null>; now: string }) {
  const opens = new Map<string, PracticeOpen>(), closes = new Map<string, PracticeClose>();
  let cash = PRACTICE_START_CENTS;
  for (const t of [...input.trades].sort((a, b) => a.sequence - b.sequence)) {
    if (t.action === 'open') { opens.set(t.positionId, t); cash -= t.amountCents; }
    else { const o = opens.get(t.positionId); if (o && !closes.has(t.positionId)) { closes.set(t.positionId, t); cash += value(o.quantityMicros, t.price.priceCents); } }
  }
  const spyNow = input.live.SPY ?? null;
  const positions = [...opens.values()].map(o => {
    const c = closes.get(o.positionId) ?? null;
    const exit = c ? c.price : input.live[o.symbol] ?? null;
    const spyExit = c ? c.spy : spyNow;
    const valueCents = exit ? value(o.quantityMicros, exit.priceCents) : null;
    const benchmarkCents = spyExit ? Math.round(o.amountCents * spyExit.priceCents / o.spy.priceCents) : null;
    const returnPct = valueCents === null ? null : ret(o.amountCents, valueCents);
    const spyReturnPct = benchmarkCents === null ? null : ret(o.amountCents, benchmarkCents);
    const ageDays = Math.floor(((c ? Date.parse(c.createdAt) : Date.parse(input.now)) - Date.parse(o.createdAt)) / DAY);
    const reviewed = new Set(input.reviews.filter(r => r.positionId === o.positionId).map(r => r.milestone));
    const reviewDue = c ? null : [...REVIEW_MILESTONES].reverse().find(m => ageDays >= m.days && !reviewed.has(m.days)) ?? null;
    return {
      positionId: o.positionId, symbol: o.symbol, status: c ? 'closed' as const : 'open' as const,
      openedAt: o.createdAt, closedAt: c?.createdAt ?? null, ageDays,
      amountCents: o.amountCents, quantityMicros: o.quantityMicros,
      entry: o.price, exit, exitIsLive: !c, priceStale: !c && (!exit || (exit as LivePrice).stale === true),
      valueCents, returnPct, spyReturnPct,
      vsSpyPct: returnPct !== null && spyReturnPct !== null ? returnPct - spyReturnPct : null,
      thesis: o.thesis, exitPlan: o.exitPlan, killCondition: o.killCondition, closeReason: c?.reason ?? null,
      conviction: o.conviction, convictionBand: convictionBand(o.conviction),
      evidenceScore: o.evidenceScore, evidenceBand: scoreBand(o.evidenceScore) ?? 'No evidence score',
      caseId: o.caseId, reviewDue, reviews: input.reviews.filter(r => r.positionId === o.positionId),
    };
  });
  const open = positions.filter(p => p.status === 'open');
  const unpriced = open.filter(p => p.valueCents === null).length;
  const equityCents = unpriced ? null : cash + open.reduce((s, p) => s + (p.valueCents ?? 0), 0);
  // Benchmark: cash stays cash; every dollar that was invested is followed in SPY instead.
  const benchUnpriced = positions.some(p => p.status === 'open' && p.spyReturnPct === null);
  const benchmarkCents = benchUnpriced ? null : cash
    - positions.filter(p => p.status === 'closed').reduce((s, p) => s + (p.valueCents ?? 0), 0)
    + positions.reduce((s, p) => s + Math.round(p.amountCents * (1 + (p.spyReturnPct ?? 0) / 100)), 0);
  return {
    version: PRACTICE_VERSION, startCents: PRACTICE_START_CENTS, cashCents: cash, sequence: input.trades.length,
    equityCents, benchmarkCents,
    returnPct: equityCents === null ? null : ret(PRACTICE_START_CENTS, equityCents),
    benchmarkReturnPct: benchmarkCents === null ? null : ret(PRACTICE_START_CENTS, benchmarkCents),
    open, closed: positions.filter(p => p.status === 'closed'),
    reviewsDue: open.filter(p => p.reviewDue),
    history: [...input.marks].sort((a, b) => a.date.localeCompare(b.date)),
    scorecard: { byEvidence: scorecard(positions, p => p.evidenceBand), byConviction: scorecard(positions, p => p.convictionBand) },
    notes: 'Practice only. No real orders. Returns are gross: no fees, taxes or slippage. Prices are IEX midpoints and may lag the consolidated market. SPY comparison uses the same dollars at the same moments.',
  };
}

export const MIN_BAND_SAMPLE = 5;
/** Per band: count, how many beat SPY, and the median gap — median, because a few trades are easily skewed. */
function scorecard<T extends { vsSpyPct: number | null }>(positions: T[], key: (p: T) => string): { band: string; trades: number; beatSpy: number; medianVsSpyPct: number | null; enough: boolean }[] {
  const groups = new Map<string, T[]>();
  for (const p of positions) if (p.vsSpyPct !== null) groups.set(key(p), [...(groups.get(key(p)) ?? []), p]);
  return [...groups.entries()].map(([band, ps]) => {
    const gaps = ps.map(p => p.vsSpyPct!).sort((a, b) => a - b), m = gaps.length;
    return { band, trades: m, beatSpy: ps.filter(p => p.vsSpyPct! > 0).length,
      medianVsSpyPct: m >= MIN_BAND_SAMPLE ? (m % 2 ? gaps[(m - 1) / 2] : (gaps[m / 2 - 1] + gaps[m / 2]) / 2) : null,
      enough: m >= MIN_BAND_SAMPLE };
  }).sort((a, b) => a.band.localeCompare(b.band));
}

/** One mark per UTC day; null when any open position cannot be priced (never a guessed value). */
export function dailyMark(state: { equityCents: number | null; benchmarkCents: number | null; sequence: number }, now: string): PracticeMark | null {
  if (state.equityCents === null || state.benchmarkCents === null || state.sequence === 0) return null;
  return { date: now.slice(0, 10), equityCents: state.equityCents, benchmarkCents: state.benchmarkCents, at: now };
}
