/** Pure deterministic XBRL selection and derivation. No estimates masquerade as filings. */
export const TAGS:Record<string,string[]>={
 revenue:['RevenueFromContractWithCustomerExcludingAssessedTax','RevenueFromContractWithCustomerIncludingAssessedTax','Revenues','SalesRevenueNet','SalesRevenueGoodsNet'],
 operating_income:['OperatingIncomeLoss'],net_income:['NetIncomeLoss'],cfo:['NetCashProvidedByUsedInOperatingActivities'],capex:['PaymentsToAcquirePropertyPlantAndEquipment'],depreciation:['DepreciationDepletionAndAmortization','DepreciationAmortizationAndAccretionNet'],cash:['CashAndCashEquivalentsAtCarryingValue'],debt_noncurrent:['LongTermDebtNoncurrent'],debt_current:['LongTermDebtCurrent'],debt_combined:['DebtLongtermAndShorttermCombinedAmount'],equity:['StockholdersEquity'],tax_expense:['IncomeTaxExpenseBenefit'],pretax_income:['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest','IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'],ppe_net:['PropertyPlantAndEquipmentNet'],shares_diluted:['WeightedAverageNumberOfDilutedSharesOutstanding'],cogs:['CostOfRevenue','CostOfGoodsAndServicesSold','CostOfGoodsSold']};
export type FinancialFact={id:string;entity_id:string;metric:string;source_tag:string;value:number;unit:string;period_start:string;period_end:string;fiscal_year:number|null;fiscal_period:string|null;form:string;known_from:string;filed:string;accession:string;raw_event_id:string;recorded_at:string};
export type Figure={metric:string;value:number|null;unit:string;period_end:string;known_from:string|null;inputs:FinancialFact[];method:string;confidence:'computed'|'estimated'|'unavailable'|'reported';reason:string};
export const day=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d));
export function parseFacts(data:any,entity:string,raw:string,recorded:string):FinancialFact[]{
 const out:FinancialFact[]=[];for(const [metric,tags] of Object.entries(TAGS))for(const tag of tags)for(const [unit,rows] of Object.entries(data?.facts?.['us-gaap']?.[tag]?.units||{})){
 if(unit!==(metric==='shares_diluted'?'shares':'USD')||!Array.isArray(rows))continue;
 for(const e of rows){if(!day(e.end)||!day(e.filed)||e.start&&!day(e.start)||typeof e.val!=='number'||!Number.isFinite(e.val)||!/^\d{10}-\d{2}-\d{6}$/.test(e.accn)||!['10-K','10-K/A','10-Q','10-Q/A','20-F','20-F/A','40-F','40-F/A'].includes(e.form))continue;
 out.push({id:[entity,tag,unit,e.start||'',e.end,e.accn].join(':'),entity_id:entity,metric,source_tag:tag,value:e.val,unit,period_start:e.start||'',period_end:e.end,fiscal_year:Number.isInteger(e.fy)?e.fy:null,fiscal_period:e.fp||null,form:e.form,known_from:e.filed+'T23:59:59.999Z',filed:e.filed,accession:e.accn,raw_event_id:raw,recorded_at:recorded});
 }}return out;
}
export function annual(f:FinancialFact){const days=(Date.parse(f.period_end)-Date.parse(f.period_start))/86400000;return !f.period_start||days>=330&&days<=380;}
export function selectFacts(rows:FinancialFact[],asOf:string,recordedAsOf?:string){
 const choices=new Map<string,FinancialFact>();
 for(const f of rows){if(f.known_from>asOf||recordedAsOf&&f.recorded_at>recordedAsOf||!annual(f))continue;const key=f.metric+':'+f.period_end;const old=choices.get(key);const priority=TAGS[f.metric]?.indexOf(f.source_tag)??99;const oldPriority=old?TAGS[old.metric]?.indexOf(old.source_tag)??99:99;
 // Restatement date first, then disclosed tag priority. Do not confuse fiscal year of filing with fact period.
 if(!old||f.known_from>old.known_from||f.known_from===old.known_from&&(priority<oldPriority||priority===oldPriority&&f.accession>old.accession))choices.set(key,f);
 }return [...choices.values()];
}
export function derive(rows:FinancialFact[],asOf:string,recordedAsOf?:string):Figure[]{
 const selected=selectFacts(rows,asOf,recordedAsOf),periods=[...new Set(selected.filter(f=>f.period_start).map(f=>f.period_end))].sort();const all:Figure[]=[];const byPeriod=new Map<string,Record<string,Figure>>();
 for(const end of periods){const map:Record<string,Figure>={};
 for(const metric of Object.keys(TAGS)){const f=selected.find(f=>f.metric===metric&&f.period_end===end);map[metric]={metric,value:f?.value??null,unit:metric==='shares_diluted'?'shares':'USD',period_end:end,known_from:f?.known_from||null,inputs:f?[f]:[],method:f?'reported:'+f.source_tag:'unavailable',confidence:f?'reported':'unavailable',reason:f?'Reported annual period or year-end balance':'No supported tag for this annual period'};}
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
 byPeriod.set(end,map);all.push(...Object.values(map));
 }return all;
}
