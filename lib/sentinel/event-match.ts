/**
 * Event ↔ company match (event-match-v1, 2026-11-13).
 *
 * A news provider tags a report with ticker symbols. A tag is a lead, not proof:
 * on 2026-11-13 a report about ams-OSRAM (a Swiss-listed company) was tagged
 * "AMS", which in the US is American Shared Hospital Services. This check says
 * how well the stored text supports the match. It reads only the stored
 * headline and provider summary; it does not read the article.
 *
 *  - named_in_headline: the SEC company name appears in the headline.
 *  - named_in_summary:  it appears only in the provider's summary.
 *  - name_conflict:     the company is not named, and the ticker's letters
 *                       appear in the text as part of another name
 *                       (e.g. "ams-OSRAM"). Probably a different company.
 *  - ticker_only:       the company is not named anywhere. Unconfirmed.
 *  - unknown:           there is no SEC company identity to compare with.
 *
 * Only named_in_headline counts as confirmed for automated Practice decisions.
 * This is a text rule, not entity resolution: a named company can still be a
 * bystander, which the "direct role" rule (R2) covers separately.
 */
import { assessCompanyRelevance } from './news-assessment';

export const EVENT_MATCH_VERSION = 'event-match-v1';
export type EventMatchLevel = 'named_in_headline' | 'named_in_summary' | 'name_conflict' | 'ticker_only' | 'unknown';
export type EventMatch = { version: typeof EVENT_MATCH_VERSION; level: EventMatchLevel; confirmed: boolean; evidence: string | null; label: string; reason: string };

const LABEL: Record<EventMatchLevel, string> = {
  named_in_headline: 'Company named in the headline',
  named_in_summary: 'Company named only in the provider summary',
  name_conflict: 'Probably a different company',
  ticker_only: 'Ticker tag only — company not named',
  unknown: 'Company identity unknown',
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The ticker's letters used as (part of) a name rather than as a ticker: lower/mixed case, or joined to another word by a hyphen. */
function conflictingName(text: string, symbol: string): string | null {
  if (symbol.length < 2) return null;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${esc(symbol)})(-[\\p{L}][\\p{L}\\p{N}]*)?(?![\\p{L}\\p{N}])`, 'giu');
  for (const m of text.matchAll(re)) {
    const before = text.slice(Math.max(0, m.index! - 22), m.index!);
    if (/(?:NYSE|NASDAQ|AMEX|CBOE|OTC)[^)]{0,14}:\s*$/i.test(before)) continue; // "(NASDAQ: AMS)" is a ticker citation
    const joined = !!m[2], asWritten = m[1];
    if (joined || asWritten !== symbol) return m[0];
  }
  return null;
}

export function eventMatch(input: { headline?: string | null; summary?: string | null; companyName?: string | null; symbol?: string | null }): EventMatch {
  const out = (level: EventMatchLevel, evidence: string | null, reason: string): EventMatch => ({ version: EVENT_MATCH_VERSION, level, confirmed: level === 'named_in_headline', evidence, label: LABEL[level], reason });
  const headline = String(input.headline ?? ''), summary = String(input.summary ?? ''), name = String(input.companyName ?? '').trim(), symbol = String(input.symbol ?? '').trim().toUpperCase();
  if (!name || !headline) return out('unknown', null, 'There is no SEC company name or no headline to compare.');
  const inHeadline = assessCompanyRelevance(headline, name).evidence;
  if (inHeadline) return out('named_in_headline', inHeadline, `The headline names "${inHeadline}".`);
  const inSummary = summary ? assessCompanyRelevance(summary, name).evidence : null;
  if (inSummary) return out('named_in_summary', inSummary, `Only the provider summary names "${inSummary}"; the headline does not.`);
  const clash = symbol ? conflictingName(headline, symbol) ?? (summary ? conflictingName(summary, symbol) : null) : null;
  if (clash) return out('name_conflict', clash, `${name} is not named, and the text uses "${clash}" as a name. The provider's ${symbol} tag probably points to a different company.`);
  return out('ticker_only', null, `${name} is not named in the headline or summary. The match rests on the provider's ${symbol || 'ticker'} tag alone.`);
}

/** Stored cases keep the result they were assessed with; older cases are read with the current rule from their stored text. */
export function caseEventMatch(kase: any): EventMatch {
  if (kase?.eventMatch?.version === EVENT_MATCH_VERSION && kase.eventMatch.level) return kase.eventMatch as EventMatch;
  return eventMatch({ headline: kase?.event?.headline, summary: kase?.event?.providerSummary, companyName: kase?.identity?.name, symbol: kase?.symbol });
}
