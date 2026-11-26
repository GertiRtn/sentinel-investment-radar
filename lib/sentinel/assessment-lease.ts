/**
 * Assessment lease (assessment-lease-v1, 2026-11-26). At most one assessment batch per owner at a time, whether it is
 * started by the hourly run or by an assessment-only call. A second batch records "busy" and exits without assessing.
 * The lease expires after ASSESSMENT_LEASE_MS, so a request that is cut off cannot block assessment for longer.
 * Same pattern as the collector lease (lib/sentinel/collector.ts): `lease_until` / `lease_token` on the
 * operational-state table `source_state`, taken by one conditional UPDATE, so two callers cannot both win.
 * Batch size and time cap are unchanged (assessDiscoveryBatch defaults: 6 cases, 35 s).
 */
import { database } from '@/db/store';
import { assessDiscoveryBatch } from './discovery-case';

export const ASSESSMENT_LEASE_VERSION = 'assessment-lease-v1';
export const ASSESSMENT_LEASE_MS = 5 * 60_000; // well above the 35 s batch cap plus one slow case
const sourceOf = (owner: string) => 'sentinel:assessment-lease:' + owner;

export async function acquireAssessmentLease(owner: string, nowMs = Date.now()) {
  const db = database(), source = sourceOf(owner), now = new Date(nowMs).toISOString(), until = new Date(nowMs + ASSESSMENT_LEASE_MS).toISOString(), token = crypto.randomUUID();
  await db.prepare('INSERT OR IGNORE INTO source_state(source,failures) VALUES(?,0)').bind(source).run();
  const won = await db.prepare('UPDATE source_state SET lease_until=?,lease_token=?,checked_at=? WHERE source=? AND (lease_until IS NULL OR lease_until < ?)').bind(until, token, now, source, now).run();
  if (won.meta.changes) return { acquired: true as const, token, until };
  const held = await db.prepare('SELECT lease_until FROM source_state WHERE source=?').bind(source).first<{ lease_until: string | null }>();
  return { acquired: false as const, heldUntil: held?.lease_until ?? null };
}

/** Releases only the caller's own lease (an expired lease taken over by another batch is not touched). */
export async function releaseAssessmentLease(owner: string, token: string) {
  await database().prepare('UPDATE source_state SET lease_until=NULL,lease_token=NULL WHERE source=? AND lease_token=?').bind(sourceOf(owner), token).run();
}

/** The assessment stage: run the unchanged batch under the lease, or record "busy". */
export async function assessWithLease(owner: string, email: string, opts: { limit?: number; budgetMs?: number } = {}) {
  const lease = await acquireAssessmentLease(owner);
  if (!lease.acquired) return { status: 'busy' as const, lease: ASSESSMENT_LEASE_VERSION, heldUntil: lease.heldUntil,
    message: `Another assessment batch is running (its lease ends by ${lease.heldUntil ?? 'an unknown time'}). This call assessed nothing.` };
  try { return { ...(await assessDiscoveryBatch(owner, email, opts)), lease: ASSESSMENT_LEASE_VERSION }; }
  finally { await releaseAssessmentLease(owner, lease.token).catch(() => {}); }
}
