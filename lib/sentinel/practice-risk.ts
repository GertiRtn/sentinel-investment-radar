/**
 * Practice portfolio risk check (practice-risk-v1). SIMULATED, ON DEMAND, PRACTICE POSITIONS ONLY.
 *
 * Pure. Inputs: the open virtual Practice positions at their live marks, cash, and archived daily
 * closes for each symbol. Nothing here places, sizes or suggests a trade, and nothing is stored.
 *
 * Method — historical bootstrap ("filtered" by nothing, kept deliberately simple):
 *  - Daily simple returns are computed on dates where EVERY held symbol has a close, over the last
 *    `lookbackSessions` such dates. Sampling whole days keeps the historical co-movement between
 *    positions, so no correlation matrix or normal distribution is assumed.
 *  - Each path draws `horizonSessions` days with replacement (seeded PRNG), compounds each position,
 *    and revalues the portfolio. Cash earns nothing. Positions are held unchanged (no rebalancing).
 *  - VaR at confidence c = the loss exceeded in (1-c) of paths; expected shortfall = average loss in
 *    those worst paths. Both are thresholds of THIS simulation, not maximum losses.
 * Limits stated to the user: history may not repeat; independent day draws ignore volatility
 * clustering and fat multi-day runs; IEX single-exchange closes; gross of costs.
 *
 * Insufficient history → that part is "unavailable"; nothing is filled in.
 */
export const RISK_VERSION = 'practice-risk-v1';
export const RISK_DEFAULTS = { horizonSessions: 20, paths: 10000, confidence: 0.95, lookbackSessions: 252, minSessions: 120, seed: 20261112, concentrationFlag: 0.25 };
export type RiskConfig = typeof RISK_DEFAULTS;

export type Holding = { symbol: string; valueCents: number | null };
export type Closes = Record<string, Map<string, number>>; // symbol -> date -> close

/** mulberry32: small, fast, reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
const std = (x: number[]) => { const m = mean(x); return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1)); };

export function concentration(holdings: Holding[], cashCents: number, cfg: RiskConfig = RISK_DEFAULTS) {
  const priced = holdings.filter(h => typeof h.valueCents === 'number' && h.valueCents! > 0);
  const unpriced = holdings.filter(h => !(typeof h.valueCents === 'number' && h.valueCents! > 0)).map(h => h.symbol);
  const invested = priced.reduce((s, h) => s + h.valueCents!, 0), total = invested + Math.max(0, cashCents);
  if (unpriced.length) return { status: 'unavailable' as const, reason: `No live value for ${unpriced.join(', ')}; weights would be guessed.`, unpriced };
  if (!total) return { status: 'unavailable' as const, reason: 'The portfolio has no value.', unpriced };
  const weights = priced.map(h => ({ symbol: h.symbol, weight: h.valueCents! / total })).sort((a, b) => b.weight - a.weight);
  const hhi = weights.reduce((s, w) => s + w.weight ** 2, 0);
  return {
    status: 'ok' as const, totalCents: total, investedCents: invested, cashWeight: Math.max(0, cashCents) / total, weights,
    largest: weights[0] ?? null, effectivePositions: hhi > 0 ? 1 / hhi : null,
    flags: weights.filter(w => w.weight > cfg.concentrationFlag).map(w => `${w.symbol} is ${(w.weight * 100).toFixed(1)}% of the portfolio (above ${cfg.concentrationFlag * 100}%).`),
    unpriced,
  };
}

/** Joint daily returns on dates every symbol has a close; the last `lookback` of them. */
export function jointReturns(symbols: string[], closes: Closes, lookback: number) {
  const dates = [...(closes[symbols[0]]?.keys() ?? [])].filter(d => symbols.every(s => closes[s]?.has(d))).sort();
  const rows: { date: string; r: number[] }[] = [];
  for (let i = 1; i < dates.length; i++) {
    const r = symbols.map(s => closes[s].get(dates[i])! / closes[s].get(dates[i - 1])! - 1);
    if (r.every(Number.isFinite)) rows.push({ date: dates[i], r });
  }
  return rows.slice(-lookback);
}

export function coverage(symbols: string[], closes: Closes, cfg: RiskConfig = RISK_DEFAULTS) {
  const per = symbols.map(s => ({ symbol: s, closes: closes[s]?.size ?? 0, first: [...(closes[s]?.keys() ?? [])].sort()[0] ?? null, last: [...(closes[s]?.keys() ?? [])].sort().at(-1) ?? null }));
  const joint = symbols.length ? jointReturns(symbols, closes, cfg.lookbackSessions) : [];
  const short = per.filter(p => p.closes - 1 < cfg.minSessions).map(p => p.symbol);
  return { per, jointSessions: joint.length, from: joint[0]?.date ?? null, to: joint.at(-1)?.date ?? null, enough: symbols.length > 0 && joint.length >= cfg.minSessions && !short.length, short };
}

export function simulate(weightsBySymbol: { symbol: string; valueCents: number }[], cashCents: number, closes: Closes, cfg: RiskConfig = RISK_DEFAULTS) {
  const symbols = weightsBySymbol.map(w => w.symbol);
  const rows = jointReturns(symbols, closes, cfg.lookbackSessions);
  if (rows.length < cfg.minSessions) return { status: 'unavailable' as const, reason: `Only ${rows.length} shared trading days of history; at least ${cfg.minSessions} are needed.` };
  const values = weightsBySymbol.map(w => w.valueCents / 100), start = values.reduce((s, v) => s + v, 0) + cashCents / 100;
  const next = rng(cfg.seed), pnl = new Float64Array(cfg.paths);
  for (let p = 0; p < cfg.paths; p++) {
    const growth = values.map(() => 1);
    for (let d = 0; d < cfg.horizonSessions; d++) { const r = rows[Math.floor(next() * rows.length)].r; for (let k = 0; k < r.length; k++) growth[k] *= 1 + r[k]; }
    pnl[p] = values.reduce((s, v, k) => s + v * growth[k], 0) + cashCents / 100 - start;
  }
  const sorted = Array.from(pnl).sort((a, b) => a - b), tail = 1 - cfg.confidence;
  const cut = Math.max(1, Math.floor(cfg.paths * tail)), worst = sorted.slice(0, cut);
  const varUsd = -quantile(sorted, tail), esUsd = -mean(worst);
  // Per-asset and portfolio volatility, and correlations, from the same history (descriptive).
  const cols = symbols.map((_, k) => rows.map(x => x.r[k]));
  const port = rows.map(x => x.r.reduce((s, r, k) => s + r * values[k], 0) / start);
  const corr = cols.map(a => cols.map(b => { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return da && db ? n / Math.sqrt(da * db) : NaN; }));
  return {
    status: 'ok' as const, startUsd: start, paths: cfg.paths, horizonSessions: cfg.horizonSessions, seed: cfg.seed, confidence: cfg.confidence,
    history: { sessions: rows.length, from: rows[0].date, to: rows.at(-1)!.date },
    percentilesUsd: Object.fromEntries([0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99].map(q => [String(q), quantile(sorted, q)])),
    varUsd, esUsd, varPct: varUsd / start * 100, esPct: esUsd / start * 100,
    annualisedVolPct: Object.fromEntries(symbols.map((s, k) => [s, std(cols[k]) * Math.sqrt(252) * 100])),
    portfolioAnnualisedVolPct: std(port) * Math.sqrt(252) * 100,
    correlation: { symbols, matrix: corr },
  };
}

/** Illustrative stresses: not forecasts, not worst cases. */
export function stresses(weightsBySymbol: { symbol: string; valueCents: number }[], cashCents: number, closes: Closes, cfg: RiskConfig = RISK_DEFAULTS) {
  const values = weightsBySymbol.map(w => w.valueCents / 100), total = values.reduce((s, v) => s + v, 0) + cashCents / 100;
  const out: { name: string; lossUsd: number | null; lossPct: number | null; note: string }[] = [];
  const uniform = (pct: number) => ({ name: `Every position falls ${pct}% at once`, lossUsd: values.reduce((s, v) => s + v, 0) * pct / 100, lossPct: values.reduce((s, v) => s + v, 0) * pct / 100 / total * 100, note: 'A fixed hypothetical shock; cash is unchanged.' });
  out.push(uniform(10), uniform(20));
  const rows = jointReturns(weightsBySymbol.map(w => w.symbol), closes, cfg.lookbackSessions);
  if (rows.length > cfg.horizonSessions) {
    let worst = Infinity, at = '';
    for (let i = 0; i + cfg.horizonSessions <= rows.length; i++) {
      const g = values.map(() => 1);
      for (let d = i; d < i + cfg.horizonSessions; d++) rows[d].r.forEach((r, k) => (g[k] *= 1 + r));
      const change = values.reduce((s, v, k) => s + v * (g[k] - 1), 0);
      if (change < worst) { worst = change; at = `${rows[i].date} to ${rows[i + cfg.horizonSessions - 1].date}`; }
    }
    out.push({ name: `Worst ${cfg.horizonSessions}-session stretch in the history used`, lossUsd: Math.max(0, -worst), lossPct: Math.max(0, -worst) / total * 100, note: `Actual joint moves ${at}, replayed on today's positions.` });
  } else out.push({ name: `Worst ${cfg.horizonSessions}-session stretch in the history used`, lossUsd: null, lossPct: null, note: 'Unavailable: not enough shared history.' });
  return out;
}

export function riskReport(holdings: Holding[], cashCents: number, closes: Closes, cfg: RiskConfig = RISK_DEFAULTS) {
  const conc = concentration(holdings, cashCents, cfg);
  const symbols = holdings.map(h => h.symbol);
  const cov = coverage(symbols, closes, cfg);
  const priced = holdings.filter(h => typeof h.valueCents === 'number' && h.valueCents! > 0) as { symbol: string; valueCents: number }[];
  const ready = holdings.length > 0 && conc.status === 'ok' && cov.enough;
  return {
    version: RISK_VERSION, config: cfg, concentration: conc, coverage: cov,
    simulation: !holdings.length ? { status: 'unavailable' as const, reason: 'No open Practice positions.' }
      : conc.status !== 'ok' ? { status: 'unavailable' as const, reason: conc.reason }
      : !cov.enough ? { status: 'unavailable' as const, reason: cov.short.length ? `Not enough price history for ${cov.short.join(', ')} (at least ${cfg.minSessions} sessions needed).` : `Only ${cov.jointSessions} shared trading days; at least ${cfg.minSessions} needed.` }
      : simulate(priced, cashCents, closes, cfg),
    stresses: ready ? stresses(priced, cashCents, closes, cfg) : [],
    assumptions: [
      `Horizon: ${cfg.horizonSessions} trading sessions. Paths: ${cfg.paths}. Seed: ${cfg.seed} (same inputs give the same result).`,
      `Inputs: daily closes (Alpaca IEX, adjusted "all") over the last ${cfg.lookbackSessions} shared trading days; whole days are resampled, so the historical co-movement between positions is kept and no normal distribution is assumed.`,
      'Positions are held unchanged for the horizon; cash earns nothing; returns are gross of fees, spreads, slippage and taxes.',
      'Days are drawn independently, so calm and stressed periods are mixed; real losses can cluster and be larger.',
      `VaR ${cfg.confidence * 100}%: the loss exceeded in ${Math.round((1 - cfg.confidence) * 100)}% of simulated paths. Expected shortfall: the average loss in those paths. Neither is a maximum loss.`,
      'A conditional scenario on past data, not a forecast, not advice and not evidence of an edge.',
    ],
  };
}
