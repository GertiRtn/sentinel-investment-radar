/**
 * Selected vs assessed-not-selected vs SPY (selection-comparison-v1, 2026-11-25). Pure: stored cases and stored
 * outcome records in, a comparison out. Nothing is fetched, written or changed. Research measurement only: not a
 * forecast, not a ranking of companies, never shown as an idea, never used by the screen, score, list or experiments.
 *
 * Question: over one horizon, were cases that met the idea rules (idea-select-v2, from stored fields) followed by a
 * different return against SPY than the cases Sentinel assessed and did not select, after the same simulated costs?
 * Below MIN_PER_GROUP usable outcomes in either group, only counts are returned: no averages, no intervals, no claims.
 */
import { OUTCOME_HORIZONS, horizonWaitDays } from './outcome-observation';
import { meetsIdeaRules, IDEA_SELECT_VERSION } from './idea-select';
import { COST_BASIS, STATS_VERSION, afterCosts, excessAfterCosts, validReturn, validDay, mean, median, overlapBlockLength, blockBootstrap, blockBootstrapMean } from './research-stats';

export const SELECTION_COMPARISON_VERSION = 'selection-comparison-v1';
export const MIN_PER_GROUP = 20;
const SCREEN_V2 = 'research-screen-v2';

export type CompareCase = {
  id: string; symbol: string; createdAt: string; status: string; conclusion: string; screenVersion: string | null; matchLevel: string;
  direction: string; label: { version: string; source: 'stored' | 'computed'; storedVersion: string | null };
};
export type OutcomeRow = {
  caseId: string; symbol: string; horizonIntervals?: number | null; entryDate: unknown; exitDate: unknown;
  stockReturn: unknown; benchmarkReturn: unknown; matchedDates: unknown; benchmark?: string | null;
};
type Group = 'selected' | 'not_selected';
type Used = { c: CompareCase; group: Group; entryDate: string; exitDate: string; stock: number; spy: number };

/** Why an outcome record cannot be used, or null if it can. The entry must come after the case date (no later information in an earlier decision). */
export function outcomeProblem(c: CompareCase, o: OutcomeRow, horizon: number, today: string): string | null {
  if (o.symbol !== c.symbol) return 'outcome symbol differs from the case';
  if (!validDay(o.entryDate)) return 'entry date missing or invalid';
  if (o.entryDate <= c.createdAt.slice(0, 10)) return 'entry is on or before the case date (would use information from before the decision)';
  if (!validDay(o.exitDate) || o.exitDate <= o.entryDate) return 'exit date missing or not after entry';
  if (o.exitDate >= today) return 'exit date is not a completed session';
  if (!validReturn(o.stockReturn)) return 'stock return missing, not finite, or -100% or worse';
  if (!validReturn(o.benchmarkReturn)) return 'SPY return missing, not finite, or -100% or worse';
  if (o.benchmark != null && o.benchmark !== 'SPY') return 'benchmark is not SPY';
  const d = o.matchedDates;
  if (!Array.isArray(d) || d.length !== horizon + 1 || d[0] !== o.entryDate || d[d.length - 1] !== o.exitDate || d.some((x, i) => !validDay(x) || (i > 0 && x <= d[i - 1])))
    return `matched stock and SPY dates do not cover exactly ${horizon} trading-day intervals from entry to exit`;
  return null;
}

const tally = (xs: string[]) => { const m: Record<string, number> = {}; for (const x of xs) m[x] = (m[x] ?? 0) + 1; return m; };

function figures(rows: Used[]) {
  const ex = rows.map(r => excessAfterCosts(r.stock, r.spy)), byDate = new Map<string, number[]>();
  rows.forEach((r, i) => byDate.set(r.entryDate, [...(byDate.get(r.entryDate) ?? []), ex[i]]));
  const blockLength = overlapBlockLength(rows.map(r => ({ date: r.entryDate, exitDate: r.exitDate })));
  return {
    n: rows.length,
    averageStockGross: mean(rows.map(r => r.stock)), averageSpyGross: mean(rows.map(r => r.spy)),
    averageExcessGross: mean(rows.map(r => r.stock - r.spy)),
    averageStockAfterCosts: mean(rows.map(r => afterCosts(r.stock))), averageSpyAfterCosts: mean(rows.map(r => afterCosts(r.spy))),
    averageExcessAfterCosts: mean(ex), medianExcessAfterCosts: median(ex), shareAboveSpyAfterCosts: ex.filter(x => x > 0).length / ex.length,
    interval90: blockBootstrapMean([...byDate.entries()].map(([date, values]) => ({ date, values })), { blockLength }),
  };
}

/** Difference in average excess after costs (selected minus not selected), with a block bootstrap over shared entry dates. */
function difference(sel: Used[], not: Used[], blockLength: number) {
  const byDate = new Map<string, { s: number[]; n: number[] }>();
  for (const [rows, k] of [[sel, 's'], [not, 'n']] as const) for (const r of rows) { const g = byDate.get(r.entryDate) ?? { s: [], n: [] }; g[k].push(excessAfterCosts(r.stock, r.spy)); byDate.set(r.entryDate, g); }
  const stat = (sample: { s: number[]; n: number[] }[]) => { const s = sample.flatMap(g => g.s), n = sample.flatMap(g => g.n); return s.length && n.length ? mean(s) - mean(n) : NaN; };
  const all = [...byDate.values()], iv = blockBootstrap([...byDate.entries()].map(([date, value]) => ({ date, value })), stat, { blockLength });
  return { averageExcessAfterCosts: stat(all), interval90: { lower: iv.lower, upper: iv.upper, blockLength: iv.blockLength } };
}

export function selectionComparison(input: { cases: CompareCase[]; outcomes: OutcomeRow[]; horizon: number; now: string; truncated?: boolean }) {
  const { horizon, now } = input;
  if (!(OUTCOME_HORIZONS as readonly number[]).includes(horizon)) throw new Error('horizon must be 5, 20, 60 or 120 trading-day intervals.');
  const today = now.slice(0, 10), dueBefore = Date.parse(now) - horizonWaitDays(horizon) * 86400000;

  const all = input.cases;
  const olderScreen = all.filter(c => c.screenVersion !== SCREEN_V2);
  const v2 = all.filter(c => c.screenVersion === SCREEN_V2);
  const unmatched = v2.filter(c => c.status !== 'complete');
  const wrongCompany = v2.filter(c => c.status === 'complete' && c.matchLevel === 'name_conflict');
  const included = v2.filter(c => c.status === 'complete' && c.matchLevel !== 'name_conflict');
  const labelVersions = tally(included.map(c => c.label.version));

  const ids = new Set(included.map(c => c.id)), byCase = new Map<string, OutcomeRow[]>();
  let otherHorizon = 0, notInUniverse = 0;
  for (const o of input.outcomes) {
    if ((o.horizonIntervals ?? 5) !== horizon) { otherHorizon++; continue; }
    if (!ids.has(o.caseId)) { notInUniverse++; continue; }
    byCase.set(o.caseId, [...(byCase.get(o.caseId) ?? []), o]);
  }

  type Row = { caseId: string; symbol: string; createdAt: string; group: Group; conclusion: string; direction: string; labelVersion: string; labelSource: string; storedLabelVersion: string | null;
    outcome: 'used' | 'not_yet_due' | 'due_no_record' | 'rejected' | 'overlap_left_out'; reason: string | null; entryDate: string | null; exitDate: string | null };
  const rows: Row[] = [], valid: Used[] = [];
  for (const c of included) {
    const group: Group = meetsIdeaRules(c as any) ? 'selected' : 'not_selected', os = byCase.get(c.id) ?? [];
    const base = { caseId: c.id, symbol: c.symbol, createdAt: c.createdAt, group, conclusion: c.conclusion, direction: c.direction, labelVersion: c.label.version, labelSource: c.label.source, storedLabelVersion: c.label.storedVersion, entryDate: null, exitDate: null };
    if (!os.length) { rows.push({ ...base, outcome: Date.parse(c.createdAt) > dueBefore ? 'not_yet_due' : 'due_no_record', reason: null }); continue; }
    if (os.length > 1) { rows.push({ ...base, outcome: 'rejected', reason: 'more than one outcome record for this case and horizon' }); continue; }
    const o = os[0], problem = outcomeProblem(c, o, horizon, today);
    if (problem) { rows.push({ ...base, outcome: 'rejected', reason: problem }); continue; }
    valid.push({ c, group, entryDate: o.entryDate as string, exitDate: o.exitDate as string, stock: o.stockReturn as number, spy: o.benchmarkReturn as number });
    rows.push({ ...base, outcome: 'used', reason: null, entryDate: o.entryDate as string, exitDate: o.exitDate as string });
  }

  const rowById = new Map(rows.map(r => [r.caseId, r]));
  // Same company, same group: a later case whose window starts before the earlier kept window ends is left out (counted), so one price move is not counted twice.
  const kept: Used[] = [], lastExit = new Map<string, string>();
  for (const u of [...valid].sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.c.createdAt.localeCompare(b.c.createdAt) || a.c.id.localeCompare(b.c.id))) {
    const key = u.group + '|' + u.c.symbol, prev = lastExit.get(key);
    if (prev && u.entryDate <= prev) { const r = rowById.get(u.c.id)!; r.outcome = 'overlap_left_out'; r.reason = `window starts on or before ${prev}, when the same company's earlier case in this group ends`; continue; }
    lastExit.set(key, u.exitDate); kept.push(u);
  }
  const sel = kept.filter(u => u.group === 'selected'), not = kept.filter(u => u.group === 'not_selected');
  const crossGroupOverlaps = sel.filter(s => not.some(n => n.c.symbol === s.c.symbol && n.entryDate <= s.exitDate && s.entryDate <= n.exitDate)).length;

  const counts = (g: Group) => {
    const rs = rows.filter(r => r.group === g), used = kept.filter(u => u.group === g);
    return {
      cases: rs.length, used: used.length,
      notYetDue: rs.filter(r => r.outcome === 'not_yet_due').length, dueNoRecord: rs.filter(r => r.outcome === 'due_no_record').length,
      rejected: tally(rs.filter(r => r.outcome === 'rejected').map(r => r.reason!)), overlapLeftOut: rs.filter(r => r.outcome === 'overlap_left_out').length,
      companies: new Set(used.map(u => u.c.symbol)).size, entryDates: new Set(used.map(u => u.entryDate)).size,
      firstEntry: used.map(u => u.entryDate).sort()[0] ?? null, lastExit: used.map(u => u.exitDate).sort().at(-1) ?? null,
      byConclusion: tally(rs.map(r => r.conclusion || 'none')), byNewsDirection: tally(rs.map(r => r.direction)),
      labelSource: tally(rs.map(r => r.labelSource)),
    };
  };
  const groups = { selected: counts('selected'), notSelected: counts('not_selected') };

  const mixed = Object.keys(labelVersions).length > 1;
  const short = [['Selected', sel.length], ['Assessed, not selected', not.length]].filter(([, n]) => (n as number) < MIN_PER_GROUP) as [string, number][];
  const status = mixed ? 'mixed_label_versions' : short.length ? 'counts_only' : 'computed';
  const missing = mixed ? [`Cases carry more than one news-direction version (${Object.entries(labelVersions).map(([v, n]) => `${v}: ${n}`).join(', ')}). Groups built with different label versions are not pooled.`]
    : short.map(([g, n]) => `${g}: ${n} usable outcome${n === 1 ? '' : 's'} at ${horizon} trading-day intervals; ${MIN_PER_GROUP} needed.`);
  if (input.truncated) missing.push('The case read hit its row limit, so later cases are not included.');

  let result: any = null;
  if (status === 'computed') {
    const s = figures(sel), n = figures(not);
    result = { selected: s, notSelected: n, difference: difference(sel, not, Math.max(s.interval90.blockLength, n.interval90.blockLength)) };
  }

  return {
    version: SELECTION_COMPARISON_VERSION, statsVersion: STATS_VERSION, ideaRule: IDEA_SELECT_VERSION, horizonIntervals: horizon, generatedAt: now, status,
    minimumPerGroup: MIN_PER_GROUP, labelVersions, missing,
    universe: { cases: all.length, olderScreen: olderScreen.length, tickerNotMatched: unmatched.length, probableWrongCompany: wrongCompany.length, compared: included.length, truncated: !!input.truncated },
    outcomes: { read: input.outcomes.length, otherHorizon, outsideCompared: notInUniverse },
    groups, crossGroupOverlaps, result,
    costBasis: COST_BASIS,
    assumptions: [
      'Universe: research-screen-v2 cases whose ticker matched one SEC company. First-screen cases are left out: that screen measured data completeness.',
      'Probable wrong-company reports are left out of both groups: their outcome measures a company other than the one in the news.',
      `Selected means meeting ${IDEA_SELECT_VERSION}'s rules from stored fields: "Meets research rules", the headline names the company, and the news wording is good. The list shows at most five companies a week; this uses every case that met the rules.`,
      'Not selected means every other compared case: Watch, Waiting for data, neutral, bad and mixed news.',
      `Entry is the first completed IEX daily close after the case's UTC date; exit is ${horizon} matched trading days later; SPY is measured on the same dates. Prices are split- and dividend-adjusted.`,
      'Within each group, a company\'s later case is left out while its earlier case\'s window is still open.',
      'One horizon per comparison; horizons are never pooled.',
      'Each case records the news-direction version and whether its label was stored or computed from its stored text.',
    ],
    canEstablish: status === 'computed'
      ? 'Whether, over these dates and this horizon, cases that met the idea rules were followed by a different average return against SPY than cases assessed and not selected, after the same simulated costs, with an interval that allows for overlapping windows.'
      : 'Only how many cases and outcomes exist and why the rest are missing. No return figure is given.',
    cannotEstablish: [
      'That the rules caused any difference: the groups also differ in data completeness, news wording and company type.',
      'Anything about other periods, other horizons, or later versions of the screen, the news labels or the idea rules.',
      'Returns anyone could have achieved: these are daily closes on one exchange (IEX) with simulated costs, not fills.',
      'A forecast for any company or any future case.',
      'What happened to cases with no outcome: a missing price is listed as missing, never counted as a gain or a loss.',
    ],
    cases: rows,
    note: 'Research measurement only. Not a forecast, not a ranking of companies, and not used by any list, score, screen or experiment.',
  };
}
