/**
 * Free cash flow (free-cash-flow-v2, 2026-11-26). Pure. The ONE place Sentinel calculates free cash flow: the company
 * page's Key figures, the "What the price assumes" base cash flow and its history, and the case cash-flow scenarios all
 * call it, so they cannot disagree.
 *
 * Free cash flow = reported annual operating cash flow − reported annual capital expenditure, both from the same filing
 * for the same period, in USD. Capital expenditure comes from the current capex list (capex-tags-v4), in priority
 * order: the first tag present in that filing for that period is used, tags are never added together, and a
 * lower-priority tag reported with a different value is named, not hidden. No capex → unknown, never zero.
 * v1 (2026-11-25) used capex-tags-v3 (property, plant and equipment only).
 */
import { CAPEX_TAGS, CAPEX_TAG_LIST, type Figure, type FinancialFact } from './financial';

export const FCF_VERSION = 'free-cash-flow-v2';
export const FCF_METHOD = 'Operating cash flow minus capital spending, both reported for the same year in the same filing. Capital spending is the first tag present in Sentinel\'s capex list, never a sum of tags. Calculated by Sentinel.';

export type OtherCapexTag = { tag: string; value: number };
export type FreeCashFlow =
  | { status: 'reported'; version: string; capexTagList: string; value: number; cfo: number; capex: number; unit: 'USD'; periodStart: string; periodEnd: string; filed: string; accession: string; rawEventId: string; cfoTag: string; capexTag: string; otherCapexTags: OtherCapexTag[]; capexNote: string | null; method: string }
  | { status: 'unknown'; version: string; capexTagList: string; code: 'cfo_missing' | 'capex_not_tagged' | 'not_matched' | 'capex_negative'; periodEnd: string | null; reason: string };

const one = (f: Figure | undefined) => !!f && f.confidence === 'reported' && f.value !== null && f.inputs.length === 1;
const usd = (v: number) => `$${v.toLocaleString('en-US')}`;

/** Free cash flow for the latest reported annual operating cash flow, or for `periodEnd` when given. */
export function freeCashFlow(figures: Figure[], opts: { periodEnd?: string } = {}): FreeCashFlow {
  const unknown = (code: Extract<FreeCashFlow, { status: 'unknown' }>['code'], periodEnd: string | null, reason: string): FreeCashFlow =>
    ({ status: 'unknown', version: FCF_VERSION, capexTagList: CAPEX_TAG_LIST, code, periodEnd, reason });
  const cfo = figures.filter(f => f.metric === 'cfo' && one(f) && (!opts.periodEnd || f.period_end === opts.periodEnd)).sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
  if (!cfo) return unknown('cfo_missing', opts.periodEnd ?? null, 'A reported annual operating cash flow is unavailable.');
  const a = cfo.inputs[0];
  // Every capex fact for this period: the one the figure chose plus any other tag reported for it. Only tags in the list count.
  const capexFigure = figures.find(f => f.metric === 'capex' && f.period_end === cfo.period_end && one(f));
  const all: FinancialFact[] = capexFigure ? [capexFigure.inputs[0], ...(capexFigure.alsoReported ?? [])] : [];
  const listed = all.filter(f => CAPEX_TAGS.includes(f.source_tag));
  if (!listed.length) return unknown('capex_not_tagged', cfo.period_end, `Capital spending is not tagged: no capital expenditure is reported for the year to ${cfo.period_end} under the tags Sentinel uses (${CAPEX_TAG_LIST}). Free cash flow is unknown, not zero.`);
  // Priority applies within the filing that reports operating cash flow, so both numbers come from one filing.
  const inFiling = listed.filter(f => f.accession === a.accession && f.period_start === a.period_start);
  const chosen = CAPEX_TAGS.map(t => inFiling.find(f => f.source_tag === t)).find(Boolean);
  // The figure's own input is read through the figure (its value and unit are the figure's); other tags are raw facts.
  const own = (f: FinancialFact) => !!capexFigure && f === capexFigure.inputs[0];
  const unitOf = (f: FinancialFact) => (own(f) ? capexFigure!.unit : f.unit), valueOf = (f: FinancialFact) => (own(f) ? capexFigure!.value as number : f.value);
  if (cfo.unit !== 'USD' || !chosen || unitOf(chosen) !== 'USD' || !a.period_start || !a.raw_event_id || !chosen.raw_event_id)
    return unknown('not_matched', cfo.period_end, 'Operating cash flow and capital expenditure do not share a verified period, currency and filing.');
  const capex = valueOf(chosen);
  if (capex < 0) return unknown('capex_negative', cfo.period_end, 'Reported capital expenditure is negative, so it cannot be read as spending.');
  const others: OtherCapexTag[] = [];
  for (const f of inFiling) if (f.source_tag !== chosen.source_tag && valueOf(f) !== capex && !others.some(o => o.tag === f.source_tag)) others.push({ tag: f.source_tag, value: valueOf(f) });
  const capexNote = others.length ? `Other capital-spending tag also reported: ${others.map(o => `${o.tag} (${usd(o.value)})`).join(', ')}. Sentinel uses ${chosen.source_tag} (${usd(capex)}), the first tag in ${CAPEX_TAG_LIST}, and never adds tags together.` : null;
  return {
    status: 'reported', version: FCF_VERSION, capexTagList: CAPEX_TAG_LIST, value: (cfo.value as number) - capex, cfo: cfo.value as number, capex,
    unit: 'USD', periodStart: a.period_start, periodEnd: a.period_end, filed: a.filed, accession: a.accession, rawEventId: a.raw_event_id, cfoTag: a.source_tag, capexTag: chosen.source_tag,
    otherCapexTags: others, capexNote, method: FCF_METHOD,
  };
}
