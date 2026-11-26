/**
 * Verified party (verified-party-v1, 2026-11-26, founder approval). Pure. Set ONLY from a filing check that already
 * exists (event-verify-v1): the check examined the company's OWN filings (it reads only filings by the case's SEC
 * company), and an 8-K or 10-Q filed within 2 days of the report names the other party or deal from the headline.
 * A filing's type alone never counts. Otherwise "Not verified". Nothing is fetched here and nothing is guessed.
 * It is shown beside the role; it is not a requirement for R2, the evidence score or any label.
 */
import { EVENT_VERIFY_VERSION } from './event-verify';

export const VERIFIED_PARTY_VERSION = 'verified-party-v1';
export const VERIFIED_PARTY_RULE = 'Verified only when Sentinel’s filing check found an 8-K or 10-Q filed by the company itself within 2 days of the report that names the other party or deal from the headline. A filing’s type alone never counts.';
const FORMS = new Set(['8-K', '10-Q']);
const day = (s: string) => Date.parse(String(s).slice(0, 10) + 'T00:00:00Z');

export type VerifiedParty =
  | { version: string; state: 'verified'; label: string; party: string; form: string; filedAt: string; accession: string; url: string | null; checkedAt: string | null; reason: string }
  | { version: string; state: 'not_verified'; label: 'Not verified'; reason: string };

export function verifiedParty(kase: any, verification: any): VerifiedParty {
  const not = (reason: string): VerifiedParty => ({ version: VERIFIED_PARTY_VERSION, state: 'not_verified', label: 'Not verified', reason });
  if (!verification || verification.version !== EVENT_VERIFY_VERSION || verification.state === 'not_checked') return not('No filing check has been run for this report.');
  if (verification.state !== 'supported') return not(`The filing check did not connect a filing to this report (${String(verification.label ?? verification.state)}).`);
  const published = kase?.event?.publishedAt ?? verification.publishedAt;
  if (!Number.isFinite(Date.parse(published ?? ''))) return not('The report has no stored publication time to compare filing dates with.');
  const hit = (verification.evidence ?? []).find((e: any) => FORMS.has(String(e?.form ?? '').toUpperCase()) && Number.isFinite(day(e.filedAt))
    && Math.abs(day(e.filedAt) - day(published)) <= 2 * 86400000 && (e.matched ?? []).some((m: any) => m?.kind === 'counterparty' && m.term));
  if (!hit) return not('The filing check found no 8-K or 10-Q filed by the company within 2 days of the report that names the other party.');
  const party = hit.matched.find((m: any) => m.kind === 'counterparty').term as string;
  return { version: VERIFIED_PARTY_VERSION, state: 'verified', label: `Verified party: ${party}`, party, form: hit.form, filedAt: String(hit.filedAt).slice(0, 10), accession: hit.accession,
    url: hit.documentUrl ?? null, checkedAt: verification.checkedAt ?? null, reason: `${hit.form} ${hit.accession}, filed by the company on ${String(hit.filedAt).slice(0, 10)}, names ${party}.` };
}

/** What a NEW case stores at assessment: a filing check runs only on request, after the case exists, so none can exist yet. */
export const VERIFIED_PARTY_AT_ASSESSMENT = Object.freeze({ version: VERIFIED_PARTY_VERSION, state: 'not_verified' as const, label: 'Not verified' as const, reason: 'No filing check existed when the case was assessed. A later check is shown on the company page.' });
