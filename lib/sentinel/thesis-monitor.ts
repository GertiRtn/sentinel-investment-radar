/**
 * Following: one line per followed company — is the thesis still holding, and
 * what changed this week. Pure; the API loads the records.
 *
 * Status rules (thesis-monitor-v1), from the user's own kill criteria only:
 *  - Broken     any active kill criterion has tripped in its latest evaluation.
 *  - Weakening  every criterion passes, but at least one condition is already
 *               met in the latest period(s) without yet meeting its required
 *               streak (an early warning, from the evaluation's own streak).
 *  - Holding    every active criterion was evaluated and passes, with no streak.
 *  - Can't check any criterion is unknown or never evaluated (invariant 3:
 *               unknown is never shown as holding).
 *  - No thesis  no memo or no kill criterion yet.
 */
export const MONITOR_VERSION = 'thesis-monitor-v1';
export const CHANGE_WINDOW_DAYS = 7;
export type ThesisStatus = 'Broken' | 'Weakening' | 'Holding' | "Can't check" | 'No thesis';
const ORDER: Record<ThesisStatus, number> = { Broken: 0, Weakening: 1, "Can't check": 2, Holding: 3, 'No thesis': 4 };

export type CriterionInput = { id: string; predicate: string; latest: { result: string; reason: string; evaluatedAt: string; snapshot: any } | null };
export type FollowInput = {
  entityId: string; name: string; ticker: string | null;
  thesis: { text: string; recordedAt: string } | null;
  criteria: CriterionInput[];
  changes: { kind: 'filing' | 'news' | 'alert' | 'case' | 'evaluation'; at: string | null; text: string; url?: string | null }[];
};

function streakOf(snapshot: any): number {
  const checks = Array.isArray(snapshot?.checks) ? snapshot.checks : [];
  return Math.max(0, ...checks.map((c: any) => (Number.isFinite(c?.streak) ? c.streak : 0)), Number.isFinite(snapshot?.streak) ? snapshot.streak : 0);
}

export function thesisStatus(f: Pick<FollowInput, 'thesis' | 'criteria'>): { status: ThesisStatus; why: string } {
  if (!f.thesis || !f.criteria.length) return { status: 'No thesis', why: f.thesis ? 'No kill criterion defined yet: say what would prove the thesis wrong.' : 'No thesis recorded yet.' };
  const tripped = f.criteria.filter(c => c.latest?.result === 'trip');
  if (tripped.length) return { status: 'Broken', why: tripped.map(c => c.latest!.reason).join(' ') };
  const unknown = f.criteria.filter(c => !c.latest || c.latest.result !== 'pass');
  if (unknown.length) return { status: "Can't check", why: `${unknown.length} of ${f.criteria.length} kill criteria cannot be evaluated: ${unknown.map(c => c.latest?.reason ?? 'not evaluated yet').join(' ')}` };
  const early = f.criteria.filter(c => streakOf(c.latest!.snapshot) > 0);
  if (early.length) return { status: 'Weakening', why: 'A kill condition is already met in the latest period but has not yet run for its required number of periods.' };
  return { status: 'Holding', why: `All ${f.criteria.length} kill criteria were evaluated and pass.` };
}

export function buildFollowing(items: FollowInput[], now: string) {
  const since = new Date(Date.parse(now) - CHANGE_WINDOW_DAYS * 86400000).toISOString();
  const rows = items.map(f => {
    const s = thesisStatus(f);
    const changes = f.changes.filter(c => !c.at || c.at >= since.slice(0, c.at.length)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return { entityId: f.entityId, name: f.name, ticker: f.ticker, thesis: f.thesis, status: s.status, why: s.why, criteria: f.criteria.length, changes, changed: changes.length > 0 };
  }).sort((a, b) => ORDER[a.status] - ORDER[b.status] || Number(b.changed) - Number(a.changed) || a.name.localeCompare(b.name));
  const count = (st: ThesisStatus) => rows.filter(r => r.status === st).length;
  const changed = rows.filter(r => r.changed);
  const parts: string[] = [];
  if (count('Broken')) parts.push(`${count('Broken')} thesis${count('Broken') === 1 ? ' is' : 'es are'} broken.`);
  if (count('Weakening')) parts.push(`${count('Weakening')} showing early warning.`);
  parts.push(changed.length ? `This week: changes at ${changed.map(r => r.name).join(', ')}.` : 'Nothing changed this week.');
  return { version: MONITOR_VERSION, preparedAt: now, windowDays: CHANGE_WINDOW_DAYS, summary: parts.join(' '), rows,
    counts: { broken: count('Broken'), weakening: count('Weakening'), holding: count('Holding'), cantCheck: count("Can't check"), noThesis: count('No thesis') } };
}
