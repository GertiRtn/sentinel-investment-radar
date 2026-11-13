/**
 * Automated Practice experiment (auto-practice-v1, 2026-11-13). Virtual money only.
 *
 * Pure: no fetching, no storage, no orders. `planAuto` turns a point-in-time
 * snapshot into decisions; `autoState` folds the stored ledger into a portfolio.
 * The runner (auto-practice-run.ts) loads records, fetches recorded quotes and
 * appends what this module decides.
 *
 * It builds on the planner Codex drafted on 2026-11-13
 * (branch codex/automated-practice-experiment): same budget, position size,
 * limits, 30-day time exit and 15 bp cost assumption. Added here: the
 * event-company match gate, prospective-only selection, the split between a
 * final skip and "still waiting", net-of-cost accounting and a SPY benchmark
 * that pays the same costs.
 *
 * What it is: a rule-following test of whether cases that meet Sentinel's
 * research rules do better than SPY after costs. The rules are a hypothesis
 * fixed before any outcome was seen. It is not a forecast, not advice and not
 * evidence of an edge until enough trades have closed. A changed rule is a new
 * version and a new experiment, never an edit.
 */
export const AUTO_VERSION = 'auto-practice-v1';
export const AUTO_POLICY = Object.freeze({
  strategy: 'event-driven-v1',
  startingCashCents: 1_000_000, // $10,000 virtual, separate from the manual Practice portfolio
  positionCents: 100_000,       // $1,000 per position
  maxPositions: 5,
  maxOpensPerRun: 2,
  holdDays: 30,                 // time exit after 30 calendar days
  maxCaseAgeHours: 96,          // an event-driven entry later than 4 days after assessment is not taken
  maxQuoteAgeMinutes: 15,
  maxSpreadPct: 1,
  costBpsPerSide: 15,           // simulated spread + slippage, each side
});
export const AUTO_RULES_TEXT = [
  'Considers only cases assessed after the experiment started (no look-back).',
  'Opens a case when: it meets the research rules (screen v2), the security is an ordinary US share (identity v2), and the company is named in the headline (event match v1).',
  `Buys $${AUTO_POLICY.positionCents / 100} per position, at most ${AUTO_POLICY.maxPositions} positions, one per company, at most ${AUTO_POLICY.maxOpensPerRun} new positions per check, oldest assessment first.`,
  `Needs an IEX quote under ${AUTO_POLICY.maxQuoteAgeMinutes} minutes old with a spread of ${AUTO_POLICY.maxSpreadPct}% or less for both the stock and SPY, so it only trades while the US market is open.`,
  `A case that cannot be opened within ${AUTO_POLICY.maxCaseAgeHours} hours of its assessment is skipped for good, with the reason recorded.`,
  `Closes every position after ${AUTO_POLICY.holdDays} calendar days (time exit only in v1).`,
  `Charges ${AUTO_POLICY.costBpsPerSide / 100}% of the trade value on each side as simulated costs. The SPY comparison pays the same costs.`,
] as const;

const DAY = 86_400_000, HOUR = 3_600_000;
export type Quote = { priceCents: number; at: string; rawEventId: string; source: string; spreadPct: number };
export type Candidate = {
  caseId: string; symbol: string; status: string; assessedAt: string; publishedAt: string | null; firstObservedAt: string | null;
  screenVersion: string | null; conclusion: string; securityStatus: string | null; securityVersion: string | null;
  matchLevel: string; score: number | null; headline: string;
};
export type OpenPosition = { positionId: string; symbol: string; openedAt: string; quantityMicros: number; spyQuantityMicros: number };
type CaseNote = { assessedAt: string; publishedAt: string | null; conclusion: string; screenVersion: string | null; score: number | null; matchLevel: string; headline: string };
export type PlannedOpen = { kind: 'open'; caseId: string; symbol: string; code: 'opened'; reason: string; amountCents: number; costCents: number; quantityMicros: number; spyQuantityMicros: number; price: Quote; spy: Quote; exitRule: string; case: CaseNote };
export type PlannedSkip = { kind: 'skip'; caseId: string; symbol: string; code: string; reason: string; case: CaseNote };
export type PlannedClose = { positionId: string; symbol: string; code: 'time_exit'; reason: string; price: Quote; spy: Quote; grossCents: number; costCents: number; proceedsCents: number; spyProceedsCents: number };
export type Waiting = { caseId?: string; positionId?: string; symbol: string; reason: string };

const instant = (s: unknown) => (typeof s === 'string' ? Date.parse(s) : NaN);
const cost = (cents: number) => Math.ceil(cents * AUTO_POLICY.costBpsPerSide / 10_000);
const worth = (qtyMicros: number, priceCents: number) => Math.floor(qtyMicros * priceCents / 1_000_000);
export function freshQuote(q: Quote | null | undefined, now: number): q is Quote {
  const at = instant(q?.at);
  return !!q && Number.isSafeInteger(q.priceCents) && q.priceCents > 0 && !!q.rawEventId && Number.isFinite(q.spreadPct) && q.spreadPct >= 0 && q.spreadPct <= AUTO_POLICY.maxSpreadPct
    && Number.isFinite(at) && at <= now && now - at <= AUTO_POLICY.maxQuoteAgeMinutes * 60_000;
}
const note = (c: Candidate): CaseNote => ({ assessedAt: c.assessedAt, publishedAt: c.publishedAt, conclusion: c.conclusion, screenVersion: c.screenVersion, score: c.score, matchLevel: c.matchLevel, headline: c.headline.slice(0, 300) });

/**
 * One planning pass. Closes are planned first; their cash and slots are NOT reused in the same pass
 * (the next run plans from the confirmed ledger). A missing or stale price never produces a fill.
 * `needsQuote` lists the symbols whose prices would let this pass act, so the runner can fetch only those.
 */
export function planAuto(input: {
  now: string; startedAt: string; active: boolean; cashCents: number; open: OpenPosition[]; decidedCaseIds: string[];
  candidates: Candidate[]; prices: Record<string, Quote | null | undefined>;
}) {
  const now = instant(input.now), started = instant(input.startedAt);
  if (!Number.isFinite(now) || !Number.isFinite(started) || !Number.isSafeInteger(input.cashCents) || input.cashCents < 0) throw new Error('Invalid experiment snapshot');
  const closes: PlannedClose[] = [], opens: PlannedOpen[] = [], skips: PlannedSkip[] = [], waiting: Waiting[] = [], needs = new Set<string>();
  const spy = input.prices.SPY, spyOk = freshQuote(spy, now);
  let notMeetingRules = 0, beforeStart = 0;

  for (const p of [...input.open].sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.positionId.localeCompare(b.positionId))) {
    const opened = instant(p.openedAt);
    if (!Number.isFinite(opened) || now - opened < AUTO_POLICY.holdDays * DAY) continue;
    needs.add(p.symbol); needs.add('SPY');
    const q = input.prices[p.symbol];
    if (!freshQuote(q, now) || !spyOk) { waiting.push({ positionId: p.positionId, symbol: p.symbol, reason: 'Due to close; waiting for fresh stock and SPY quotes (market hours).' }); continue; }
    const gross = worth(p.quantityMicros, q.priceCents), spyGross = worth(p.spyQuantityMicros, spy!.priceCents);
    if (!(gross > 0) || !(spyGross > 0)) { waiting.push({ positionId: p.positionId, symbol: p.symbol, reason: 'Position value could not be calculated.' }); continue; }
    closes.push({ positionId: p.positionId, symbol: p.symbol, code: 'time_exit', reason: `${AUTO_POLICY.holdDays}-day holding period completed.`, price: q, spy: spy!, grossCents: gross, costCents: cost(gross), proceedsCents: gross - cost(gross), spyProceedsCents: spyGross - cost(spyGross) });
  }

  let cash = input.cashCents, slots = Math.max(0, AUTO_POLICY.maxPositions - input.open.length), opened = 0;
  const held = new Set(input.open.map(p => p.symbol)), decided = new Set(input.decidedCaseIds);
  const ordered = [...input.candidates].sort((a, b) => a.assessedAt.localeCompare(b.assessedAt) || a.caseId.localeCompare(b.caseId));
  for (const c of ordered) {
    if (decided.has(c.caseId)) continue;
    const assessed = instant(c.assessedAt);
    if (!Number.isFinite(assessed) || assessed > now) continue; // unusable record: never acted on
    if (assessed <= started) { beforeStart++; continue; }
    if (c.screenVersion !== 'research-screen-v2' || c.conclusion !== 'INVESTIGATE' || c.status !== 'complete') { notMeetingRules++; continue; }
    const skip = (code: string, reason: string) => { skips.push({ kind: 'skip', caseId: c.caseId, symbol: c.symbol, code, reason, case: note(c) }); decided.add(c.caseId); };
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(c.symbol)) { skip('invalid_symbol', 'The case has no usable ticker.'); continue; }
    const pub = instant(c.publishedAt), seen = instant(c.firstObservedAt);
    if (!Number.isFinite(pub) || !Number.isFinite(seen) || pub > seen || seen > assessed) { skip('invalid_timing', 'Publication, first-seen and assessment times are missing or out of order.'); continue; }
    if (c.securityStatus !== 'candidate_common' || c.securityVersion !== 'security-identity-v2') { skip('security_unverified', 'The security is not confirmed as an ordinary US share under identity v2.'); continue; }
    if (c.matchLevel !== 'named_in_headline') { skip('event_match_unconfirmed', 'The headline does not name this company; a ticker tag alone is not enough to act on.'); continue; }
    if (held.has(c.symbol)) { skip('already_held', 'The experiment already holds this company.'); continue; }
    let wait = '';
    if (!input.active) wait = 'The experiment is stopped; no new positions.';
    else if (opened >= AUTO_POLICY.maxOpensPerRun) wait = `Limit of ${AUTO_POLICY.maxOpensPerRun} new positions per check reached.`;
    else if (slots <= 0) wait = `All ${AUTO_POLICY.maxPositions} position slots are in use.`;
    else if (cash < AUTO_POLICY.positionCents) wait = 'Not enough virtual cash.';
    if (!wait) {
      needs.add(c.symbol); needs.add('SPY');
      const q = input.prices[c.symbol];
      if (!freshQuote(q, now) || !spyOk) wait = 'No fresh, narrow IEX quote for the stock and SPY (the US market may be closed).';
      else {
        const fee = cost(AUTO_POLICY.positionCents), invest = AUTO_POLICY.positionCents - fee;
        const qty = Math.floor(invest * 1_000_000 / q.priceCents), spyQty = Math.floor(invest * 1_000_000 / spy!.priceCents);
        if (qty < 1 || spyQty < 1) wait = 'Position too small for the quoted price.';
        else {
          opens.push({ kind: 'open', caseId: c.caseId, symbol: c.symbol, code: 'opened', reason: 'Meets the research rules, ordinary share confirmed, company named in the headline; oldest eligible assessment first.', amountCents: AUTO_POLICY.positionCents, costCents: fee, quantityMicros: qty, spyQuantityMicros: spyQty, price: q, spy: spy!, exitRule: `Close after ${AUTO_POLICY.holdDays} calendar days.`, case: note(c) });
          cash -= AUTO_POLICY.positionCents; slots--; opened++; held.add(c.symbol); decided.add(c.caseId); continue;
        }
      }
    }
    if (now - assessed > AUTO_POLICY.maxCaseAgeHours * HOUR) skip('expired', `Not opened within ${AUTO_POLICY.maxCaseAgeHours} hours of assessment. Last reason: ${wait}`);
    else waiting.push({ caseId: c.caseId, symbol: c.symbol, reason: wait });
  }
  return { version: AUTO_VERSION, asOf: input.now, closes, opens, skips, waiting, needsQuote: [...needs], counts: { candidates: input.candidates.length, notMeetingRules, beforeStart } };
}

// ---- ledger → portfolio -------------------------------------------------------
export type Control = { version: string; action: 'start' | 'stop'; experimentId: string; at: string; policy?: typeof AUTO_POLICY };
export type DecisionRecord = (PlannedOpen | PlannedSkip) & { version: string; experimentId: string; positionId?: string; at: string };
export type CloseRecord = PlannedClose & { version: string; experimentId: string; at: string };
const ret = (from: number, to: number) => (from > 0 ? (to - from) / from * 100 : null);

/** The latest experiment and whether it is taking new positions. */
export function currentExperiment(controls: Control[]) {
  const sorted = [...controls].sort((a, b) => a.at.localeCompare(b.at));
  const start = sorted.filter(c => c.action === 'start').at(-1);
  if (!start) return null;
  const stop = sorted.find(c => c.action === 'stop' && c.experimentId === start.experimentId);
  return { experimentId: start.experimentId, startedAt: start.at, stoppedAt: stop?.at ?? null, active: !stop, policy: start.policy ?? AUTO_POLICY, earlier: new Set(sorted.filter(c => c.action === 'start').map(c => c.experimentId)).size - 1 };
}

export function autoState(input: { experimentId: string; decisions: DecisionRecord[]; closes: CloseRecord[]; live: Record<string, Quote | null | undefined>; now: string }) {
  const mine = input.decisions.filter(d => d.experimentId === input.experimentId).sort((a, b) => a.at.localeCompare(b.at));
  const closes = new Map(input.closes.filter(c => c.experimentId === input.experimentId).map(c => [c.positionId, c]));
  let cash = AUTO_POLICY.startingCashCents, costs = 0;
  const spyLive = input.live.SPY ?? null;
  const positions = mine.filter((d): d is DecisionRecord & PlannedOpen => d.kind === 'open').map(o => {
    const id = o.positionId!, c = closes.get(id) ?? null;
    cash -= o.amountCents; costs += o.costCents;
    if (c) { cash += c.proceedsCents; costs += c.costCents; }
    const lq = input.live[o.symbol] ?? null;
    // An open position is valued at the price it could be sold for today, after the simulated exit cost.
    const gross = c ? c.grossCents : lq ? worth(o.quantityMicros, lq.priceCents) : null;
    const valueCents = c ? c.proceedsCents : gross === null ? null : gross - cost(gross);
    const spyGross = c ? null : spyLive ? worth(o.spyQuantityMicros, spyLive.priceCents) : null;
    const benchmarkCents = c ? c.spyProceedsCents : spyGross === null ? null : spyGross - cost(spyGross);
    const returnPct = valueCents === null ? null : ret(o.amountCents, valueCents), spyReturnPct = benchmarkCents === null ? null : ret(o.amountCents, benchmarkCents);
    const ageDays = Math.floor(((c ? Date.parse(c.at) : Date.parse(input.now)) - Date.parse(o.at)) / DAY);
    return {
      positionId: id, caseId: o.caseId, symbol: o.symbol, status: c ? 'closed' as const : 'open' as const, openedAt: o.at, closedAt: c?.at ?? null, ageDays,
      dueAt: new Date(Date.parse(o.at) + AUTO_POLICY.holdDays * DAY).toISOString(),
      amountCents: o.amountCents, quantityMicros: o.quantityMicros, spyQuantityMicros: o.spyQuantityMicros, entry: o.price, entrySpy: o.spy, exit: c ? c.price : lq, exitIsLive: !c,
      valueCents, benchmarkCents, returnPct, spyReturnPct, vsSpyPct: returnPct !== null && spyReturnPct !== null ? returnPct - spyReturnPct : null,
      reason: o.reason, exitRule: o.exitRule, closeReason: c?.reason ?? null, case: o.case,
    };
  });
  const open = positions.filter(p => p.status === 'open'), closed = positions.filter(p => p.status === 'closed');
  const unpriced = open.some(p => p.valueCents === null), benchUnpriced = open.some(p => p.benchmarkCents === null);
  const equityCents = unpriced ? null : cash + open.reduce((s, p) => s + p.valueCents!, 0);
  // Benchmark: the same dollars put into SPY at the same moments, paying the same costs; unused cash stays cash.
  const benchmarkCents = benchUnpriced ? null : AUTO_POLICY.startingCashCents - positions.reduce((s, p) => s + p.amountCents, 0) + positions.reduce((s, p) => s + p.benchmarkCents!, 0);
  const done = closed.filter(p => p.vsSpyPct !== null);
  return {
    version: AUTO_VERSION, experimentId: input.experimentId, startCents: AUTO_POLICY.startingCashCents, cashCents: cash, costsCents: costs,
    equityCents, benchmarkCents, returnPct: equityCents === null ? null : ret(AUTO_POLICY.startingCashCents, equityCents), benchmarkReturnPct: benchmarkCents === null ? null : ret(AUTO_POLICY.startingCashCents, benchmarkCents),
    open, closed,
    skipped: mine.filter(d => d.kind === 'skip').reverse(),
    record: { closedTrades: done.length, beatSpy: done.filter(p => p.vsSpyPct! > 0).length, enough: done.length >= MIN_CLOSED_FOR_RECORD,
      note: done.length >= MIN_CLOSED_FOR_RECORD ? 'Closed trades net of simulated costs, against SPY paying the same costs.' : `Too few closed trades to say anything (${done.length} of at least ${MIN_CLOSED_FOR_RECORD}).` },
  };
}
export const MIN_CLOSED_FOR_RECORD = 20;
