// Event verification against the company's own SEC filings (`event-verify-v1`). Pure: no network, no database.
//
// It answers three separate questions, and never merges them:
//  1. Company connection: is the company named? (that is event-match-v1, reused here, not repeated)
//  2. Event evidence: does an examined 8-K filed by this company name the headline's counterparty?
//  3. Stage: what stage do those filings report (from their 8-K item numbers), and does it match the headline?
//
// Plain text matching only. No model, no generated statements, no numbers taken from a filing:
// an amount is reported only when the headline's own amount text appears verbatim. A filing that merely
// exists near the headline date confirms nothing. A missing filing is not evidence that a report is false.

import { caseEventMatch } from './event-match';

export const EVENT_VERIFY_VERSION = 'event-verify-v1';
export type VerifyState = 'not_checked' | 'supported' | 'insufficient' | 'conflicting' | 'unavailable' | 'wrong_company' | 'not_company_event';
export type Stage = 'proposed' | 'agreed' | 'completed' | 'cancelled' | 'unknown';

/** Filings examined: 8-Ks filed from 2 days before to 6 days after publication (an 8-K is due within four business days). */
export const WINDOW = { daysBefore: 2, daysAfter: 6 };
export const LIMITS = { inWindow: 3, later: 2, exhibitsPerFiling: 2, spanChars: 320 };

export const STATE_LABEL: Record<VerifyState, string> = {
  not_checked: 'Headline only: source not checked',
  supported: 'Connection supported by a company filing',
  insufficient: 'Filings examined: not enough evidence',
  conflicting: 'Conflicting evidence',
  unavailable: 'Source unavailable',
  wrong_company: 'Likely wrong company: not checked',
  not_company_event: 'Analyst opinion: not a company event',
};

const STAGE_WORDS: [Stage, RegExp][] = [
  ['cancelled', /\b(terminat\w*|cancel\w*|calls? off|abandon\w*|withdraw\w*|scraps?|ends? (?:talks|deal|agreement))\b/i],
  ['completed', /\b(complet\w*|closes|closed|closing of|finali[sz]\w*)\b/i],
  ['agreed', /\b(agrees?|agreed|agreement|signs?|signed|enters? into|definitive|to (?:acquire|buy|merge|sell)|wins?|won|awarded|selects?|selected)\b/i],
  ['proposed', /\b(propos\w*|offers?|bids?|in talks|weighs|considers?|considering|explor\w*|non-?binding|letter of intent|reportedly|approach\w*)\b/i],
];
/** The stage the headline claims. The first matching level wins, most final first. */
export function headlineStage(headline: string): Stage {
  for (const [stage, re] of STAGE_WORDS) if (re.test(headline)) return stage;
  return 'unknown';
}
/** The stage an 8-K reports, from its item numbers only: 1.02 termination, 2.01 completion, 1.01 agreement. */
export function filingStage(items: string | null | undefined): Stage {
  const it = String(items ?? '').split(/[,\s]+/).filter(Boolean);
  if (it.includes('1.02')) return 'cancelled';
  if (it.includes('2.01')) return 'completed';
  if (it.includes('1.01')) return 'agreed';
  return 'unknown';
}

const CUE = /\b(?:with|from|by|acquires?|acquiring|acquisition of|buys?|buying|purchases?|purchase of|merger? with|partners? with|partnership with|selects|stake in|invests? in|investment in|to acquire|to buy)\s+/gi;
const STOP = new Set(['to', 'for', 'in', 'on', 'at', 'as', 'over', 'amid', 'after', 'before', 'worth', 'valued', 'deal', 'agreement', 'contract', 'order', 'and', 'the', 'its', 'a', 'an', 'into', 'via', 'under', 'per', 'up', 'from', 'with', 'by', 'of']);
const GENERIC = new Set(['inc', 'inc.', 'corp', 'corp.', 'corporation', 'co', 'co.', 'company', 'ltd', 'ltd.', 'llc', 'plc', 'group', 'holdings', 'holding', 'deal', 'shares', 'stock', 'stake', 'unit', 'units', 'investors', 'analysts', 'partner', 'partners', 'customer', 'customers', 'us', 'u.s.', 'new', 'major', 'leading', 'global', 'firm', 'rival', 'peer', 'lows', 'highs', 'record', 'results', 'earnings', 'revenue', 'sales', 'guidance', 'outlook', 'quarter', 'q1', 'q2', 'q3', 'q4', 'wall', 'street', 'market', 'markets', 'government']);
const LEGAL = /\s+(?:inc\.?|corp\.?|corporation|co\.?|ltd\.?|llc|plc|n\.v\.|s\.a\.|ag|se|holdings?)$/i;

/** Counterparty names the headline puts after a cue word ("with", "from", "acquires" ...). Conservative by design. */
export function counterparties(headline: string, companyName?: string | null): string[] {
  const own = new Set(String(companyName ?? '').toLowerCase().replace(/[^a-z0-9& ]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !GENERIC.has(w)));
  const out: string[] = [];
  for (const m of headline.matchAll(CUE)) {
    const tokens = headline.slice((m.index ?? 0) + m[0].length).split(/\s+/), name: string[] = [];
    for (const raw of tokens) {
      const t = raw.replace(/[,;:!?"“”()]+$/g, '').replace(/['’]s$/i, '');
      if (!t || STOP.has(t.toLowerCase()) || t.startsWith('$')) break;
      if (!/^[A-Z0-9]/.test(t)) break; // a lowercase word ends the name
      name.push(t);
      if (/[,;:]$/.test(raw) || name.length >= 5) break;
    }
    let term = name.join(' ').replace(/^the\s+/i, '').replace(/[.]+$/, '');
    while (LEGAL.test(term)) term = term.replace(LEGAL, '');
    const words = term.toLowerCase().split(/\s+/).filter(Boolean);
    if (term.length < 3 || words.every(w => GENERIC.has(w))) continue;
    if (words.every(w => own.has(w))) continue; // the company itself, not a counterparty
    if (!out.some(x => x.toLowerCase() === term.toLowerCase())) out.push(term);
  }
  return out;
}

/** Dollar amounts exactly as the headline writes them; matched in filings only verbatim (after spacing and unit-word normalisation). */
export function amounts(headline: string): string[] {
  return [...new Set([...headline.matchAll(/\$\s?\d[\d,]*(?:\.\d+)?\s?(?:billion|million|thousand|bn|mln|mn|[bmk])?\b/gi)].map(m => m[0].trim()))];
}
const normAmount = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/(bn)$/, 'billion').replace(/(mln|mn|m)$/, 'million').replace(/b$/, 'billion').replace(/k$/, 'thousand');

export function claimOf(headline: string, companyName?: string | null) {
  return { counterparties: counterparties(headline, companyName), amounts: amounts(headline), stage: headlineStage(headline) };
}

const ENTITY: Record<string, string> = { amp: '&', nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–' };
/** Filing HTML to plain text for matching and quoting. The result is only ever shown as text, never as HTML. */
export function htmlToText(html: string): string {
  return html.slice(0, 5_000_000)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?(?:p|div|br|tr|li|h\d|table)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) || 32))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d) || 32))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITY[n.toLowerCase()] ?? m)
    .replace(/[ \s]+/g, ' ').trim();
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A verbatim span (spacing normalised) around the first whole-word match of `term`, or null. */
export function findSpan(text: string, term: string): string | null {
  const re = new RegExp(`(?<![A-Za-z0-9])${term.trim().split(/\s+/).map(esc).join('\\s+')}(?![A-Za-z0-9])`, 'i');
  const m = re.exec(text);
  if (!m) return null;
  const half = Math.floor((LIMITS.spanChars - m[0].length) / 2);
  let start = Math.max(0, m.index - half), end = Math.min(text.length, m.index + m[0].length + half);
  const dot = text.lastIndexOf('. ', m.index);
  if (dot >= start) start = dot + 2;
  const next = text.indexOf('. ', m.index + m[0].length);
  if (next >= 0 && next < end) end = next + 1;
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
}
function findAmount(text: string, amount: string): string | null {
  const want = normAmount(amount);
  for (const m of text.matchAll(/\$\s?\d[\d,]*(?:\.\d+)?\s?(?:billion|million|thousand|bn|mln|mn|[bmk])?\b/gi)) {
    if (normAmount(m[0]) === want) return findSpan(text.slice(Math.max(0, (m.index ?? 0) - 200), (m.index ?? 0) + 200), m[0].trim());
  }
  return null;
}

const day = (iso: string) => Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z');
/** Filed within the window around the publication date (calendar days, UTC). */
export function inWindow(filedAt: string, publishedAt: string) {
  const f = day(filedAt), p = day(publishedAt);
  return Number.isFinite(f) && Number.isFinite(p) && f >= p - WINDOW.daysBefore * 86400000 && f <= p + WINDOW.daysAfter * 86400000;
}
/** SEC facts are known from the end of their filing date (the same rule as financial facts). */
export const knownFrom = (filedAt: string) => String(filedAt).slice(0, 10) + 'T23:59:59.999Z';

/** Cases that are not checked at all, with the reason. Wrong-company and analyst cases never reach a filing. */
export function precheck(kase: any): { state: VerifyState; reason: string } | null {
  const match = caseEventMatch(kase);
  if (match.level === 'name_conflict') return { state: 'wrong_company', reason: `${match.reason} A filing by this company cannot verify a report that is probably about someone else, so none was examined.` };
  const topics: string[] = kase?.event?.analysis?.topics ?? [];
  if (topics.length && topics.every(t => t === 'Analyst opinion')) return { state: 'not_company_event', reason: 'The headline reports an analyst’s view. Company filings do not verify analyst opinions, so none was examined.' };
  if (!/^\d{10}$/.test(String(kase?.identity?.cik ?? ''))) return { state: 'unavailable', reason: 'The case has no single SEC company, so there is no filer whose filings could be examined.' };
  if (!kase?.event?.headline || !Number.isFinite(Date.parse(kase?.event?.publishedAt ?? ''))) return { state: 'unavailable', reason: 'The case has no stored headline or publication time to check against.' };
  return null;
}

export type Doc = { url: string; name: string; text: string | null; error?: string | null; capturedAt?: string | null; rawId?: string | null; hash?: string | null };
export type FilingInput = { accession: string; form: string; filedAt: string; items: string | null; indexUrl: string; documents: Doc[]; error?: string | null; later?: boolean };
export type Evidence = { accession: string; form: string; filedAt: string; knownFrom: string; items: string | null; stage: Stage; documentUrl: string; documentName: string; capturedAt: string | null; rawId: string | null;
  matched: { kind: 'counterparty' | 'amount'; term: string; span: string }[]; availableAtAssessment: boolean; afterPublication: boolean };

/** The not-checked state every case has until someone runs the check. */
export function notChecked() {
  return { version: EVENT_VERIFY_VERSION, state: 'not_checked' as VerifyState, label: STATE_LABEL.not_checked,
    reason: 'Sentinel has read only the stored headline and provider summary. No article, press release or company filing has been examined.', evidence: [], examined: [], stage: null, checkedAt: null };
}

export function verifyEvent(input: { kase: any; checkedAt: string; filings?: FilingInput[]; sourceError?: string | null; foreignIssuer?: boolean }) {
  const kase = input.kase, base = { version: EVENT_VERIFY_VERSION, caseId: kase?.id ?? null, checkedAt: input.checkedAt, assessedAt: kase?.createdAt ?? null, publishedAt: kase?.event?.publishedAt ?? null };
  const limits = 'Only 8-K filings by this company and their EX-99 exhibits are read, by exact text match. Articles, other filings, non-US sources and anything filed outside the window are not examined.';
  const out = (state: VerifyState, reason: string, extra: Record<string, unknown> = {}) => ({ ...base, state, label: STATE_LABEL[state], reason, claim: null as any, evidence: [] as Evidence[], examined: [] as any[], stage: null as any, timeline: [] as any[], limits, ...extra });
  const pre = precheck(kase);
  if (pre) return out(pre.state, pre.reason);
  if (input.sourceError) return out('unavailable', `SEC filings could not be read (${input.sourceError.slice(0, 120)}). Nothing was concluded.`);
  if (input.foreignIssuer) return out('unavailable', 'The company files as a foreign issuer (6-K / 20-F / 40-F), not 8-Ks. Its events are not checked here.');

  const claim = claimOf(kase.event.headline, kase.identity?.name);
  const filings = input.filings ?? [];
  const examined = filings.map(f => ({ accession: f.accession, form: f.form, filedAt: f.filedAt, items: f.items, url: f.indexUrl, later: !!f.later,
    documents: f.documents.map(d => ({ name: d.name, url: d.url, read: d.text !== null, error: d.error ?? null, capturedAt: d.capturedAt ?? null })), error: f.error ?? null }));
  if (!claim.counterparties.length && !claim.amounts.length) return out('insufficient', 'The headline names no counterparty or amount that Sentinel can look for in a filing, so it cannot connect a filing to this event.', { claim, examined });
  if (!filings.some(f => !f.later)) return out('insufficient', `No 8-K by this company was filed between ${WINDOW.daysBefore} days before and ${WINDOW.daysAfter} days after publication. That does not mean the report is false.`, { claim, examined });
  const readable = filings.filter(f => f.documents.some(d => d.text !== null));
  if (!readable.length) return out('unavailable', 'The 8-K filings in the window could not be read. Nothing was concluded.', { claim, examined });

  const pubDay = day(base.publishedAt), assessed = Date.parse(base.assessedAt ?? '');
  const evidence: Evidence[] = [];
  for (const f of readable) {
    for (const d of f.documents) {
      if (d.text === null) continue;
      const matched: Evidence['matched'] = [];
      for (const term of claim.counterparties) { const span = findSpan(d.text, term); if (span) matched.push({ kind: 'counterparty', term, span }); }
      for (const a of claim.amounts) { const span = findAmount(d.text, a); if (span) matched.push({ kind: 'amount', term: a, span }); }
      if (!matched.length) continue;
      evidence.push({ accession: f.accession, form: f.form, filedAt: f.filedAt, knownFrom: knownFrom(f.filedAt), items: f.items, stage: filingStage(f.items), documentUrl: d.url, documentName: d.name, capturedAt: d.capturedAt ?? null, rawId: d.rawId ?? null,
        matched, availableAtAssessment: Number.isFinite(assessed) && Date.parse(knownFrom(f.filedAt)) <= assessed, afterPublication: day(f.filedAt) > pubDay });
    }
  }
  const connecting = evidence.filter(e => e.matched.some(m => m.kind === 'counterparty'));
  const names = claim.counterparties.length ? claim.counterparties.join(', ') : 'no counterparty';
  if (!connecting.length) {
    const amountOnly = evidence.length ? ` The amount ${evidence[0].matched[0].term} appears in ${evidence[0].accession}, but no counterparty is named with it, so Sentinel cannot tell whether it refers to this event.` : '';
    return out('insufficient', `Sentinel read ${readable.length} 8-K filing${readable.length === 1 ? '' : 's'} by this company; none names ${names}. A filing near the headline date is not confirmation.${amountOnly}`, { claim, examined, evidence });
  }

  // Stage: from the item numbers of the filings that name the counterparty, in filing order.
  const timeline = [...connecting].sort((a, b) => a.filedAt.localeCompare(b.filedAt)).map(e => ({ accession: e.accession, filedAt: e.filedAt, stage: e.stage, afterPublication: e.afterPublication }));
  const priorCancel = connecting.find(e => e.stage === 'cancelled' && !e.afterPublication);
  if (priorCancel && claim.stage !== 'cancelled' && claim.stage !== 'unknown')
    return out('conflicting', `The headline reads as ${claim.stage}, but ${priorCancel.accession}, filed ${priorCancel.filedAt} (on or before publication), reports a termination (item 1.02) and names ${priorCancel.matched[0].term}. Unresolved: Sentinel does not decide which is right.`, { claim, examined, evidence, timeline, stage: { claimed: claim.stage, supported: false, text: 'Conflicting stages.' } });

  const stages = [...new Set(timeline.map(t => t.stage))].filter(s => s !== 'unknown');
  const laterCancel = timeline.find(t => t.stage === 'cancelled' && t.afterPublication && claim.stage !== 'cancelled');
  const stageSupported = claim.stage !== 'unknown' && stages.includes(claim.stage);
  const stageText = claim.stage === 'unknown' ? 'The headline does not state a stage (proposed, agreed, completed or cancelled).'
    : stageSupported ? `An examined filing reports the same stage (${claim.stage}).`
    : stages.length ? `The filings support the connection, not the headline’s stage (${claim.stage}): they report ${stages.join(', ')}.`
    : `The filings support the connection, not the headline’s stage (${claim.stage}): their item numbers state no stage.`;
  const later = laterCancel ? ` A later filing (${laterCancel.accession}, ${laterCancel.filedAt}) reports a termination. That is a later update to the timeline, not a contradiction of the earlier report.` : '';
  const first = connecting[0];
  return out('supported', `${first.form} ${first.accession}, filed by this company on ${first.filedAt}, names ${first.matched.find(m => m.kind === 'counterparty')!.term}. That supports the reported connection; it does not establish the terms, the financial effect or what happens next.${later}`,
    { claim, examined, evidence, timeline, stage: { claimed: claim.stage, supported: stageSupported, text: stageText } });
}
