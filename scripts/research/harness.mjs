// Offline research harness (2026-11-16; harness-v2 2026-11-25). Never imported by the Worker; nothing here reaches the
// UI or any API. It answers one narrow question reproducibly: does a rule fixed in advance select observations whose
// forward return beats SPY after costs, on data the rule has never seen? Synthetic fixtures only so far: no claim about
// real performance can be made until real point-in-time data is loaded (docs/specs/prediction-feasibility-2026-11-16.md).
//
// Observation: { date:'YYYY-MM-DD' (decision date), exitDate:'YYYY-MM-DD' (last date the forward return uses),
//                symbol, features:{...known by date}, fwd: stock forward return, spyFwd: SPY forward return, same dates }
//
// harness-v2 fixes four defects found on 2026-11-25 (docs/specs/research-evaluation-stage1-2026-11-25.md):
//  1. outcome windows crossing into a later set: rows now carry exitDate and are purged when the window reaches the
//     next set (a fixed calendar embargo could not see a 60-session window);
//  2. costs: stock and SPY now pay the same costs (a stock matching SPY shows 0, not -0.3%);
//  3. invalid rows (bad dates, non-finite or <= -100% returns, exit not after decision) are rejected and counted;
//  4. the median of an even count is the average of the two middle values.
// The interval is now a moving-block bootstrap over decision dates, sized to the window overlap.
import { COST_PER_SIDE, afterCosts, excessAfterCosts, validReturn, validDay, mean, median, overlapBlockLength, blockBootstrapMean, COST_BASIS } from '../../lib/sentinel/research-stats.ts';

export const HARNESS_VERSION = 'harness-v2';
export { COST_PER_SIDE, COST_BASIS };
/** Kept for callers of harness-v1: a single return after costs on both sides. */
export const net = afterCosts;
export const MIN_SELECTED = 30;

/** Splits rows into usable and rejected, with the reason for each rejection. Nothing is repaired or guessed. */
export function validateRows(rows) {
  const valid = [], rejected = [];
  rows.forEach((r, index) => {
    const reason = !r || typeof r !== 'object' ? 'not an observation'
      : !validDay(r.date) ? 'decision date missing or invalid'
      : !validDay(r.exitDate) ? 'exit date missing or invalid'
      : r.exitDate <= r.date ? 'exit date is not after the decision date'
      : !validReturn(r.fwd) ? 'stock return missing, not finite, or -100% or worse'
      : !validReturn(r.spyFwd) ? 'SPY return missing, not finite, or -100% or worse'
      : null;
    if (reason) rejected.push({ index, symbol: r?.symbol ?? null, date: r?.date ?? null, reason }); else valid.push(r);
  });
  return { valid, rejected };
}

const shift = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/**
 * Time-ordered split by decision date into train / validation / test, with purging: an observation is kept in an
 * earlier set only if its whole outcome window (to exitDate) ends before the next set starts, minus an optional
 * embargo in calendar days. So no return is seen by two sets. Invalid rows are rejected first and reported.
 */
export function timeSplit(rows, { train = 0.6, validation = 0.2, embargoDays = 0 } = {}) {
  const { valid, rejected } = validateRows(rows);
  const dates = [...new Set(valid.map(r => r.date))].sort();
  if (dates.length < 10) throw new Error('Too few valid decision dates to split.');
  const a = dates[Math.floor(dates.length * train)], b = dates[Math.floor(dates.length * (train + validation))];
  const endsBefore = (r, boundary) => r.exitDate < shift(boundary, -embargoDays);
  const inTrain = valid.filter(r => r.date < a), inVal = valid.filter(r => r.date >= a && r.date < b);
  const trainKept = inTrain.filter(r => endsBefore(r, a)), valKept = inVal.filter(r => endsBefore(r, b));
  return {
    boundaries: { validationFrom: a, testFrom: b, embargoDays },
    train: trainKept, validation: valKept, test: valid.filter(r => r.date >= b),
    purged: { train: inTrain.length - trainKept.length, validation: inVal.length - valKept.length },
    rejected,
  };
}

/** Evaluate a selection rule on one set: average and median excess vs SPY, both after the same costs, with a block-bootstrap interval. */
export function evaluate(rows, select, label) {
  const { valid, rejected } = validateRows(rows);
  const picked = valid.filter(select);
  if (picked.length < MIN_SELECTED) return { label, n: picked.length, rejected: rejected.length, status: 'too_few', note: `Fewer than ${MIN_SELECTED} selected observations: no figure.` };
  const ex = picked.map(r => excessAfterCosts(r.fwd, r.spyFwd));
  const byDate = new Map(); picked.forEach((r, i) => byDate.set(r.date, [...(byDate.get(r.date) ?? []), ex[i]]));
  const blockLength = overlapBlockLength(picked);
  return { label, n: picked.length, rejected: rejected.length, dates: byDate.size, status: 'computed', averageExcess: mean(ex), medianExcess: median(ex), shareAboveSpy: ex.filter(x => x > 0).length / ex.length,
    interval90: blockBootstrapMean([...byDate.entries()].map(([date, values]) => ({ date, values })), { blockLength }), costBasis: COST_BASIS };
}

/** The fixed sequence: baselines first, then the candidate rule, on validation; the test set only through `finalTest`. */
export function compare(rows, rule, name) {
  return [evaluate(rows, () => true, 'Baseline: every observation, equal weight'), evaluate(rows, rule, name)];
}
/** The test set is read once per frozen rule. `frozen` must describe the rule completely (it is echoed into the report). */
export function finalTest(split, rule, frozen) {
  if (!frozen || typeof frozen.name !== 'string' || !frozen.definedOn) throw new Error('Freeze the rule (name, definition, the date it was fixed) before touching the test set.');
  const [base, cand] = compare(split.test, rule, frozen.name);
  const pass = cand.status === 'computed' && base.status === 'computed' && cand.interval90.lower > 0 && cand.averageExcess > base.averageExcess;
  return { version: HARNESS_VERSION, frozen, boundaries: split.boundaries, purged: split.purged, rejected: split.rejected.length, baseline: base, candidate: cand, gate: pass ? 'passed' : 'not_passed', gateRule: '90% block-bootstrap interval lower bound above 0 (stock and SPY after the same costs) AND above the equal-weight baseline, on the untouched test set.' };
}
