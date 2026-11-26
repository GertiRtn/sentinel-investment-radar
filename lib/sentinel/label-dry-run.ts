/**
 * Label rules v2 dry run (label-dry-run-v1, 2026-11-26). Pure. How many stored cases WOULD change under the v2 label
 * rules, by rule. Counts only: no headline, id, symbol or company name leaves this function. Nothing is stored and no
 * stored label is changed; "before" is the label as stored with the case (or the old rule's result when none was
 * stored), "after" is what the v2 rule gives for the same stored text.
 */
import { eventMatch, eventMatchV1, EVENT_MATCH_V1 } from './event-match';
import { newsDirection, newsDirectionV1 } from './news-direction';
import { analystOpinion, assessCompanyRelevance, ROUTING_VERSION } from './news-assessment';

export const LABEL_DRY_RUN_VERSION = 'label-dry-run-v1';
const MATERIAL = ['Earnings or financial results', 'Regulation or legal matter', 'Acquisition or transaction'];

export type DryRunCase = {
  headline: string | null; summary: string | null; companyName: string | null; symbol: string | null;
  storedMatch: { version: string | null; level: string | null } | null;
  storedDirection: { version: string | null; direction: string | null } | null;
  storedRelevance: { version: string | null; level: string | null; role: string | null } | null;
  topics: string[] | null;
};

const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

export function labelDryRun(cases: DryRunCase[], now: string, truncated = false) {
  const match = { compared: 0, changed: 0, transitions: {} as Record<string, number> };
  const analyst = { flagged: 0, directionWouldChange: 0, materialTopicWouldBeDropped: 0, directRoleWouldBecomeMentioned: 0 };
  const role = { compared: 0, notAssessed: 0, changed: 0, transitions: {} as Record<string, number>, byCause: { analystOpinion: 0, nameRule: 0 } };
  for (const c of cases) {
    const input = { headline: c.headline, summary: c.summary, companyName: c.companyName, symbol: c.symbol };
    // Company match.
    if (c.headline && c.companyName) {
      match.compared++;
      const before = c.storedMatch?.level ? c.storedMatch.level : eventMatchV1(input).level, after = eventMatch(input).level;
      if (before !== after) { match.changed++; bump(match.transitions, `${before} → ${after}`); }
    }
    // Analyst opinion first: direction, topics (R1) and role.
    const isAnalyst = analystOpinion(c.headline);
    if (isAnalyst) {
      analyst.flagged++;
      const beforeDir = c.storedDirection?.direction ?? newsDirectionV1({ headline: c.headline, summary: c.summary }).direction;
      if (beforeDir !== newsDirection({ headline: c.headline, summary: c.summary }).direction) analyst.directionWouldChange++;
      if ((c.topics ?? []).some(t => MATERIAL.includes(t))) analyst.materialTopicWouldBeDropped++;
      if (c.storedRelevance?.level === 'direct_candidate') analyst.directRoleWouldBecomeMentioned++;
    }
    // Role (headline-relevance-v4) against the role stored with the case.
    if (!c.storedRelevance?.level || !c.companyName || !c.headline) { role.notAssessed++; continue; }
    role.compared++;
    const v4 = assessCompanyRelevance(c.headline, c.companyName, c.symbol);
    if (v4.level !== c.storedRelevance.level || v4.role !== c.storedRelevance.role) {
      role.changed++; bump(role.transitions, `${c.storedRelevance.level} (${c.storedRelevance.role}) → ${v4.level} (${v4.role})`);
      bump(role.byCause as any, isAnalyst ? 'analystOpinion' : 'nameRule');
    }
  }
  return {
    version: LABEL_DRY_RUN_VERSION, generatedAt: now, cases: cases.length, truncated,
    rules: { match: 'event-match-v2', routing: ROUTING_VERSION, direction: 'news-direction-v2', role: 'headline-relevance-v4' },
    match, analyst, role,
    notes: [
      'Counts only. Nothing is stored and no stored label changes; stored cases keep the labels they were assessed with.',
      `Before = the label stored with the case, or, when none was stored, the rule of that time (${EVENT_MATCH_V1}, news-direction-v1). After = the v2 rule on the same stored text.`,
      'A material topic dropped means rule R1 would no longer pass for that report under headline-routing-v2. Stored screen results do not change.',
      'Role changes are counted against the role stored with the case; "name rule" means the company is no longer named in full or by a recognised ticker form.',
    ],
  };
}
