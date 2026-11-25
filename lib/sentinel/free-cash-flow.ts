/**
 * Free cash flow (free-cash-flow-v1, 2026-11-25). Pure. The ONE place Sentinel calculates free cash flow: the company
 * page's Key figures, the "What the price assumes" base cash flow and its history, and the case cash-flow scenarios all
 * call it, so they cannot disagree.
 *
 * Free cash flow = reported annual operating cash flow − reported annual capital expenditure, both from the same filing
 * for the same period, in USD. Capital expenditure counts only under CAPEX_TAGS (capex-tags-v3), whatever tag list the
 * figures were derived with. No capex → unknown, never zero.
 */
import { CAPEX_TAGS, CAPEX_TAG_LIST, CAPEX_EXCLUDED, type Figure } from './financial';

export const FCF_VERSION = 'free-cash-flow-v1';
export const FCF_METHOD = 'Operating cash flow minus capital spending (purchases of property, plant and equipment), both reported for the same year in the same filing. Calculated by Sentinel.';

export type FreeCashFlow =
  | { status: 'reported'; version: string; capexTagList: string; value: number; cfo: number; capex: number; unit: 'USD'; periodStart: string; periodEnd: string; filed: string; accession: string; rawEventId: string; cfoTag: string; capexTag: string; method: string }
  | { status: 'unknown'; version: string; capexTagList: string; code: 'cfo_missing' | 'capex_not_tagged' | 'not_matched' | 'capex_negative'; periodEnd: string | null; reason: string };

const one = (f: Figure | undefined) => !!f && f.confidence === 'reported' && f.value !== null && f.inputs.length === 1;

/** Free cash flow for the latest reported annual operating cash flow, or for `periodEnd` when given. */
export function freeCashFlow(figures: Figure[], opts: { periodEnd?: string } = {}): FreeCashFlow {
  const unknown = (code: Extract<FreeCashFlow, { status: 'unknown' }>['code'], periodEnd: string | null, reason: string): FreeCashFlow =>
    ({ status: 'unknown', version: FCF_VERSION, capexTagList: CAPEX_TAG_LIST, code, periodEnd, reason });
  const cfo = figures.filter(f => f.metric === 'cfo' && one(f) && (!opts.periodEnd || f.period_end === opts.periodEnd)).sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
  if (!cfo) return unknown('cfo_missing', opts.periodEnd ?? null, 'A reported annual operating cash flow is unavailable.');
  const capexFigure = figures.find(f => f.metric === 'capex' && f.period_end === cfo.period_end && one(f));
  const capexTag = capexFigure?.inputs[0].source_tag;
  if (!capexFigure || !capexTag || !CAPEX_TAGS.includes(capexTag)) {
    const excluded = capexTag && CAPEX_EXCLUDED[capexTag] ? ` It is reported as ${capexTag}, which is not used because ${CAPEX_EXCLUDED[capexTag]}.` : '';
    return unknown('capex_not_tagged', cfo.period_end, `Capital spending is not tagged: no purchase of property, plant and equipment is reported for the year to ${cfo.period_end} under the tags Sentinel uses (${CAPEX_TAG_LIST}).${excluded} Free cash flow is unknown, not zero.`);
  }
  const a = cfo.inputs[0], b = capexFigure.inputs[0];
  if (cfo.unit !== 'USD' || capexFigure.unit !== 'USD' || !a.period_start || a.period_start !== b.period_start || a.accession !== b.accession || !a.raw_event_id || !b.raw_event_id)
    return unknown('not_matched', cfo.period_end, 'Operating cash flow and capital expenditure do not share a verified period, currency and filing.');
  if ((capexFigure.value as number) < 0) return unknown('capex_negative', cfo.period_end, 'Reported capital expenditure is negative, so it cannot be read as spending.');
  return {
    status: 'reported', version: FCF_VERSION, capexTagList: CAPEX_TAG_LIST, value: (cfo.value as number) - (capexFigure.value as number), cfo: cfo.value as number, capex: capexFigure.value as number,
    unit: 'USD', periodStart: a.period_start, periodEnd: a.period_end, filed: a.filed, accession: a.accession, rawEventId: a.raw_event_id, cfoTag: a.source_tag, capexTag, method: FCF_METHOD,
  };
}
