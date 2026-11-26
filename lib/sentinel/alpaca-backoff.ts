/**
 * Alpaca rate-limit backoff (alpaca-backoff-v1, 2026-11-26). One shared pause for the Alpaca account, used by daily
 * bars and asset details: a 429 pauses both for 60 s, doubling on each further 429 up to 15 minutes; the next
 * successful response clears it. While paused nothing is sent, so a rate limit is never retried in a tight loop.
 * State lives in `source_state` (the operational-state table, like the SEC pause), never in an append-only record.
 */
import { database } from '@/db/store';

export const ALPACA_PAUSE_SOURCE = 'alpaca:rate-limit';
export const ALPACA_BACKOFF = Object.freeze({ baseMs: 60_000, maxMs: 15 * 60_000 });

/** Pause length after the n-th consecutive 429 (n ≥ 1): 60 s, 120 s, 240 s … capped at 15 min. */
export const backoffMs = (n: number) => Math.min(ALPACA_BACKOFF.maxMs, ALPACA_BACKOFF.baseMs * 2 ** Math.max(0, n - 1));

/** The time the pause ends, or null when Alpaca may be called now. */
export async function alpacaPausedUntil(nowMs = Date.now()): Promise<string | null> {
  const s = await database().prepare('SELECT retry_at FROM source_state WHERE source=?').bind(ALPACA_PAUSE_SOURCE).first<{ retry_at: string | null }>();
  return s?.retry_at && Date.parse(s.retry_at) > nowMs ? s.retry_at : null;
}

/** Record a 429: one more consecutive failure, and a longer pause. Returns when the pause ends. */
export async function recordAlpaca429(what: string, nowMs = Date.now()): Promise<string> {
  const db = database(), s = await db.prepare('SELECT failures FROM source_state WHERE source=?').bind(ALPACA_PAUSE_SOURCE).first<{ failures: number }>();
  const n = (s?.failures ?? 0) + 1, until = new Date(nowMs + backoffMs(n)).toISOString(), at = new Date(nowMs).toISOString();
  await db.prepare('INSERT INTO source_state(source,failures,checked_at,retry_at,error) VALUES(?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET failures=excluded.failures,checked_at=excluded.checked_at,retry_at=excluded.retry_at,error=excluded.error')
    .bind(ALPACA_PAUSE_SOURCE, n, at, until, `Rate-limited (HTTP 429) on ${what}; paused until ${until}.`).run();
  return until;
}

/** A successful response ends any pause. Writes nothing when there was no pause. */
export async function clearAlpacaPause(): Promise<void> {
  await database().prepare('UPDATE source_state SET failures=0,retry_at=NULL,error=NULL WHERE source=? AND failures>0').bind(ALPACA_PAUSE_SOURCE).run();
}
