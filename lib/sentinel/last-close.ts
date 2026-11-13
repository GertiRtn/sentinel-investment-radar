/**
 * Last completed daily close as a price reference (price-basis-v2, 2026-11-13).
 *
 * Why: the screen's P/E needed an IEX quote under five minutes old with a spread
 * under 1%. Outside US market hours (about 17.5 hours of every weekday, and all
 * weekend) IEX's "latest quote" is a stale closing quote with a very wide
 * spread (TSLA showed $374.96 / $413.75 at 05:25 UTC on 2026-11-13). So every
 * case assessed off-hours ended as WAIT, whatever the company looked like:
 * on the live Site 0 of 75 screen-v2 cases had a usable price.
 *
 * Fix: when no eligible live quote exists, use the last completed session's
 * close from Alpaca IEX daily bars, at most MAX_CLOSE_AGE_DAYS old, recorded
 * with its session date and raw capture. The case states which basis it used.
 * A live midpoint is still preferred when it is eligible. Nothing is estimated.
 */
import { closeInstant, nyDate } from './case-context';

export const PRICE_BASIS_VERSION = 'price-basis-v2';
export const MAX_CLOSE_AGE_DAYS = 5; // covers a weekend plus a market holiday
export type LastClose = { symbol: string; close: number; sessionDate: string; closeAt: string; rawEventId: string; source: string };

/** Latest bar whose session had finished by `asOf`. Null when there is none or it is too old. */
export function closeFromBars(payload: any, symbol: string, asOf: string, rawEventId: string): LastClose | null {
  const now = Date.parse(asOf);
  if (!Number.isFinite(now) || !rawEventId || !Array.isArray(payload?.bars)) return null;
  let best: LastClose | null = null;
  for (const b of payload.bars) {
    if (typeof b?.t !== 'string' || !Number.isFinite(Date.parse(b.t)) || typeof b.c !== 'number' || !Number.isFinite(b.c) || !(b.c > 0)) continue;
    const sessionDate = nyDate(b.t), closeAt = closeInstant(sessionDate);
    if (closeAt > asOf) continue; // session still open, or later than the assessment
    if (!best || sessionDate > best.sessionDate) best = { symbol, close: b.c, sessionDate, closeAt, rawEventId, source: 'Alpaca IEX daily bar (one US exchange)' };
  }
  if (!best || now - Date.parse(best.closeAt) > MAX_CLOSE_AGE_DAYS * 86400000) return null;
  return best;
}
