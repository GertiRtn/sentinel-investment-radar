// Company page (`company-page-v1`). Pure: assembles what Sentinel already stores about one company into one view.
// No new rule, score, label or forecast. Every number carries its period and source; missing data stays null
// with a reason. The assessment is the latest case's existing rule-based view, unchanged.

import { closesOf } from './market-model';
import { closeInstant } from './case-context';
import { caseEventMatch } from './event-match';
import { notChecked, STATE_LABEL } from './event-verify';

export const COMPANY_PAGE_VERSION = 'company-page-v1';
export const RANGES = { '1M': 21, '6M': 126, '1Y': 252 } as const;
type Fig = { metric: string; value: number | null; period_end: string; inputs?: any[] };

/** User-facing label for a stored screen result. The stored value is never changed. */
export function statusLabel(kase: any): string {
  if (kase?.decision?.version !== 'research-screen-v2') return 'Older screen: no judgment';
  return kase.conclusion === 'INVESTIGATE' ? 'Meets research rules' : kase.conclusion === 'MONITOR' ? 'Watch: a rule is not met' : 'Waiting for data';
}
const analystOnly = (k: any) => { const t: string[] = k?.event?.analysis?.topics ?? []; return t.length > 0 && t.every(x => x === 'Analyst opinion'); };

export function filingUrl(cik: string | null | undefined, accession: string | null | undefined) {
  if (!cik || !/^\d{1,10}$/.test(String(cik)) || !accession || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) return null;
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-', '')}/`;
}
const src = (f: Fig | undefined, cik: string | null) => {
  const i = f?.inputs?.[0];
  return i ? { form: i.form ?? null, filed: i.filed ?? null, accession: i.accession ?? null, url: filingUrl(cik, i.accession) } : null;
};

/** Price history from archived IEX daily bars. Null price, never a guess, when bars are missing. */
export function priceBlock(stock: any, spy: any, fetchedAt: string | null, events: { caseId: string; publishedAt: string; headline: string }[]) {
  if (!stock || !spy || !fetchedAt) return { status: 'unavailable' as const, reason: 'Daily prices could not be loaded.', series: [], ranges: {}, markers: [] };
  const s = closesOf(stock, fetchedAt), m = closesOf(spy, fetchedAt);
  const days = [...s.keys()].sort();
  if (!days.length) return { status: 'unavailable' as const, reason: 'No completed daily prices for this company.', series: [], ranges: {}, markers: [] };
  const spyDays = [...m.keys()].sort(), last = days.at(-1)!, spyLast = spyDays.at(-1) ?? null;
  const staleSessions = spyLast ? spyDays.filter(d => d > last).length : 0;
  const series = days.slice(-RANGES['1Y'] - 1).map(d => ({ date: d, close: s.get(d)!, spy: m.get(d) ?? null }));
  const matched = series.filter(p => p.spy !== null);
  const ranges: Record<string, any> = {};
  for (const [k, n] of Object.entries(RANGES)) {
    if (matched.length < 2) continue;
    const from = matched[Math.max(0, matched.length - 1 - n)], to = matched.at(-1)!;
    ranges[k] = { from: from.date, to: to.date, sessions: matched.indexOf(to) - matched.indexOf(from), stockPct: (to.close / from.close - 1) * 100, spyPct: (to.spy! / from.spy! - 1) * 100, partial: matched.length - 1 < n };
  }
  // An event is marked at the first completed close after its publication.
  const markers = events.map(e => { const d = series.find(p => closeInstant(p.date) >= e.publishedAt); return d ? { date: d.date, caseId: e.caseId, headline: e.headline } : null; }).filter(Boolean);
  return { status: 'ok' as const, reason: null, last: { date: last, close: s.get(last)!, basis: 'Last completed IEX daily close', stale: staleSessions > 3, staleSessions },
    series, ranges, markers, source: 'Alpaca IEX daily bars, split- and dividend-adjusted', fetchedAt, note: 'IEX is a single exchange; its close can differ from the consolidated close.' };
}

const annualOf = (figs: Fig[], metric: string) => figs.filter(f => f.metric === metric && typeof f.value === 'number').sort((a, b) => a.period_end.localeCompare(b.period_end));
const yearApart = (a: string, b: string) => { const d = (Date.parse(b) - Date.parse(a)) / 86400000; return d >= 330 && d <= 400; };

/** Key figures from reported annual SEC facts. A change is shown only against the year before and a positive base. */
export function keyFigures(kase: any, figures: Fig[], cik: string | null) {
  const row = (metric: string, label: string, help: string) => {
    const xs = annualOf(figures, metric), cur = xs.at(-1), prev = xs.at(-2);
    if (!cur) return { metric, label, help, value: null, unit: 'USD', periodEnd: null, changePct: null, changeNote: null, source: null, reason: 'Not reported in the SEC figures Sentinel has.' };
    const comparable = prev && yearApart(prev.period_end, cur.period_end) && (prev.value as number) > 0;
    return { metric, label, help, value: cur.value, unit: 'USD', periodEnd: cur.period_end, changePct: comparable ? ((cur.value as number) / (prev!.value as number) - 1) * 100 : null,
      changeNote: comparable ? `vs year to ${prev!.period_end}` : prev ? 'No like-for-like change (different period length or a non-positive base).' : 'No earlier year to compare.', source: src(cur, cik), reason: null };
  };
  const cfo = annualOf(figures, 'cfo'), capex = annualOf(figures, 'capex'), c = cfo.at(-1), k = c ? capex.find(x => x.period_end === c.period_end) : undefined;
  const fcf = c && k ? { metric: 'fcf', label: 'Free cash flow', help: 'Operating cash flow minus capital spending, both as reported for the same year. Calculated by Sentinel from reported figures.',
    value: (c.value as number) - (k.value as number), unit: 'USD', periodEnd: c.period_end, changePct: null, changeNote: 'Calculated from reported figures', source: src(c, cik), reason: null }
    : { metric: 'fcf', label: 'Free cash flow', help: 'Operating cash flow minus capital spending for the same year.', value: null, unit: 'USD', periodEnd: null, changePct: null, changeNote: null, source: null, reason: 'Operating cash flow and capital spending are not both reported for the same year.' };
  const p = kase?.price;
  const pe = p?.status === 'indicative' && Number.isFinite(p.ratio)
    ? { metric: 'pe', label: 'P/E', help: 'Share price divided by the latest annual diluted earnings per share. Indicative: one exchange’s price, reported annual EPS, share basis not verified.', value: p.ratio, unit: 'x', periodEnd: p.periodEnd ?? null, changePct: null,
        changeNote: `${p.basis === 'last_close' ? 'Last close' : 'IEX midpoint'}${p.priceLabel ? ` (${p.priceLabel})` : ''} when the latest case was assessed, ${String(kase.createdAt).slice(0, 10)}`, source: null, reason: null }
    : { metric: 'pe', label: 'P/E', help: 'Share price divided by the latest annual diluted earnings per share.', value: null, unit: 'x', periodEnd: null, changePct: null, changeNote: null, source: null, reason: p?.reason ?? (kase ? 'No P/E was computed for the latest case.' : 'No Sentinel case for this company yet.') };
  return [pe, row('revenue', 'Revenue', 'Total sales reported for the fiscal year.'), row('net_income', 'Net income', 'Profit or loss after all costs and taxes for the fiscal year.'), row('cfo', 'Operating cash flow', 'Cash generated by the business in the fiscal year, before capital spending.'), fcf];
}

/** Annual and quarterly revenue and net income. Missing values stay null; a gap between quarters is shown, not filled. */
export function financials(figures: Fig[], quarterly: Fig[], cik: string | null) {
  const series = (figs: Fig[], take: number, quarterlyMode: boolean) => {
    const ends = [...new Set(figs.filter(f => (f.metric === 'revenue' || f.metric === 'net_income') && typeof f.value === 'number').map(f => f.period_end))].sort().slice(-take);
    const out: any[] = [];
    ends.forEach((end, i) => {
      if (quarterlyMode && i > 0 && (Date.parse(end) - Date.parse(ends[i - 1])) / 86400000 > 120) out.push({ period: 'Not reported', periodEnd: null, gap: true, revenue: null, netIncome: null, margin: null });
      const v = (m: string) => { const f = figs.find(x => x.metric === m && x.period_end === end); return typeof f?.value === 'number' ? f.value : null; };
      const revenue = v('revenue'), netIncome = v('net_income');
      out.push({ period: quarterlyMode ? `Q to ${end.slice(0, 7)}` : `FY ${end.slice(0, 4)}`, periodEnd: end, gap: false, revenue, netIncome, margin: revenue && revenue > 0 && netIncome !== null ? (netIncome / revenue) * 100 : null });
    });
    return out;
  };
  const latest = [...figures, ...quarterly].flatMap(f => f.inputs ?? []).sort((a, b) => String(b.filed).localeCompare(String(a.filed)))[0];
  return { annual: series(figures, 5, false), quarterly: series(quarterly, 8, true), unit: 'USD',
    source: latest ? { form: latest.form, filed: latest.filed, accession: latest.accession, url: filingUrl(cik, latest.accession) } : null,
    note: 'Reported SEC figures. A fiscal fourth quarter is usually not reported on its own, so it appears as a gap.' };
}

export function buildCompanyPage(input: {
  symbol: string; entity: { name: string | null; cik: string | null; sic: string | null } | null; followed: boolean;
  cases: any[]; latestIdea: { view: any; score: any; summary: any; match: any } | null; verifications: Record<string, any>;
  figures: Fig[]; quarterly: Fig[]; figuresAsOf: string | null; bars: { stock: any; spy: any; fetchedAt: string | null; error?: string | null };
  positions: { manualCents: number | null; inExperiment: boolean | null };
}) {
  const cases = [...input.cases].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const latest = cases[0] ?? null, cik = input.entity?.cik ?? latest?.identity?.cik ?? null;
  const v = (id: string) => input.verifications[id] ?? notChecked();
  const events = cases.map(k => {
    const match = caseEventMatch(k), ver = v(k.id);
    return { caseId: k.id, publishedAt: k.event?.publishedAt ?? null, assessedAt: k.createdAt, headline: k.event?.headline ?? null, source: k.event?.source ?? null, url: k.event?.url ?? null,
      status: statusLabel(k), analystOpinion: analystOnly(k), match: { level: match.level, label: match.label }, verification: { state: ver.state, label: ver.label ?? STATE_LABEL[ver.state as keyof typeof STATE_LABEL] } };
  });
  const price = input.bars.error ? { status: 'unavailable' as const, reason: input.bars.error, series: [], ranges: {}, markers: [] }
    : priceBlock(input.bars.stock, input.bars.spy, input.bars.fetchedAt, events.filter(e => e.publishedAt && e.headline).map(e => ({ caseId: e.caseId, publishedAt: e.publishedAt!, headline: e.headline! })));
  const i = input.latestIdea;
  const assessment = latest && i ? {
    caseId: latest.id, status: statusLabel(latest), view: { tone: i.view.tone, label: i.view.label, text: i.view.text },
    score: { score: i.score?.score ?? null, band: i.score?.band ?? null, coverage: i.score?.coverage ?? 0, meaning: 'Counts sourced evidence on a published checklist. Not a chance of gain.' },
    reason: i.summary?.reason?.text ?? null, reasonNote: i.summary?.reasonNote ?? null,
    counter: i.summary?.counter ? { text: i.summary.counter.text, unknown: i.summary.counter.status === 'unknown' } : null,
    unknown: 'Expectations: unknown. Sentinel has no analyst estimates or guidance history.',
    match: events[0].match, verification: events[0].verification, analystOpinion: events[0].analystOpinion, publishedAt: events[0].publishedAt, assessedAt: latest.createdAt,
    earlierEvents: cases.length - 1, promoted: i.match?.level !== 'name_conflict',
  } : null;
  return {
    version: COMPANY_PAGE_VERSION, symbol: input.symbol,
    company: { name: input.entity?.name ?? latest?.identity?.name ?? null, cik, industryCode: input.entity?.sic ?? null, followed: input.followed },
    price, assessment, assessmentNote: assessment ? null : 'Sentinel has no research case for this company yet. Figures below come from SEC filings only.',
    directionalView: { available: false, text: 'Directional view: not available yet. It needs a validated rule and measured outcomes.' },
    keyFigures: keyFigures(latest, input.figures, cik), financials: financials(input.figures, input.quarterly, cik), figuresAsOf: input.figuresAsOf,
    events, positions: input.positions,
    footer: 'Research only · virtual money · not advice',
  };
}
