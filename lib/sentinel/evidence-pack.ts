/**
 * Evidence pack (evidence-pack-v1): a deterministic, versioned bundle of what
 * Sentinel knew about one discovery case, for the research team to read.
 *
 * Pure. The caller passes the stored case plus SEC figures loaded with BOTH
 * clocks cut at the case's assessment time: a fact counts only if it was
 * publicly filed (`known_from`, the filing date) AND recorded by Sentinel
 * (`recorded_at`) by then. Later ingests and later restatements are excluded
 * (AGENTS.md invariant 2).
 *
 * Every item has an immutable id derived from its content, a source (URL or
 * explicit null), source time and capture time where known, period, unit,
 * currency, confidence and staleness. Missing data is listed, never filled.
 *
 * `shareable` marks items whose source is public and may be sent to a model:
 * the public headline and provider summary, the SEC company name and ticker,
 * and SEC filing facts. Quotes (licensed market data), Sentinel's own screen
 * and score, and anything private are never shareable.
 */
import type { Figure } from './financial';

export const EVIDENCE_PACK_VERSION = 'evidence-pack-v1';
const DAY = 86400000;
const STALE_DAYS = 550;

export type PackItem = {
  id: string;
  kind: 'headline' | 'provider_summary' | 'identity' | 'annual_fact' | 'quarterly_fact' | 'quote' | 'valuation' | 'screen' | 'score';
  label: string;
  text: string | null;          // verbatim text for text sources; display string for numbers
  value: number | null;
  display: string | null;       // the only way a number may be written by the model
  unit: string | null;
  currency: string | null;
  period: { start: string | null; end: string } | null;
  form: string | null;
  source: { name: string; url: string | null; accession: string | null; rawEventId: string | null };
  sourceTime: string | null;    // publication / filing date / quote time
  capturedAt: string | null;    // when Sentinel recorded it
  confidence: string;
  stale: boolean | null;
  shareable: boolean;
  note: string | null;
};

export type EvidencePack = {
  version: typeof EVIDENCE_PACK_VERSION;
  caseId: string; symbol: string; company: string | null;
  asOf: string; clocks: { publicFiledBy: string; recordedBy: string };
  items: PackItem[];
  missing: string[];
  cautions: string[];
};

const usd = (v: number) => {
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}bn` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}m` : `${s}$${Math.round(a).toLocaleString('en-US')}`;
};
export function display(value: number, unit: string): string {
  if (unit === 'USD') return usd(value);
  if (unit === 'USD/shares') return `$${value.toFixed(2)} per share`;
  if (unit === 'shares') return `${(value / 1e6).toFixed(1)}m shares`;
  if (unit === 'ratio') return value.toFixed(2);
  if (unit === 'percent') return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  return String(value);
}
const currencyOf = (unit: string) => (unit.startsWith('USD') ? 'USD' : null);
const sec = (accession: string | null, cik: string | null) =>
  accession && cik ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${accession}-index.html` : null;
const isStale = (periodEnd: string, asOf: string) => Date.parse(asOf) - Date.parse(periodEnd + 'T23:59:59.999Z') > STALE_DAYS * DAY;

const ANNUAL: [string, string][] = [
  ['revenue', 'Revenue'], ['net_income', 'Net income'], ['operating_income', 'Operating income'], ['cfo', 'Operating cash flow'],
  ['capex', 'Capital expenditure'], ['cash', 'Cash and equivalents'], ['total_debt', 'Total debt'], ['equity', 'Shareholders’ equity'],
  ['eps_diluted', 'Diluted EPS'], ['shares_diluted', 'Diluted shares'], ['share_count_yoy', 'Diluted share count change'],
];
const QUARTERLY: [string, string][] = [['revenue', 'Quarterly revenue'], ['net_income', 'Quarterly net income'], ['cfo', 'Quarterly operating cash flow']];

function factItem(f: Figure, kind: 'annual_fact' | 'quarterly_fact', label: string, cik: string | null, asOf: string): PackItem | null {
  if (f.value === null || !Number.isFinite(f.value) || f.confidence === 'unavailable') return null;
  const i = f.inputs[0];
  const single = f.inputs.length === 1 && f.confidence === 'reported';
  const unit = f.metric === 'share_count_yoy' ? 'percent' : f.unit;
  const value = f.metric === 'share_count_yoy' ? f.value * 100 : f.value;
  const d = display(value, unit);
  return {
    id: `${kind === 'annual_fact' ? 'A' : 'Q'}:${f.metric}:${f.period_end}:${i?.accession ?? 'computed'}`,
    kind, label: `${label} (${kind === 'annual_fact' ? 'year' : 'quarter'} to ${f.period_end})`, text: d, value, display: d, unit, currency: currencyOf(f.unit),
    period: { start: single ? i.period_start || null : null, end: f.period_end }, form: single ? i.form : null,
    source: { name: single ? `SEC ${i.form} (${i.source_tag})` : `Computed from SEC filings (${f.method})`, url: single ? sec(i.accession, cik) : null, accession: single ? i.accession : null, rawEventId: single ? i.raw_event_id : null },
    sourceTime: single ? i.filed : f.known_from, capturedAt: single ? i.recorded_at : null,
    confidence: f.confidence, stale: isStale(f.period_end, asOf), shareable: true,
    note: f.confidence === 'estimated' ? f.reason : null,
  };
}

/** Latest period with a value, plus the period about a year before it (same metric), when present. */
function latestAndPrior(figs: Figure[], metric: string) {
  const rows = figs.filter(f => f.metric === metric && f.value !== null && f.confidence !== 'unavailable').sort((a, b) => b.period_end.localeCompare(a.period_end));
  const latest = rows[0];
  if (!latest) return [];
  const prior = rows.find(f => { const g = (Date.parse(latest.period_end) - Date.parse(f.period_end)) / DAY; return g >= 330 && g <= 400; });
  return prior ? [latest, prior] : [latest];
}

export function buildEvidencePack(input: {
  caseId: string; kase: any; figures: Figure[]; quarterlyFigures: Figure[]; asOf: string; recordedBy: string;
}): EvidencePack {
  const { kase, asOf } = input, items: PackItem[] = [], missing: string[] = [], cautions: string[] = [];
  const cik: string | null = kase?.identity?.cik ?? null;
  const ev = kase?.event ?? {};

  if (ev.headline) items.push({ id: 'N:headline', kind: 'headline', label: 'Headline', text: String(ev.headline), value: null, display: null, unit: null, currency: null, period: null, form: null,
    source: { name: ev.source ? `${ev.source} via Alpaca news` : 'Alpaca news', url: ev.url ?? null, accession: null, rawEventId: ev.rawEventId ?? null },
    sourceTime: ev.publishedAt ?? null, capturedAt: ev.firstObservedAt ?? null, confidence: 'reported claim, unverified', stale: null, shareable: true, note: 'Only the headline was read; the full article was not.' });
  else missing.push('Headline text');
  if (ev.providerSummary) items.push({ id: 'N:summary', kind: 'provider_summary', label: 'Provider summary', text: String(ev.providerSummary), value: null, display: null, unit: null, currency: null, period: null, form: null,
    source: { name: 'News provider summary', url: ev.url ?? null, accession: null, rawEventId: ev.rawEventId ?? null },
    sourceTime: ev.publishedAt ?? null, capturedAt: ev.firstObservedAt ?? null, confidence: 'reported claim, unverified', stale: null, shareable: true, note: null });
  else missing.push('Provider summary (none supplied); the full article was not read');

  const id = kase?.identity;
  if (id?.name) items.push({ id: 'I:identity', kind: 'identity', label: 'Company identity', text: `${id.name} (${kase.symbol}), SEC CIK ${id.cik}`, value: null, display: null, unit: null, currency: null, period: null, form: null,
    source: { name: id.source ?? 'SEC company ticker list', url: cik ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}` : null, accession: null, rawEventId: null },
    sourceTime: null, capturedAt: kase.createdAt ?? null, confidence: 'ticker match', stale: null, shareable: true,
    note: `Ticker match does not prove the news concerns this company. Headline role: ${id.relevance?.level ?? 'unknown'} — ${id.relevance?.reason ?? 'not assessed'}` });
  else missing.push('Verified company identity');
  if (id?.relevance?.level !== 'direct_candidate') cautions.push('The headline does not clearly name this company; it may be about someone else.');

  for (const [metric, label] of ANNUAL) {
    const got = latestAndPrior(input.figures, metric).map(f => factItem(f, 'annual_fact', label, cik, asOf)).filter(Boolean) as PackItem[];
    if (!got.length) missing.push(`${label} (annual)`); else items.push(...got);
  }
  for (const [metric, label] of QUARTERLY) {
    const got = latestAndPrior(input.quarterlyFigures, metric).map(f => factItem(f, 'quarterly_fact', label, cik, asOf)).filter(Boolean) as PackItem[];
    if (!got.length) missing.push(`${label}`); else items.push(...got);
  }
  if (items.some(i => (i.kind === 'annual_fact' || i.kind === 'quarterly_fact') && i.stale)) cautions.push('Some SEC figures are more than 18 months old at assessment time.');

  const q = kase?.brief?.quote;
  if (q && Number.isFinite(q.bid) && Number.isFinite(q.ask)) {
    const mid = (q.bid + q.ask) / 2, spread = (q.ask - q.bid) / mid * 100;
    items.push({ id: `P:quote:${q.rawEventId ?? q.sourceTime}`, kind: 'quote', label: 'IEX quote', text: `bid $${q.bid.toFixed(2)} / ask $${q.ask.toFixed(2)}, spread ${spread.toFixed(2)}%`, value: mid, display: `$${mid.toFixed(2)}`, unit: 'USD/shares', currency: 'USD', period: null, form: null,
      source: { name: 'Alpaca IEX quote (single exchange)', url: null, accession: null, rawEventId: q.rawEventId ?? null },
      sourceTime: q.sourceTime ?? null, capturedAt: q.capturedAt ?? null, confidence: 'single-exchange midpoint, not an executable price', stale: !!q.stale, shareable: false,
      note: 'Licensed market data: shown to you, not sent to any model. A quote is not a guaranteed fill.' });
  } else missing.push('A recorded stock quote');

  const p = kase?.price;
  if (p?.status === 'indicative' && Number.isFinite(p.ratio)) items.push({ id: `V:pe:${p.quoteRawId ?? ''}:${p.accession ?? ''}`, kind: 'valuation', label: 'Indicative P/E (observed price ÷ reported EPS)', text: p.ratio.toFixed(1), value: p.ratio, display: p.ratio.toFixed(1), unit: 'ratio', currency: null, period: { start: p.periodStart ?? null, end: p.periodEnd }, form: '10-K',
    source: { name: `Sentinel: ${p.priceLabel ?? 'IEX midpoint'} ÷ SEC annual diluted EPS`, url: sec(p.accession ?? null, cik), accession: p.accession ?? null, rawEventId: p.epsRawId ?? null },
    sourceTime: p.quoteTime ?? null, capturedAt: kase.createdAt ?? null, confidence: 'indicative', stale: null, shareable: false,
    note: 'An observed price ratio, not a valuation. A low P/E alone shows neither intrinsic value nor a margin of safety. Share basis and later splits are unverified.' });
  else missing.push(`Indicative P/E: ${p?.reason ?? 'not available'}`);
  missing.push('An intrinsic value estimate (none is computed; it would need explicit, sourced assumptions)');

  if (kase?.decision?.version) items.push({ id: `S:screen:${kase.decision.version}`, kind: 'screen', label: `Screen result (${kase.decision.version})`, text: `${kase.conclusion}: ${kase.reason ?? ''}`, value: null, display: null, unit: null, currency: null, period: null, form: null,
    source: { name: 'Sentinel deterministic screen', url: null, accession: null, rawEventId: null }, sourceTime: kase.createdAt ?? null, capturedAt: kase.createdAt ?? null, confidence: 'rule output', stale: null, shareable: false, note: 'Shown unchanged; the research team cannot alter it.' });
  if (kase?.evidenceScore?.version) items.push({ id: `S:score:${kase.evidenceScore.version}`, kind: 'score', label: `Evidence score (${kase.evidenceScore.version})`, text: kase.evidenceScore.score === null ? 'Not enough data to score' : `${kase.evidenceScore.score}/100`, value: kase.evidenceScore.score, display: null, unit: null, currency: null, period: null, form: null,
    source: { name: 'Sentinel evidence checklist', url: null, accession: null, rawEventId: null }, sourceTime: kase.createdAt ?? null, capturedAt: kase.createdAt ?? null, confidence: 'unvalidated checklist', stale: null, shareable: false, note: 'Not a probability or expected return.' });

  return { version: EVIDENCE_PACK_VERSION, caseId: input.caseId, symbol: String(kase?.symbol ?? ''), company: id?.name ?? null, asOf, clocks: { publicFiledBy: asOf, recordedBy: input.recordedBy }, items, missing, cautions };
}

/** The only data a model may see: shareable items, each reduced to an allow-list of fields. */
export function modelPayload(pack: EvidencePack) {
  return {
    company: pack.company, ticker: pack.symbol, asOf: pack.asOf,
    sources: pack.items.filter(i => i.shareable).map(i => ({ id: i.id, kind: i.kind, label: i.label, text: i.text, form: i.form, period_end: i.period?.end ?? null, stale: i.stale })),
    missing: pack.missing,
  };
}
