/**
 * Shared statistics for research measurement (research-stats-v1, 2026-11-25). Pure, no imports, no I/O.
 * Used by the offline harness (scripts/research/harness.mjs) and the selection comparison (selection-comparison.ts),
 * so both apply the same costs, validity rules, median and uncertainty interval.
 *
 * Methods (ideas only, no code copied): purging overlapping outcome windows and the moving-block bootstrap for
 * overlapping returns are standard in the financial-ML literature (also covered in "Machine Learning for Trading").
 */
export const STATS_VERSION = 'research-stats-v1';
export const COST_PER_SIDE = 0.0015; // 15 bp per side, as everywhere else in Sentinel

/** A simple return after paying COST_PER_SIDE on entry and on exit. */
export const afterCosts = (gross: number) => (1 - COST_PER_SIDE) * (1 + gross) * (1 - COST_PER_SIDE) - 1;
/** Stock minus SPY, both after the same costs: a stock that matches SPY shows 0, whatever the costs. */
export const excessAfterCosts = (stock: number, spy: number) => afterCosts(stock) - afterCosts(spy);
export const COST_BASIS = `Stock and SPY each pay ${COST_PER_SIDE * 1e4} bp on entry and ${COST_PER_SIDE * 1e4} bp on exit (simulated), so a stock that matches SPY shows zero excess.`;

/** A usable simple return: a finite number above -100%. */
export const validReturn = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > -1;
export const validDay = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;

export const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
/** The middle value; for an even count, the average of the two middle values. */
export function median(xs: number[]) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * Block length for overlapping windows: the median number of distinct decision dates that fall inside one
 * observation's outcome window (its decision date up to its exit date). At least 1.
 */
export function overlapBlockLength(rows: { date: string; exitDate: string }[]) {
  const dates = [...new Set(rows.map(r => r.date))].sort();
  if (!rows.length) return 1;
  const spans = rows.map(r => dates.filter(d => d >= r.date && d <= r.exitDate).length);
  return Math.max(1, Math.round(median(spans)));
}

/**
 * Moving-block bootstrap over time-ordered decision dates (circular). Everything recorded on one date stays together,
 * and runs of `blockLength` consecutive dates are drawn together, so the overlap between nearby outcome windows is
 * kept in each resample. blockLength 1 is the ordinary date-level bootstrap. Seeded: same data, same interval.
 * `statistic` receives the resampled dates' payloads and returns a number (NaN resamples are skipped).
 */
export function blockBootstrap<T>(byDate: { date: string; value: T }[], statistic: (sample: T[]) => number, opts: { blockLength?: number; resamples?: number; seed?: number; level?: number } = {}) {
  const groups = [...byDate].sort((a, b) => a.date.localeCompare(b.date)).map(g => g.value);
  const n = groups.length, L = Math.max(1, Math.min(n, Math.round(opts.blockLength ?? 1))), R = opts.resamples ?? 2000, level = opts.level ?? 0.9, rnd = rng(opts.seed ?? 20261125);
  if (!n) return { lower: NaN, upper: NaN, blockLength: L, resamples: 0 };
  const out: number[] = [];
  for (let k = 0; k < R; k++) {
    const sample: T[] = [];
    while (sample.length < n) { const start = Math.floor(rnd() * n); for (let j = 0; j < L && sample.length < n; j++) sample.push(groups[(start + j) % n]); }
    const v = statistic(sample); if (Number.isFinite(v)) out.push(v);
  }
  if (!out.length) return { lower: NaN, upper: NaN, blockLength: L, resamples: 0 };
  out.sort((x, y) => x - y);
  const m = out.length;
  return { lower: out[Math.floor(m * (1 - level) / 2)], upper: out[Math.ceil(m * (1 + level) / 2) - 1], blockLength: L, resamples: m };
}

/** Block bootstrap of the mean of all values (each date's values kept together). */
export function blockBootstrapMean(byDate: { date: string; values: number[] }[], opts: { blockLength?: number; resamples?: number; seed?: number; level?: number } = {}) {
  const r = blockBootstrap(byDate.filter(g => g.values.length).map(g => ({ date: g.date, value: g.values })), sample => { let s = 0, c = 0; for (const v of sample) for (const x of v) { s += x; c++; } return c ? s / c : NaN; }, opts);
  return { lower: r.lower, upper: r.upper, blockLength: r.blockLength };
}
