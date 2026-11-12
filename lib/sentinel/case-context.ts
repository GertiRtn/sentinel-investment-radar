/**
 * "What changed?" for one case (case-context-v1). Pure: the route loads records
 * and bars; this shapes them. No model, no estimates.
 *
 * Built from the existing evidence pack (evidence-pack-v1: SEC facts filed AND
 * recorded by the case time) and the existing rules template, plus an optional
 * price context from daily bars fetched on request.
 *
 * Each line is tagged with what it is:
 *  - reported_claim: what a news provider says (unverified)
 *  - fact: a figure from an SEC filing, with period and source
 *  - computed: arithmetic on cited facts (e.g. a % change between two periods)
 *  - interpretation: a fixed rule's reading of the facts (not a forecast)
 *  - missing: something Sentinel does not have
 *
 * Price context never says the event caused a move, and states which parts
 * were knowable at the case time.
 */
import type { EvidencePack, PackItem } from './evidence-pack';
import { templateReading } from './research-team';

export const CASE_CONTEXT_VERSION = 'case-context-v1';
export const PRICE_CONTEXT_VERSION = 'price-context-v1';
export const PRE_SESSIONS = 20, POST_SESSIONS = 20;
const DAY = 86400000;

export type Kind = 'reported_claim' | 'fact' | 'computed' | 'interpretation' | 'missing';
export type ChangeRow = {
  label: string; kind: Kind; latest: PackItem; prior: PackItem | null;
  changePct: number | null; comparison: string; note: string | null;
};

const tagOf = (i: PackItem) => i.source.name.match(/\(([^)]+)\)/)?.[1] ?? null;
const sameLength = (a: PackItem, b: PackItem) => {
  if (!a.period?.start || !b.period?.start) return true; // computed/balance items: period end only
  const la = Date.parse(a.period.end) - Date.parse(a.period.start), lb = Date.parse(b.period.end) - Date.parse(b.period.start);
  return Math.abs(la - lb) <= 14 * DAY;
};

/** Latest vs prior for one metric prefix, with a % change only when the comparison is valid. */
export function changeRow(pack: EvidencePack, prefix: string, label: string): ChangeRow | null {
  const rows = pack.items.filter(i => i.id.startsWith(prefix)).sort((a, b) => (b.period?.end ?? '').localeCompare(a.period?.end ?? ''));
  const latest = rows[0];
  if (!latest) return null;
  const prior = rows[1] ?? null;
  let changePct: number | null = null, note: string | null = null;
  if (prior && latest.value !== null && prior.value !== null) {
    const gap = (Date.parse(latest.period!.end) - Date.parse(prior.period!.end)) / DAY;
    const tagOk = tagOf(latest) === tagOf(prior) || latest.source.accession === null || prior.source.accession === null;
    if (gap < 330 || gap > 400) note = 'Periods are not a year apart; no change shown.';
    else if (!tagOk) note = 'Different reporting tags; no change shown.';
    else if (!sameLength(latest, prior)) note = 'Periods differ in length; no change shown.';
    else if (!(prior.value > 0)) note = 'Prior value is zero or negative; a % change is not meaningful.';
    else changePct = (latest.value - prior.value) / prior.value * 100;
  } else if (!prior) note = 'No comparable prior period recorded.';
  const kindLabel = latest.kind === 'quarterly_fact' ? 'same quarter a year earlier' : 'prior year';
  return { label, kind: 'fact', latest, prior, changePct, comparison: kindLabel, note };
}

export function whatChanged(pack: EvidencePack, kase: any) {
  const ev = kase?.event ?? {};
  const t = templateReading(pack);
  const by = (p: string) => pack.items.find(i => i.id.startsWith(p)) ?? null;
  const rows = ([
    ['Q:revenue:', 'Revenue (quarter)'], ['A:revenue:', 'Revenue (year)'], ['Q:net_income:', 'Net income (quarter)'], ['A:net_income:', 'Net income (year)'],
    ['Q:cfo:', 'Operating cash flow (quarter)'], ['A:cfo:', 'Operating cash flow (year)'], ['A:operating_income:', 'Operating income (year)'],
  ] as const).map(([p, l]) => changeRow(pack, p, l)).filter(Boolean) as ChangeRow[];
  const position = ([['A:cash:', 'Cash'], ['A:total_debt:', 'Total debt'], ['A:equity:', 'Shareholders’ equity'], ['A:share_count_yoy:', 'Diluted share count change']] as const)
    .map(([p, l]) => changeRow(pack, p, l)).filter(Boolean) as ChangeRow[];
  const pe = by('V:pe:');
  return {
    version: CASE_CONTEXT_VERSION, caseId: pack.caseId, asOf: pack.asOf,
    event: {
      kind: 'reported_claim' as Kind, headline: ev.headline ?? null, summary: ev.providerSummary ?? null, source: ev.source ?? null, url: ev.url ?? null,
      publishedAt: ev.publishedAt ?? null, firstObservedAt: ev.firstObservedAt ?? null, assessedAt: kase?.createdAt ?? null,
      readNote: 'Only the headline and provider summary were read, not the article.',
      companyMatch: { level: kase?.identity?.relevance?.level ?? 'unknown', reason: kase?.identity?.relevance?.reason ?? 'Not assessed.', note: 'A ticker match does not prove the news concerns this company.' },
    },
    business: rows, position,
    // Rule-based readings of the facts above (the same rules as the Research team's template). Not forecasts.
    supports: t.bull.map(b => ({ kind: 'interpretation' as Kind, text: b.point, mustHold: b.must_hold, cites: b.cites })),
    risks: [
      ...t.bear.map(b => ({ kind: 'interpretation' as Kind, text: b.point, wrongIf: b.invalidation, cites: b.cites })),
      ...(kase?.identity?.relevance?.level !== 'direct_candidate' ? [{ kind: 'interpretation' as Kind, text: 'The headline does not clearly name this company; the event may concern someone else.', wrongIf: 'The original report names the company directly.', cites: ['I:identity'] }] : []),
    ],
    valuation: {
      pe: pe ? { kind: 'computed' as Kind, value: pe.value, display: pe.display, period: pe.period, source: pe.source, sourceTime: pe.sourceTime, note: pe.note } : null,
      peUnavailable: pe ? null : (pack.missing.find(m => m.startsWith('Indicative P/E')) ?? 'Indicative P/E unavailable.'),
      shareBasis: 'Share basis, share classes and later splits are not independently verified.',
      expectations: { status: 'unknown' as const, reason: 'Sentinel has no timestamped analyst consensus or prior company guidance, so it cannot say whether results beat or missed expectations, or whether the market has priced the event.' },
    },
    missing: pack.missing,
    nextChecks: t.editor.next_checks,
    sources: pack.items,
  };
}

// ---- price context ---------------------------------------------------------

export type Bar = { t: string; c: number };
export const nyDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
/** UTC instant of 16:00 New York time on a session date (handles daylight saving). */
export function closeInstant(date: string): string {
  const guess = Date.parse(date + 'T21:00:00Z'); // 16:00 EST
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date(guess)));
  return new Date(guess - (hour - 16) * 3600000).toISOString();
}

type Window = {
  label: string; from: string; to: string; sessions: number; stockPct: number; spyPct: number; vsSpyPct: number;
  stockFrom: number; stockTo: number; spyFrom: number; spyTo: number; knownAtCaseTime: boolean; note: string;
};

/**
 * Daily closes around the event. "Before": the PRE_SESSIONS sessions ending at the last close before
 * publication (knowable at the case time). "After": from that close to up to POST_SESSIONS completed
 * sessions later (information later than the case; never part of its assessment).
 */
export function priceContext(input: { stock: any; spy: any; symbol: string; publishedAt: string | null; caseAt: string; fetchedAt: string; source: string; adjustment: string; rawIds: string[] }) {
  const base = { version: PRICE_CONTEXT_VERSION, symbol: input.symbol, source: input.source, adjustment: input.adjustment, fetchedAt: input.fetchedAt, rawIds: input.rawIds,
    caveats: ['IEX is a single exchange; its closes can differ from the consolidated close.', `Prices are "${input.adjustment}"-adjusted as known when fetched (${input.fetchedAt.slice(0, 10)}), which can use corporate actions announced after the case.`, 'Movement around an event does not show the event caused it.'] };
  const unavailable = (reason: string) => ({ ...base, status: 'unavailable' as const, reason, before: null, after: null });
  if (!input.publishedAt || !Number.isFinite(Date.parse(input.publishedAt))) return unavailable('The event has no valid publication time.');
  const clean = (p: any) => {
    const m = new Map<string, number>();
    for (const b of Array.isArray(p?.bars) ? p.bars : []) {
      if (typeof b?.t !== 'string' || !Number.isFinite(Date.parse(b.t)) || typeof b.c !== 'number' || !(b.c > 0)) continue;
      const d = nyDate(b.t);
      if (closeInstant(d) > input.fetchedAt) continue; // session not complete when fetched
      m.set(d, b.c);
    }
    return m;
  };
  const s = clean(input.stock), y = clean(input.spy);
  const days = [...s.keys()].filter(d => y.has(d)).sort();
  if (!days.length) return unavailable('No matching completed daily bars for the stock and SPY.');
  const lastPre = days.filter(d => closeInstant(d) < input.publishedAt!).at(-1);
  if (!lastPre) return unavailable('No completed session before the event in the fetched range.');
  const i = days.indexOf(lastPre);
  const win = (a: string, b: string, label: string, known: boolean, note: string): Window => {
    const sp = (s.get(b)! / s.get(a)! - 1) * 100, yp = (y.get(b)! / y.get(a)! - 1) * 100;
    return { label, from: a, to: b, sessions: days.indexOf(b) - days.indexOf(a), stockPct: sp, spyPct: yp, vsSpyPct: sp - yp, stockFrom: s.get(a)!, stockTo: s.get(b)!, spyFrom: y.get(a)!, spyTo: y.get(b)!, knownAtCaseTime: known, note };
  };
  const before = i >= PRE_SESSIONS
    ? win(days[i - PRE_SESSIONS], lastPre, `${PRE_SESSIONS} sessions before the event`, closeInstant(lastPre) <= input.caseAt, 'Ends at the last close before publication.')
    : null;
  const j = Math.min(i + POST_SESSIONS, days.length - 1);
  const after = j > i
    ? win(lastPre, days[j], `${j - i} session${j - i === 1 ? '' : 's'} after the event`, closeInstant(days[j]) <= input.caseAt,
      j - i < POST_SESSIONS ? `Only ${j - i} completed session(s) so far; later than the case assessment.` : 'Later than the case assessment; not part of it.')
    : null;
  return {
    ...base, status: before || after ? 'ok' as const : 'unavailable' as const,
    reason: before ? null : `Fewer than ${PRE_SESSIONS} matching sessions before the event in the fetched range.`,
    lastCloseBeforeEvent: lastPre, before, after,
  };
}
