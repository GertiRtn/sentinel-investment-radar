/**
 * auto-practice-v2 (2026-11-15). Virtual money only. Spec: docs/specs/auto-practice-v2-spec-2026-11-15.md (rev 2).
 *
 * Pure: no fetching, no storage, no orders. The runner (auto-practice-v2-run.ts) loads records and prices,
 * calls these functions and appends what they decide. auto-practice-v1 is not read, changed or replaced:
 * it keeps running on its own rules and ledger and is one of v2's comparison groups.
 *
 * Two ledgers (spec section 5):
 *  - signal ledger, uncapped: every case meeting the entry rules, priced on dividend-adjusted IEX daily closes
 *    (entry = close of the first full session after the case was recorded, exit = close 20 sessions later,
 *    SPY on the same dates). All judging uses this ledger.
 *  - virtual portfolio, capped (5 × $1,000): live IEX quote fills as in v1. A realism check only.
 *
 * Unknown is never a pass: a rule that cannot be evaluated either waits (and retries) or records the case as
 * not entered with its reason. Nothing here produces a probability, forecast, price target or buy/sell label.
 * Any change to the entry, sizing, exit, cost or judging rules is auto-practice-v3, never an edit.
 */
export const V2_VERSION = 'auto-practice-v2';
export const V2_SPEC = 'docs/specs/auto-practice-v2-spec-2026-11-15.md (rev 2)';
export const V2_POLICY = Object.freeze({
  // Section 2
  screenVersion: 'research-screen-v2', screenConclusion: 'INVESTIGATE', newsDirection: 'positive',
  securityStatus: 'candidate_common', securityVersion: 'security-identity-v2', matchLevel: 'named_in_headline',
  minCloseDollars: 5, reentryBlockSessions: 20,
  // Section 3
  startingCashCents: 1_000_000, positionCents: 100_000, maxPositions: 5,
  // Section 4
  holdSessions: 20, entryWindowSessions: 1, costBpsPerSide: 15, maxQuoteAgeMinutes: 15, maxSpreadPct: 1,
  // Section 7
  qualityCheckAt: 20, firstTestAt: 50, secondTestAt: 100, minAverageExcess: 0.02, interval: 0.9, bootstrapResamples: 10_000, bootstrapSeed: 20261115,
});
export const V2_RULES_TEXT = [
  'Considers only cases assessed after this experiment started. Runs alongside auto-practice-v1 and never changes it.',
  'A case is a signal when, at its assessment time: it meets the research rules (screen v2); its news is good news (news direction v1); the security is an ordinary US share (identity v2, as v1); the company is named in the headline (event match v1, as v1); the latest IEX daily close is $5 or more; and the company has no open signal and no exit in the previous 20 trading days.',
  'Every signal is priced on dividend-adjusted IEX daily closes: entry at the close of the first full session after the case was recorded, exit at the close 20 sessions later, SPY on the same dates. 15 bp is charged on each side. All judging uses these prices.',
  `The virtual portfolio buys $${V2_POLICY.positionCents / 100} per signal, at most ${V2_POLICY.maxPositions} open. A signal that arrives when all slots are taken is recorded as "not taken: slots full".`,
  'Portfolio entry is the first fresh IEX quote (under 15 minutes old, spread 1% or less) in a regular session after the case was recorded, within 1 trading day; otherwise the signal is not taken and the reason is logged. Exit is on the 20th trading day after entry. No early or discretionary exits. The portfolio is a realism check only.',
  'Not used for entry: the investment-case verdict (recorded alongside each signal as a shadow field only) and a market-value floor (no official share count yet).',
  'Judging (fixed): data-quality check at 20 closed signals; at 50, the average and median 20-day return vs SPY after costs with a 90% bootstrap interval, against cases that met the research rules without good news; if inconclusive, the same test again at 100.',
] as const;
export const V2_DISCLAIMER = 'Virtual money only. No broker, no real orders. A rule-following test fixed before any result; not advice, not a forecast and not evidence of an edge until the judging test says so. Even then it is not a buy or sell signal.';

const DAY = 86_400_000;
const C = V2_POLICY.costBpsPerSide / 10_000;
const instant = (s: unknown) => (typeof s === 'string' ? Date.parse(s) : NaN);

// ---- New York calendar ----------------------------------------------------------------
export const nyDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
function nyInstant(date: string, hour: number, minute: number): string {
  const guess = Date.parse(`${date}T${String(hour + 5).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`); // EST guess
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date(guess)));
  return new Date(guess - (h - hour) * 3_600_000).toISOString();
}
/** 09:30 New York time on a session date. */
export const openInstant = (date: string) => nyInstant(date, 9, 30);
/** 16:00 New York time on a session date (early closes are not known; only used to decide whether a session is over). */
export const closeInstant = (date: string) => nyInstant(date, 16, 0);
/** Regular US session by the New York clock (weekdays 09:30–16:00). Holidays are not known; on a holiday no fresh quote exists. */
export function regularSession(iso: string): boolean {
  const t = instant(iso); if (!Number.isFinite(t)) return false;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
  const mins = Number(p.hour) * 60 + Number(p.minute);
  return !['Sat', 'Sun'].includes(p.weekday) && mins >= 570 && mins < 960;
}

/** Closes keyed by New York session date, from Alpaca bars, keeping only sessions that had closed by `asOf`. */
export function closesBy(payload: any, asOf: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of Array.isArray(payload?.bars) ? payload.bars : []) {
    if (typeof b?.t !== 'string' || !Number.isFinite(Date.parse(b.t)) || typeof b.c !== 'number' || !Number.isFinite(b.c) || !(b.c > 0)) continue;
    const d = nyDate(b.t);
    if (closeInstant(d) > asOf) continue;
    out[d] = b.c;
  }
  return out;
}
/** Market calendar = SPY's completed sessions, sorted. */
export const sessionsOf = (spyCloses: Record<string, number>) => Object.keys(spyCloses).sort();
/** Sessions that had closed by `at`. */
export const sessionsBy = (sessions: string[], at: string) => sessions.filter(d => closeInstant(d) <= at);
/** The first session that starts at or after `recordedAt` ("first full session after recording"); null if it has not closed yet. */
export function firstFullSession(recordedAt: string, sessions: string[]): string | null {
  return sessions.find(d => openInstant(d) >= recordedAt) ?? null;
}

// ---- entry rules (section 2) ------------------------------------------------------------
export type V2Case = {
  caseId: string; symbol: string; status: string; assessedAt: string; screenVersion: string | null; conclusion: string;
  newsDirection: string; newsLabel: string; securityStatus: string | null; securityVersion: string | null; matchLevel: string;
  score: number | null; priceBasis: string | null; topics: string[]; headline: string; cik: string | null;
};
export type Close = { close: number; sessionDate: string; rawEventId: string } | null;
export type PriorSignal = { caseId: string; symbol: string; assessedAt: string };
export type RuleCode = 'not_good_news' | 'security_unverified' | 'event_match_unconfirmed' | 'no_price' | 'below_min_price' | 'company_open' | 'reentry_blocked';
const REASONS: Record<RuleCode, string> = {
  not_good_news: 'The news is not good news (news direction v1); bad, mixed and neutral news never enter.',
  security_unverified: 'The security is not confirmed as an ordinary US share under identity v2.',
  event_match_unconfirmed: 'The headline does not name this company; a ticker tag alone is not enough.',
  no_price: 'No IEX daily close was available at assessment time (unknown is never a pass).',
  below_min_price: `The latest IEX close at assessment time was below $${V2_POLICY.minCloseDollars}.`,
  company_open: 'This company already has an open signal.',
  reentry_blocked: `This company had a signal exit fewer than ${V2_POLICY.reentryBlockSessions} trading days before this case.`,
};
export const meetsResearchRules = (c: Pick<V2Case, 'screenVersion' | 'conclusion' | 'status'>) =>
  c.screenVersion === V2_POLICY.screenVersion && c.conclusion === V2_POLICY.screenConclusion && c.status === 'complete';

/** Rules 2–4, read only from the stored case. Null means all three pass. */
export function storedRuleFailure(c: V2Case): RuleCode | null {
  if (c.newsDirection !== V2_POLICY.newsDirection) return 'not_good_news';
  if (c.securityStatus !== V2_POLICY.securityStatus || c.securityVersion !== V2_POLICY.securityVersion) return 'security_unverified';
  if (c.matchLevel !== V2_POLICY.matchLevel) return 'event_match_unconfirmed';
  return null;
}

/**
 * Rule 6 for one company, using only sessions that had closed by the new case's assessment time.
 * A prior signal is open until the close of its exit session (entry session + 20); re-entry is blocked
 * until 20 more sessions have closed after that exit. Uses the SPY calendar, so it does not depend on
 * whether the prior signal's own prices were available.
 */
export function companyBlock(symbol: string, assessedAt: string, prior: PriorSignal[], sessions: string[], caseId = ''): 'company_open' | 'reentry_blocked' | null {
  const known = sessionsBy(sessions, assessedAt);
  for (const p of prior) {
    // Earlier signals only (assessment time, then case id), never the case itself.
    if (p.symbol !== symbol || p.caseId === caseId || p.assessedAt > assessedAt || (p.assessedAt === assessedAt && p.caseId > caseId)) continue;
    const entry = firstFullSession(p.assessedAt, known);
    if (!entry) return 'company_open';
    const i = known.indexOf(entry), exit = known[i + V2_POLICY.holdSessions];
    if (!exit) return 'company_open';
    if (known.filter(d => d > exit).length < V2_POLICY.reentryBlockSessions) return 'reentry_blocked';
  }
  return null;
}

/** Shadow fields recorded with every signal (section 2a). Never read by any rule. */
export function shadowFields(c: V2Case, sic: string | null) {
  const s = c.score;
  return {
    scoreBand: s === null || !Number.isFinite(s) ? 'No evidence score' : s >= 70 ? 'Strong evidence' : s >= 40 ? 'Mixed evidence' : 'Weak evidence',
    evidenceScore: s, priceBasis: c.priceBasis ?? 'unknown', eventType: c.topics.length ? c.topics : ['unknown'],
    sic: sic || null, sicNote: 'SEC industry code as stored today (not point in time).',
  };
}

export type Decision =
  | { outcome: 'signal'; code: 'signal'; reason: string; close: NonNullable<Close> }
  | { outcome: 'not_entered'; code: RuleCode; reason: string; close: Close };
/**
 * Decide one case that met the research rules. `close` is the latest IEX daily close completed by the
 * assessment time ('pending' when the price source could not be read yet), `sessions` the SPY calendar
 * (null when unavailable). Returns null when the answer is not knowable yet (wait and retry).
 */
export function decide(c: V2Case, close: Close | 'pending', prior: PriorSignal[], sessions: string[] | null): Decision | null {
  const stored = storedRuleFailure(c);
  if (stored) return { outcome: 'not_entered', code: stored, reason: REASONS[stored], close: null };
  if (close === 'pending') return null;
  if (!close) return { outcome: 'not_entered', code: 'no_price', reason: REASONS.no_price, close: null };
  if (!(close.close >= V2_POLICY.minCloseDollars)) return { outcome: 'not_entered', code: 'below_min_price', reason: REASONS.below_min_price, close };
  if (!sessions) return null;
  const block = companyBlock(c.symbol, c.assessedAt, prior, sessions, c.caseId);
  if (block) return { outcome: 'not_entered', code: block, reason: REASONS[block], close };
  return { outcome: 'signal', code: 'signal', reason: 'Meets the research rules, good news, ordinary share, named in the headline, IEX close of $5 or more, no open or recent signal for this company.', close };
}

// ---- signal ledger pricing (section 4, adjusted closes) ----------------------------------
export type SignalPrice =
  | { status: 'pending'; reason: string }
  | { status: 'no_price'; reason: string; entryDate: string; exitDate: string }
  | { status: 'priced'; entryDate: string; exitDate: string; stockEntry: number; stockExit: number; spyEntry: number; spyExit: number;
      grossReturn: number; afterCostReturn: number; spyReturn: number; excessReturn: number; excessGrossReturn: number };
/**
 * Entry = adjusted close of the first full session after recording; exit = adjusted close 20 SPY sessions later;
 * SPY on the same dates. A missing stock close on either date is `no_price` (never substituted).
 * After cost = (1 − 15 bp) × (1 + gross) × (1 − 15 bp) − 1. Excess = after-cost return − SPY return.
 */
export function priceSignal(recordedAt: string, stock: Record<string, number>, spy: Record<string, number>): SignalPrice {
  const sessions = sessionsOf(spy), entry = firstFullSession(recordedAt, sessions);
  if (!entry) return { status: 'pending', reason: 'The first full session after the case has not closed yet.' };
  const exit = sessions[sessions.indexOf(entry) + V2_POLICY.holdSessions];
  if (!exit) return { status: 'pending', reason: `Fewer than ${V2_POLICY.holdSessions} sessions have closed since entry.` };
  const se = stock[entry], sx = stock[exit];
  if (!(se > 0) || !(sx > 0)) return { status: 'no_price', reason: `No IEX close for the stock on ${!(se > 0) ? 'the entry date ' + entry : 'the exit date ' + exit}.`, entryDate: entry, exitDate: exit };
  const gross = sx / se - 1, after = (1 - C) * (1 + gross) * (1 - C) - 1, spyReturn = spy[exit] / spy[entry] - 1;
  return { status: 'priced', entryDate: entry, exitDate: exit, stockEntry: se, stockExit: sx, spyEntry: spy[entry], spyExit: spy[exit],
    grossReturn: gross, afterCostReturn: after, spyReturn, excessReturn: after - spyReturn, excessGrossReturn: gross - spyReturn };
}
/** Whether pricing can be attempted: the exit session (entry + 20) has closed. Needs only the SPY calendar. */
export function exitClosed(recordedAt: string, sessions: string[]) {
  const entry = firstFullSession(recordedAt, sessions);
  return !!entry && sessions.indexOf(entry) + V2_POLICY.holdSessions < sessions.length;
}

// ---- virtual portfolio (sections 3–4, live quotes) ----------------------------------------
export type Quote = { priceCents: number; at: string; rawEventId: string; source: string; spreadPct: number };
export function freshQuote(q: Quote | null | undefined, now: number): q is Quote {
  const at = instant(q?.at);
  return !!q && Number.isSafeInteger(q.priceCents) && q.priceCents > 0 && !!q.rawEventId && Number.isFinite(q.spreadPct) && q.spreadPct >= 0 && q.spreadPct <= V2_POLICY.maxSpreadPct
    && Number.isFinite(at) && at <= now && now - at <= V2_POLICY.maxQuoteAgeMinutes * 60_000;
}
const fee = (cents: number) => Math.ceil(cents * V2_POLICY.costBpsPerSide / 10_000);
const worth = (qtyMicros: number, priceCents: number) => Math.floor(qtyMicros * priceCents / 1_000_000);
export type OpenPosition = { positionId: string; caseId: string; symbol: string; openedAt: string; quantityMicros: number; spyQuantityMicros: number };
export type AwaitingFill = { caseId: string; symbol: string; assessedAt: string };
export type PlannedFill =
  | { kind: 'open'; caseId: string; symbol: string; code: 'opened'; reason: string; amountCents: number; costCents: number; quantityMicros: number; spyQuantityMicros: number; price: Quote; spy: Quote }
  | { kind: 'not_taken'; caseId: string; symbol: string; code: 'slots_full' | 'no_price' | 'no_cash' | 'stopped'; reason: string };
export type PlannedClose = { positionId: string; caseId: string; symbol: string; code: 'time_exit'; reason: string; late: boolean; price: Quote; spy: Quote; grossCents: number; costCents: number; proceedsCents: number; spyProceedsCents: number };

/** Sessions completed after the fill date, and whether today is the 20th session after entry (or later). */
export function exitDue(openedAt: string, now: string, sessions: string[]): { due: boolean; late: boolean; after: number } {
  const fillDate = nyDate(openedAt), after = sessionsBy(sessions, now).filter(d => d > fillDate), n = after.length, H = V2_POLICY.holdSessions;
  if (n >= H) return { due: true, late: true, after: n };
  const today = nyDate(now);
  return { due: n === H - 1 && regularSession(now) && today > (after.at(-1) ?? fillDate), late: false, after: n };
}

/**
 * One portfolio pass. Closes first (their cash and slots are not reused in the same pass). Signals that are
 * waiting for a fill hold a slot; a signal that finds all slots held is "not taken: slots full".
 * A missing or stale quote never fills. `sessions` may be null (calendar unavailable): then nothing closes
 * and no signal expires in this pass.
 */
export function planPortfolio(input: { now: string; cashCents: number; open: OpenPosition[]; awaiting: AwaitingFill[]; prices: Record<string, Quote | null | undefined>; sessions: string[] | null }) {
  const now = instant(input.now);
  if (!Number.isFinite(now) || !Number.isSafeInteger(input.cashCents) || input.cashCents < 0) throw new Error('Invalid portfolio snapshot');
  const closes: PlannedClose[] = [], fills: PlannedFill[] = [], waiting: { caseId?: string; positionId?: string; symbol: string; reason: string }[] = [], needs = new Set<string>();
  const spy = input.prices.SPY, spyOk = freshQuote(spy, now), regular = regularSession(input.now);
  if (input.sessions) for (const p of [...input.open].sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.positionId.localeCompare(b.positionId))) {
    const d = exitDue(p.openedAt, input.now, input.sessions);
    if (!d.due) continue;
    needs.add(p.symbol); needs.add('SPY');
    const q = input.prices[p.symbol];
    if (!regular || !freshQuote(q, now) || !spyOk) { waiting.push({ positionId: p.positionId, symbol: p.symbol, reason: 'Due to close; waiting for fresh stock and SPY quotes in a regular session.' }); continue; }
    const gross = worth(p.quantityMicros, q.priceCents), spyGross = worth(p.spyQuantityMicros, spy!.priceCents);
    if (!(gross > 0) || !(spyGross > 0)) { waiting.push({ positionId: p.positionId, symbol: p.symbol, reason: 'Position value could not be calculated.' }); continue; }
    closes.push({ positionId: p.positionId, caseId: p.caseId, symbol: p.symbol, code: 'time_exit', late: d.late, reason: `${V2_POLICY.holdSessions} trading days after entry${d.late ? ' (closed at the first fresh quote after the 20th session)' : ''}.`, price: q, spy: spy!, grossCents: gross, costCents: fee(gross), proceedsCents: gross - fee(gross), spyProceedsCents: spyGross - fee(spyGross) });
  }
  let cash = input.cashCents, slots = V2_POLICY.maxPositions - input.open.length;
  for (const s of [...input.awaiting].sort((a, b) => a.assessedAt.localeCompare(b.assessedAt) || a.caseId.localeCompare(b.caseId))) {
    const notTaken = (code: 'slots_full' | 'no_price' | 'no_cash', reason: string) => fills.push({ kind: 'not_taken', caseId: s.caseId, symbol: s.symbol, code, reason });
    if (slots <= 0) { notTaken('slots_full', `Not taken: slots full (${V2_POLICY.maxPositions} positions open or awaiting a fill).`); continue; }
    if (cash < V2_POLICY.positionCents) { notTaken('no_cash', 'Not taken: not enough virtual cash.'); continue; }
    // Expired: the first full session after recording has closed with no fill (that is "1 trading day").
    if (input.sessions && firstFullSession(s.assessedAt, sessionsBy(input.sessions, input.now))) { notTaken('no_price', 'Not taken: no fresh regular-session quote within 1 trading day of the case.'); continue; }
    slots--; cash -= V2_POLICY.positionCents; // held for this signal while it waits
    needs.add(s.symbol); needs.add('SPY');
    const q = input.prices[s.symbol];
    if (!regular || !freshQuote(q, now) || !spyOk || q.at < s.assessedAt || spy!.at < s.assessedAt) { waiting.push({ caseId: s.caseId, symbol: s.symbol, reason: 'Waiting for a fresh regular-session quote for the stock and SPY.' }); continue; }
    const cost = fee(V2_POLICY.positionCents), invest = V2_POLICY.positionCents - cost;
    const qty = Math.floor(invest * 1_000_000 / q.priceCents), spyQty = Math.floor(invest * 1_000_000 / spy!.priceCents);
    if (qty < 1 || spyQty < 1) { waiting.push({ caseId: s.caseId, symbol: s.symbol, reason: 'Position too small for the quoted price.' }); continue; }
    fills.push({ kind: 'open', caseId: s.caseId, symbol: s.symbol, code: 'opened', reason: 'Signal filled at the first fresh regular-session quote.', amountCents: V2_POLICY.positionCents, costCents: cost, quantityMicros: qty, spyQuantityMicros: spyQty, price: q, spy: spy! });
  }
  return { version: V2_VERSION, asOf: input.now, closes, fills, waiting, needsQuote: [...needs] };
}

export type FillRecord = PlannedFill & { version: string; experimentId: string; positionId?: string; at: string };
export type CloseRecord = PlannedClose & { version: string; experimentId: string; at: string };
/** Ledger → portfolio. Open positions are valued at a live quote after the simulated exit cost; no quote means unknown. */
export function portfolioState(input: { experimentId: string; fills: FillRecord[]; closes: CloseRecord[]; live: Record<string, Quote | null | undefined> }) {
  const fills = input.fills.filter(f => f.experimentId === input.experimentId).sort((a, b) => a.at.localeCompare(b.at));
  const closes = new Map(input.closes.filter(c => c.experimentId === input.experimentId).map(c => [c.positionId, c]));
  let cash = V2_POLICY.startingCashCents, costs = 0;
  const positions = fills.filter((f): f is FillRecord & Extract<PlannedFill, { kind: 'open' }> => f.kind === 'open').map(o => {
    const c = closes.get(o.positionId!) ?? null, lq = input.live[o.symbol] ?? null, sl = input.live.SPY ?? null;
    cash -= o.amountCents; costs += o.costCents; if (c) { cash += c.proceedsCents; costs += c.costCents; }
    const gross = c ? c.grossCents : lq ? worth(o.quantityMicros, lq.priceCents) : null;
    const value = c ? c.proceedsCents : gross === null ? null : gross - fee(gross);
    const spyGross = c ? null : sl ? worth(o.spyQuantityMicros, sl.priceCents) : null;
    const bench = c ? c.spyProceedsCents : spyGross === null ? null : spyGross - fee(spyGross);
    const r = (v: number | null) => (v === null ? null : (v - o.amountCents) / o.amountCents);
    return { positionId: o.positionId!, caseId: o.caseId, symbol: o.symbol, status: c ? 'closed' as const : 'open' as const, openedAt: o.at, closedAt: c?.at ?? null,
      entry: o.price, exit: c ? c.price : lq, exitIsLive: !c, valueCents: value, benchmarkCents: bench, returnPct: r(value), spyReturnPct: r(bench),
      vsSpy: r(value) !== null && r(bench) !== null ? r(value)! - r(bench)! : null, late: c?.late ?? false };
  });
  const open = positions.filter(p => p.status === 'open');
  const equity = open.some(p => p.valueCents === null) ? null : cash + open.reduce((s, p) => s + p.valueCents!, 0);
  return { startCents: V2_POLICY.startingCashCents, cashCents: cash, costsCents: costs, equityCents: equity, open, closed: positions.filter(p => p.status === 'closed'),
    notTaken: fills.filter(f => f.kind === 'not_taken').map(f => ({ caseId: f.caseId, symbol: f.symbol, code: f.code, reason: f.reason, at: f.at })),
    note: 'Realism check only (live quotes, not dividend-adjusted). The experiment is judged on the signal ledger.' };
}

// ---- judging (section 7) -------------------------------------------------------------------
function mulberry32(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
export function median(xs: number[]) { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
const quantile = (sorted: number[], q: number) => { const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos); return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo); };
/** Seeded percentile bootstrap of the mean (deterministic: same data, same interval). */
export function bootstrapMean(xs: number[], level = V2_POLICY.interval, resamples = V2_POLICY.bootstrapResamples, seed = V2_POLICY.bootstrapSeed) {
  const rnd = mulberry32(seed), n = xs.length, means: number[] = new Array(resamples);
  for (let r = 0; r < resamples; r++) { let s = 0; for (let i = 0; i < n; i++) s += xs[Math.floor(rnd() * n)]; means[r] = s / n; }
  means.sort((a, b) => a - b);
  return { lower: quantile(means, (1 - level) / 2), upper: quantile(means, 1 - (1 - level) / 2) };
}

export type PricedSignal = { caseId: string; symbol: string; assessedAt: string; exitDate: string; excessReturn: number };
/** The fixed test on the first `n` closed signals (by exit date), against the main comparison group's average. */
export function judgeSample(sample: number[], comparisonAverage: number | null) {
  const avg = mean(sample), med = median(sample), ci = bootstrapMean(sample);
  const beats = comparisonAverage === null ? null : avg > comparisonAverage, behind = comparisonAverage === null ? null : avg < comparisonAverage;
  const success = ci.lower > 0 && avg >= V2_POLICY.minAverageExcess && med > 0 && beats === true;
  const failure = avg <= 0 || behind === true;
  return { n: sample.length, average: avg, median: med, interval: ci, comparisonAverage, beatsComparison: beats, result: success ? 'success' as const : failure ? 'failure' as const : 'inconclusive' as const };
}

/**
 * Where the experiment stands. Data-quality check from 20 closed signals; the test at 50 and, if inconclusive, at 100.
 * Each test uses exactly the first 50 (or 100) closed signals in exit order, so later results cannot change it.
 */
export function judge(input: { signals: number; priced: PricedSignal[]; noPrice: number; duplicates: number; fills: { opened: number; notTaken: Record<string, number> }; comparisonAverageAt: (lastAssessedAt: string) => number | null }) {
  const closed = [...input.priced].sort((a, b) => a.exitDate.localeCompare(b.exitDate) || a.caseId.localeCompare(b.caseId)), n = closed.length;
  const quality = n >= V2_POLICY.qualityCheckAt ? { signals: input.signals, closedWithPrices: n, missingPrices: input.noPrice, duplicates: input.duplicates, portfolioFills: input.fills.opened, notTaken: input.fills.notTaken } : null;
  const at = (k: number) => { const s = closed.slice(0, k); return judgeSample(s.map(x => x.excessReturn), input.comparisonAverageAt(s.reduce((m, x) => (x.assessedAt > m ? x.assessedAt : m), ''))); };
  let stage: 'collecting' | 'quality_check' | 'tested_at_50' | 'tested_at_100' | 'waiting_for_100' = n < V2_POLICY.qualityCheckAt ? 'collecting' : 'quality_check';
  let test50 = null, test100 = null, result: 'not_yet' | 'success' | 'failure' | 'inconclusive' = 'not_yet';
  if (n >= V2_POLICY.firstTestAt) {
    test50 = at(V2_POLICY.firstTestAt); stage = 'tested_at_50'; result = test50.result;
    if (test50.result === 'inconclusive') { stage = 'waiting_for_100'; result = 'not_yet';
      if (n >= V2_POLICY.secondTestAt) { test100 = at(V2_POLICY.secondTestAt); stage = 'tested_at_100'; result = test100.result; } }
  }
  const text = {
    collecting: `Collecting: ${n} of ${V2_POLICY.qualityCheckAt} closed signals before the data-quality check. No verdict on performance.`,
    quality_check: `Data-quality check only (${n} closed signals). The performance test runs at ${V2_POLICY.firstTestAt}.`,
    tested_at_50: `Tested on the first ${V2_POLICY.firstTestAt} closed signals: ${result}.`,
    waiting_for_100: `Inconclusive at ${V2_POLICY.firstTestAt}; running on to ${V2_POLICY.secondTestAt} closed signals (${n} so far).`,
    tested_at_100: `Tested on the first ${V2_POLICY.secondTestAt} closed signals: ${result}.`,
  }[stage];
  return { stage, result, closedSignals: n, quality, test50, test100, text, note: 'Returns are 20-session returns after 15 bp per side minus SPY on the same dates. Even a success is not a buy or sell signal.' };
}

// ---- count of past stored cases (section 9) -------------------------------------------------
export type BackfillRow = { month: string; assessed: number; researchRules: number; goodNews: number; ordinaryShare: number; namedInHeadline: number; noPrice: number; belowMinPrice: number; priceNotChecked: number; companyBlocked: number; wouldSignal: number };
/**
 * How many past stored cases would have met section 2, per month of assessment (UTC). Simulated oldest first so
 * rule 6 sees earlier would-be signals. `closes[caseId]` is the latest IEX close completed by that case's
 * assessment (null: none; undefined: not checked in this request, counted as not passing and shown separately).
 */
export function backfillCount(cases: (V2Case & { researchRules: boolean })[], closes: Record<string, Close | undefined>, sessions: string[] | null) {
  const rows = new Map<string, BackfillRow>(), prior: PriorSignal[] = [];
  const row = (m: string) => rows.get(m) ?? (rows.set(m, { month: m, assessed: 0, researchRules: 0, goodNews: 0, ordinaryShare: 0, namedInHeadline: 0, noPrice: 0, belowMinPrice: 0, priceNotChecked: 0, companyBlocked: 0, wouldSignal: 0 }), rows.get(m)!);
  for (const c of [...cases].sort((a, b) => a.assessedAt.localeCompare(b.assessedAt) || a.caseId.localeCompare(b.caseId))) {
    const r = row(c.assessedAt.slice(0, 7)); r.assessed++;
    if (!c.researchRules) continue; r.researchRules++;
    if (c.newsDirection !== V2_POLICY.newsDirection) continue; r.goodNews++;
    if (c.securityStatus !== V2_POLICY.securityStatus || c.securityVersion !== V2_POLICY.securityVersion) continue; r.ordinaryShare++;
    if (c.matchLevel !== V2_POLICY.matchLevel) continue; r.namedInHeadline++;
    const close = closes[c.caseId];
    if (close === undefined) { r.priceNotChecked++; continue; }
    const d = decide(c, close, prior, sessions);
    if (!d) { r.priceNotChecked++; continue; }
    if (d.code === 'no_price') r.noPrice++; else if (d.code === 'below_min_price') r.belowMinPrice++; else if (d.code === 'company_open' || d.code === 'reentry_blocked') r.companyBlocked++;
    else if (d.outcome === 'signal') { r.wouldSignal++; prior.push({ caseId: c.caseId, symbol: c.symbol, assessedAt: c.assessedAt }); }
  }
  const months = [...rows.values()].sort((a, b) => a.month.localeCompare(b.month));
  const total = months.reduce((t, m) => { for (const k of Object.keys(m) as (keyof BackfillRow)[]) if (k !== 'month') (t as any)[k] += m[k]; return t; }, { month: 'total', assessed: 0, researchRules: 0, goodNews: 0, ordinaryShare: 0, namedInHeadline: 0, noPrice: 0, belowMinPrice: 0, priceNotChecked: 0, companyBlocked: 0, wouldSignal: 0 } as BackfillRow);
  return { version: V2_VERSION, months, total };
}

// ---- comparison groups (section 6) ------------------------------------------------------------
export type ComparisonGroup = 'research_rules_not_good_news' | 'research_rules_good_news';
export const comparisonGroup = (direction: string): ComparisonGroup => (direction === V2_POLICY.newsDirection ? 'research_rules_good_news' : 'research_rules_not_good_news');
export const average = (xs: number[]) => (xs.length ? mean(xs) : null);
export const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;
