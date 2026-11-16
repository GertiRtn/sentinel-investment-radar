// Offline research harness (2026-11-16). Never imported by the Worker; nothing here reaches the UI or any API.
// It answers one narrow question reproducibly: does a rule fixed in advance select observations whose forward
// return beats SPY after costs, on data the rule has never seen? Synthetic fixtures only so far: no claim about
// real performance can be made until real point-in-time data is loaded (docs/specs/prediction-feasibility-2026-11-16.md).
//
// Observation: { date:'YYYY-MM-DD' (decision date), symbol, features:{...known by date}, fwd: stock forward return,
//                spyFwd: SPY forward return over the same sessions }
export const COST_PER_SIDE = 0.0015;
export const net = gross => (1 - COST_PER_SIDE) * (1 + gross) * (1 - COST_PER_SIDE) - 1;

/** Time-ordered split by decision date. An embargo of `embargoDays` after each boundary drops observations whose
 *  forward window would overlap the next set, so no return is seen by two sets. */
export function timeSplit(rows, { train = 0.6, validation = 0.2, embargoDays = 30 } = {}) {
  const dates = [...new Set(rows.map(r => r.date))].sort();
  if (dates.length < 10) throw new Error('Too few decision dates to split.');
  const a = dates[Math.floor(dates.length * train)], b = dates[Math.floor(dates.length * (train + validation))];
  const plus = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const minus = (d, n) => plus(d, -n);
  return { boundaries: { validationFrom: a, testFrom: b, embargoDays },
    train: rows.filter(r => r.date < minus(a, embargoDays)), validation: rows.filter(r => r.date >= a && r.date < minus(b, embargoDays)), test: rows.filter(r => r.date >= b) };
}

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
/** Bootstrap over whole decision dates (returns on one date are not independent). */
export function bootstrapByDate(rows, value, { resamples = 2000, seed = 20261116, level = 0.9 } = {}) {
  const byDate = new Map(); for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), value(r)]);
  const groups = [...byDate.values()], rnd = rng(seed), out = [];
  for (let k = 0; k < resamples; k++) { const xs = []; for (let i = 0; i < groups.length; i++) xs.push(...groups[Math.floor(rnd() * groups.length)]); out.push(mean(xs)); }
  out.sort((x, y) => x - y);
  return { lower: out[Math.floor(out.length * (1 - level) / 2)], upper: out[Math.ceil(out.length * (1 + level) / 2) - 1] };
}

/** Evaluate a selection rule on one set: average and median excess return vs SPY after costs, with an interval. */
export function evaluate(rows, select, label) {
  const picked = rows.filter(select);
  if (picked.length < 30) return { label, n: picked.length, status: 'too_few', note: 'Fewer than 30 selected observations: no figure.' };
  const ex = picked.map(r => net(r.fwd) - r.spyFwd).sort((x, y) => x - y);
  return { label, n: picked.length, dates: new Set(picked.map(r => r.date)).size, status: 'computed', averageExcess: mean(ex), medianExcess: ex[ex.length >> 1], shareAboveSpy: ex.filter(x => x > 0).length / ex.length,
    interval90: bootstrapByDate(picked, r => net(r.fwd) - r.spyFwd) };
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
  return { frozen, boundaries: split.boundaries, baseline: base, candidate: cand, gate: pass ? 'passed' : 'not_passed', gateRule: '90% interval lower bound above 0 after costs AND above the equal-weight baseline, on the untouched test set.' };
}
