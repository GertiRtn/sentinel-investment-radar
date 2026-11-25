/** Pure deterministic XBRL selection and derivation. No estimates masquerade as filings. */
export const TAGS:Record<string,string[]>={
 revenue:['RevenueFromContractWithCustomerExcludingAssessedTax','RevenueFromContractWithCustomerIncludingAssessedTax','Revenues','SalesRevenueNet','SalesRevenueGoodsNet'],
 eps_diluted:['EarningsPerShareDiluted'],operating_income:['OperatingIncomeLoss'],net_income:['NetIncomeLoss'],cfo:['NetCashProvidedByUsedInOperatingActivities'],capex:['PaymentsToAcquirePropertyPlantAndEquipment'],depreciation:['DepreciationDepletionAndAmortization','DepreciationAmortizationAndAccretionNet'],cash:['CashAndCashEquivalentsAtCarryingValue'],debt_noncurrent:['LongTermDebtNoncurrent'],debt_current:['LongTermDebtCurrent'],debt_combined:['DebtLongtermAndShorttermCombinedAmount'],equity:['StockholdersEquity'],tax_expense:['IncomeTaxExpenseBenefit'],pretax_income:['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest','IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'],ppe_net:['PropertyPlantAndEquipmentNet'],shares_diluted:['WeightedAverageNumberOfDilutedSharesOutstanding'],cogs:['CostOfRevenue','CostOfGoodsAndServicesSold','CostOfGoodsSold']};
/**
 * Versioned tag lists (2026-11-16). `xbrl-tags-v1` is TAGS, unchanged: every existing figure (company page, cases,
 * evidence score, investment case, cached derived metrics) keeps reading it, so no stored or displayed figure changes.
 * `xbrl-tags-v2` adds capital-expenditure and debt tags found on real filings; only readers that ask for it by name use
 * it, and every figure states which list produced it (`Figure.tagList`). parseFacts stores facts for the union of all
 * lists; derive and quarterlyFigures ignore any tag that is not in the list they were given.
 */
export const TAG_LIST_V1='xbrl-tags-v1',TAG_LIST_V2='xbrl-tags-v2';
export const TAG_LISTS:Record<string,Record<string,string[]>>={
 [TAG_LIST_V1]:TAGS,
 [TAG_LIST_V2]:{...TAGS,
  // EMCOR reports capital spending as PaymentsToAcquireProductiveAssets; oil and gas producers report drilling and development as
  // PaymentsToExploreAndDevelopOilAndGasProperties. PaymentsToAcquireOilAndGasProperty is NOT added: Diamondback's includes acquisitions.
  capex:['PaymentsToAcquirePropertyPlantAndEquipment','PaymentsToAcquireProductiveAssets','PaymentsToExploreAndDevelopOilAndGasProperties'],
  debt_noncurrent:['LongTermDebtNoncurrent','LongTermDebtAndCapitalLeaseObligations'],
  debt_current:['LongTermDebtCurrent','DebtCurrent','LongTermDebtAndCapitalLeaseObligationsCurrent'],
  debt_combined:['DebtLongtermAndShorttermCombinedAmount','LongTermDebt'],
  short_term_borrowings:['ShortTermBorrowings','LineOfCredit','CommercialPaper']},
};
/** `xbrl-tags-v3` (2026-11-16) = v2 plus claims ranking with or ahead of common shareholders, as balance-sheet values. */
export const TAG_LIST_V3='xbrl-tags-v3';
TAG_LISTS[TAG_LIST_V3]={...TAG_LISTS[TAG_LIST_V2],
 nci:['MinorityInterest'],nci_redeemable:['RedeemableNoncontrollingInterestEquityCarryingAmount'],
 preferred:['PreferredStockValue','PreferredStockValueOutstanding']};
/**
 * The ONE capital-expenditure tag list for free cash flow (`capex-tags-v3`, 2026-11-25). Free cash flow anywhere in
 * Sentinel comes from `freeCashFlow()` (free-cash-flow.ts), which accepts capex only under these tags.
 * Only tags whose SEC definition is purchases of property, plant and equipment. Left out for the founder to decide:
 * PaymentsToAcquireProductiveAssets (SEC definition also covers software and other intangible assets; EMCOR uses it)
 * and PaymentsToExploreAndDevelopOilAndGasProperties (covers exploration as well as development).
 * The list is a separate version from the xbrl tag lists: xbrl-tags-v3 already existed for claims.
 */
export const CAPEX_TAG_LIST='capex-tags-v3';
export const CAPEX_TAGS:readonly string[]=Object.freeze(['PaymentsToAcquirePropertyPlantAndEquipment']);
export const CAPEX_EXCLUDED:Readonly<Record<string,string>>=Object.freeze({
 PaymentsToAcquireProductiveAssets:'its SEC definition also covers software and other intangible assets',
 PaymentsToExploreAndDevelopOilAndGasProperties:'its SEC definition covers exploration as well as development of oil and gas properties'});
/** `xbrl-tags-v4` (2026-11-25) = v3 with capex taken from CAPEX_TAGS. Read by the company page and the decision workflow. */
export const TAG_LIST_V4='xbrl-tags-v4';
TAG_LISTS[TAG_LIST_V4]={...TAG_LISTS[TAG_LIST_V3],capex:[...CAPEX_TAGS]};
export type TagListId=typeof TAG_LIST_V1|typeof TAG_LIST_V2|'xbrl-tags-v3'|'xbrl-tags-v4';
const listOf=(id:string)=>{const l=TAG_LISTS[id];if(!l)throw new Error('Unknown tag list '+id);return l;};
const KNOWN=new Map<string,Set<string>>();for(const l of Object.values(TAG_LISTS))for(const [m,t] of Object.entries(l))KNOWN.set(m,new Set([...(KNOWN.get(m)??[]),...t]));
/** A fact is left out only when its tag belongs to another tag list and not to this one (so a v2-only tag never reaches a v1 figure). */
const outside=(list:Record<string,string[]>,f:FinancialFact)=>!!KNOWN.get(f.metric)?.has(f.source_tag)&&!list[f.metric]?.includes(f.source_tag);
export type FinancialFact={id:string;entity_id:string;metric:string;source_tag:string;value:number;unit:string;period_start:string;period_end:string;fiscal_year:number|null;fiscal_period:string|null;form:string;known_from:string;filed:string;accession:string;raw_event_id:string;recorded_at:string};
export type Figure={metric:string;value:number|null;unit:string;period_end:string;known_from:string|null;inputs:FinancialFact[];method:string;tagList?:string;confidence:'computed'|'estimated'|'unavailable'|'reported';reason:string};
export const day=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d));
export function parseFacts(data:any,entity:string,raw:string,recorded:string):FinancialFact[]{
 const out:FinancialFact[]=[],pairs=new Map<string,[string,string]>();for(const list of Object.values(TAG_LISTS))for(const [metric,tags] of Object.entries(list))for(const tag of tags)pairs.set(metric+'|'+tag,[metric,tag]);
 for(const [metric,tag] of pairs.values())for(const [unit,rows] of Object.entries(data?.facts?.['us-gaap']?.[tag]?.units||{})){
 if(unit!==(metric==='shares_diluted'?'shares':metric==='eps_diluted'?'USD/shares':'USD')||!Array.isArray(rows))continue;
 for(const e of rows){if(!day(e.end)||!day(e.filed)||e.start&&!day(e.start)||typeof e.val!=='number'||!Number.isFinite(e.val)||!/^\d{10}-\d{2}-\d{6}$/.test(e.accn)||!['10-K','10-K/A','10-Q','10-Q/A','20-F','20-F/A','40-F','40-F/A'].includes(e.form))continue;
 out.push({id:[entity,tag,unit,e.start||'',e.end,e.accn].join(':'),entity_id:entity,metric,source_tag:tag,value:e.val,unit,period_start:e.start||'',period_end:e.end,fiscal_year:Number.isInteger(e.fy)?e.fy:null,fiscal_period:e.fp||null,form:e.form,known_from:e.filed+'T23:59:59.999Z',filed:e.filed,accession:e.accn,raw_event_id:raw,recorded_at:recorded});
 }}
 out.push(...parseShareCounts(data,entity,raw,recorded),...unreadableClaims(data,entity,raw,recorded));return out;
}
/**
 * Cover-page share count (dei:EntityCommonStockSharesOutstanding), metric `shares_outstanding` (2026-11-16).
 * An instant fact: `period_end` is the cover-page date, `period_start` is empty, `known_from` is the filing date.
 * Several share classes = more than one distinct value on the SAME cover date inside ONE filing: the values are NOT
 * summed and one marker fact `shares_outstanding_multiclass` (value = how many values, unit `classes`) is emitted instead.
 * An amended filing (10-K/A, 10-Q/A) is a separate filing: it repeats or corrects the count, so a different value on the
 * same date in another filing is a revision (the most recently filed wins in latestShareCount), never a second class.
 * A filing that reports one value on each of two dates (an amendment repeating the original cover date) is not
 * multi-class either; each date becomes its own fact. Not part of TAGS, so `derive` and investment-case-v1 are unchanged.
 */
/**
 * Claim tags (noncontrolling interests, preferred stock) that are present in the company's file but cannot be read
 * as US dollars: one marker fact `claim_unreadable` per tag and unit (value = number of rows, unit = the file's unit),
 * dated by the latest valid row, so a reader can say "reported but could not be read" instead of "not reported".
 */
export const CLAIM_TAG_LIST=['MinorityInterest','RedeemableNoncontrollingInterestEquityCarryingAmount','PreferredStockValue','PreferredStockValueOutstanding'];
export function unreadableClaims(data:any,entity:string,raw:string,recorded:string):FinancialFact[]{
 const out:FinancialFact[]=[];
 for(const tag of CLAIM_TAG_LIST)for(const [unit,rows] of Object.entries(data?.facts?.['us-gaap']?.[tag]?.units||{})){
  if(unit==='USD'||!Array.isArray(rows))continue;
  const valid=(rows as any[]).filter(e=>day(e?.end)&&day(e?.filed)&&/^\d{10}-\d{2}-\d{6}$/.test(e?.accn)).sort((a,b)=>a.filed.localeCompare(b.filed)||a.end.localeCompare(b.end));
  const last=valid.at(-1);if(!last)continue;
  out.push({id:[entity,tag+'#unreadable',unit,'',last.end,last.accn].join(':'),entity_id:entity,metric:'claim_unreadable',source_tag:tag,value:rows.length,unit,period_start:'',period_end:last.end,fiscal_year:Number.isInteger(last.fy)?last.fy:null,fiscal_period:last.fp||null,form:String(last.form||''),known_from:last.filed+'T23:59:59.999Z',filed:last.filed,accession:last.accn,raw_event_id:raw,recorded_at:recorded});
 }
 return out;
}
export const SHARES_TAG='EntityCommonStockSharesOutstanding';
export function parseShareCounts(data:any,entity:string,raw:string,recorded:string):FinancialFact[]{
 const rows=data?.facts?.dei?.[SHARES_TAG]?.units?.shares;if(!Array.isArray(rows))return [];
 const ok=rows.filter((e:any)=>day(e?.end)&&day(e?.filed)&&typeof e.val==='number'&&Number.isFinite(e.val)&&e.val>0&&/^\d{10}-\d{2}-\d{6}$/.test(e.accn)&&['10-K','10-K/A','10-Q','10-Q/A','20-F','20-F/A','40-F','40-F/A'].includes(e.form));
 const perFilingDate=new Map<string,Set<number>>();
 for(const e of ok){const k=e.accn+'|'+e.end;perFilingDate.set(k,(perFilingDate.get(k)??new Set()).add(e.val));}
 const out:FinancialFact[]=[],seen=new Set<string>();
 for(const e of ok){
  const multi=perFilingDate.get(e.accn+'|'+e.end)!.size,base={entity_id:entity,period_start:'',period_end:e.end,fiscal_year:Number.isInteger(e.fy)?e.fy:null,fiscal_period:e.fp||null,form:e.form,known_from:e.filed+'T23:59:59.999Z',filed:e.filed,accession:e.accn,raw_event_id:raw,recorded_at:recorded};
  const f:FinancialFact=multi>1?{...base,id:[entity,SHARES_TAG+'#classes','classes','',e.end,e.accn].join(':'),metric:'shares_outstanding_multiclass',source_tag:SHARES_TAG+'#classes',value:multi,unit:'classes'}
   :{...base,id:[entity,SHARES_TAG,'shares','',e.end,e.accn].join(':'),metric:'shares_outstanding',source_tag:SHARES_TAG,value:e.val,unit:'shares'};
  if(!seen.has(f.id)){seen.add(f.id);out.push(f);}
 }
 return out;
}
/** The share count as known at `asOf`: the fact from the most recently filed report (then the latest cover date). A multi-class marker wins over a count from the same filing and date. */
export function latestShareCount(rows:FinancialFact[],asOf:string,recordedAsOf?:string){
 const mine=rows.filter(f=>(f.metric==='shares_outstanding'||f.metric==='shares_outstanding_multiclass')&&f.known_from<=asOf&&(!recordedAsOf||f.recorded_at<=recordedAsOf));
 if(!mine.length)return null;
 return mine.sort((a,b)=>b.known_from.localeCompare(a.known_from)||b.period_end.localeCompare(a.period_end)||(a.metric<b.metric?1:-1))[0];
}
export function annual(f:FinancialFact){const days=(Date.parse(f.period_end)-Date.parse(f.period_start))/86400000;return !f.period_start||days>=330&&days<=380;}
/** Directly reported three-month flows only. Never infer a quarter from YTD figures. */
export function quarterlyFigures(rows:FinancialFact[],asOf:string,recordedAsOf?:string,tagList:string=TAG_LIST_V1):Figure[]{
 const choices=new Map<string,FinancialFact>(),TAGS=listOf(tagList);
 for(const f of rows){if(outside(TAGS,f))continue;
  const days=(Date.parse(f.period_end)-Date.parse(f.period_start))/86400000;
  if(!f.period_start||days<75||days>105||f.known_from>asOf||recordedAsOf&&f.recorded_at>recordedAsOf)continue;
  const key=f.metric+':'+f.period_end,old=choices.get(key);
  const rank=(x:FinancialFact)=>{const i=TAGS[x.metric]?.indexOf(x.source_tag)??-1;return i<0?999:i;};
  if(!old||f.known_from>old.known_from||f.known_from===old.known_from&&(rank(f)<rank(old)||rank(f)===rank(old)&&f.accession>old.accession))choices.set(key,f);
 }
 return [...choices.values()].map(f=>({metric:f.metric,value:f.value,unit:f.unit,period_end:f.period_end,known_from:f.known_from,inputs:[f],method:'reported:'+f.source_tag,tagList,confidence:'reported',reason:'Directly reported approximately three-month period'}));
}
export function selectFacts(rows:FinancialFact[],asOf:string,recordedAsOf?:string,tagList:string=TAG_LIST_V1){
 const choices=new Map<string,FinancialFact>(),TAGS=listOf(tagList);
 for(const f of rows){if(outside(TAGS,f))continue;if(f.known_from>asOf||recordedAsOf&&f.recorded_at>recordedAsOf||!annual(f))continue;const key=f.metric+':'+f.period_end;const old=choices.get(key);const priority=TAGS[f.metric]?.indexOf(f.source_tag)??99;const oldPriority=old?TAGS[old.metric]?.indexOf(old.source_tag)??99:99;
 // Restatement date first, then disclosed tag priority. Do not confuse fiscal year of filing with fact period.
 if(!old||f.known_from>old.known_from||f.known_from===old.known_from&&(priority<oldPriority||priority===oldPriority&&f.accession>old.accession))choices.set(key,f);
 }return [...choices.values()];
}
export function derive(rows:FinancialFact[],asOf:string,recordedAsOf?:string,tagList:string=TAG_LIST_V1):Figure[]{
 const TAGS=listOf(tagList),selected=selectFacts(rows,asOf,recordedAsOf,tagList),periods=[...new Set(selected.filter(f=>f.period_start).map(f=>f.period_end))].sort();const all:Figure[]=[];const byPeriod=new Map<string,Record<string,Figure>>();
 for(const end of periods){const map:Record<string,Figure>={};
 for(const metric of Object.keys(TAGS)){const f=selected.find(f=>f.metric===metric&&f.period_end===end);map[metric]={metric,value:f?.value??null,unit:metric==='shares_diluted'?'shares':metric==='eps_diluted'?'USD/shares':'USD',period_end:end,known_from:f?.known_from||null,inputs:f?[f]:[],method:f?'reported:'+f.source_tag:'unavailable',confidence:f?'reported':'unavailable',reason:f?'Reported annual period or year-end balance':'No supported tag for this annual period'};}
 const calc=(metric:string,deps:Figure[],fn:(v:number[])=>number,method:string,unit='ratio',estimate=false)=>{
 const inputs=[...new Map(deps.flatMap(d=>d.inputs).map(f=>[f.id,f])).values()];const durations=inputs.filter(f=>f.period_start&&f.period_end===end).map(f=>f.period_start);const aligned=new Set(durations).size<=1;
 const missing=deps.some(d=>d.value===null);let value=missing||!aligned?null:fn(deps.map(d=>d.value!));if(value!==null&&!Number.isFinite(value))value=null;
 const f:Figure={metric,value,unit,period_end:end,known_from:inputs.length?inputs.map(f=>f.known_from).sort().at(-1)!:null,inputs,method,confidence:value===null?'unavailable':estimate?'estimated':'computed',reason:missing?'Missing input: '+deps.filter(d=>d.value===null).map(d=>d.metric).join(', '):!aligned?'Duration inputs cover different periods':value===null?'Undefined denominator or economically invalid input':estimate?'Convention: operating cash = 2% of annual revenue; not a reported fact':'Computed from cited filings'};map[metric]=f;return f;
 };
 calc('total_debt',[map.debt_noncurrent,map.debt_current],v=>v[0]+v[1],'debt-components-v1','USD');if(map.total_debt.value===null&&map.debt_combined.value!==null)map.total_debt={...map.debt_combined,metric:'total_debt',method:'reported-combined-debt-v1'};
 calc('effective_tax_rate',[map.tax_expense,map.pretax_income],v=>v[1]>0&&v[0]>=0&&v[0]<=v[1]?v[0]/v[1]:NaN,'positive-pretax-tax-rate-v1');
 calc('nopat',[map.operating_income,map.effective_tax_rate],v=>v[0]*(1-v[1]),'nopat-v1','USD');
 calc('invested_capital',[map.total_debt,map.equity,map.cash,map.revenue],v=>v[0]+v[1]-Math.max(0,v[2]-0.02*v[3]),'excess-cash-2pct-revenue-v1','USD',true);
 calc('net_debt',[map.total_debt,map.cash],v=>v[0]-v[1],'debt-minus-cash-v1','USD');
 calc('cash_conversion',[map.cfo,map.net_income],v=>v[1]>0?v[0]/v[1]:NaN,'cfo-positive-net-income-v1');
 calc('gross_margin',[map.revenue,map.cogs],v=>v[0]>0?(v[0]-v[1])/v[0]:NaN,'gross-margin-v1');
 calc('ebitda',[map.operating_income,map.depreciation],v=>v[0]+v[1],'operating-income-plus-da-proxy-v1','USD',true);
 calc('net_debt_to_ebitda',[map.net_debt,map.ebitda],v=>v[1]>0?v[0]/v[1]:NaN,'net-debt-positive-ebitda-proxy-v1','ratio',true);
 const priorEnd=periods.filter(p=>p<end&&Date.parse(end)-Date.parse(p)>=330*86400000&&Date.parse(end)-Date.parse(p)<=400*86400000).at(-1);const prior=priorEnd?byPeriod.get(priorEnd):null;
 const missing=(metric:string):Figure=>({...map.equity,metric,value:null,inputs:[],confidence:'unavailable',reason:'Consecutive prior annual period missing'});
 calc('share_count_yoy',[map.shares_diluted,prior?.shares_diluted||missing('prior shares')],v=>v[1]>0?v[0]/v[1]-1:NaN,'annual-diluted-shares-yoy-v1');
 calc('roic',[map.nopat,map.invested_capital,prior?.invested_capital||missing('prior invested capital')],v=>v[1]+v[2]>0?v[0]/((v[1]+v[2])/2):NaN,'average-annual-ic-roic-v1','ratio',true);
 for(const k of [3,4,5]){const baseEnd=periods.find(p=>Math.abs((Date.parse(end)-Date.parse(p))/86400000-365.25*k)<40);const base=baseEnd?byPeriod.get(baseEnd):null;calc('incremental_roic_'+k+'y',[map.nopat,base?.nopat||missing('base nopat'),map.invested_capital,base?.invested_capital||missing('base invested capital')],v=>v[2]-v[3]>0?(v[0]-v[1])/(v[2]-v[3]):NaN,'incremental-roic-'+k+'y-v1','ratio',true);}
 map.maintenance_capex={...missing('maintenance_capex'),unit:'USD',reason:'Supply a dated human estimate and triangulation method'};map.owner_earnings={...missing('owner_earnings'),unit:'USD',reason:'Requires maintenance capex and a complete owner-earnings reconciliation; depreciation is not a substitute'};
 byPeriod.set(end,map);all.push(...Object.values(map).map(f=>({...f,tagList})));
 }return all;
}
