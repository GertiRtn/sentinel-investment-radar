import type {Figure} from './financial';
/** Hypothetical company-level cash-flow scenarios. These are not a per-share valuation. */
export function cashflowScenarios(figures:Figure[],asOf:string){
 const absent=(reason:string)=>({status:'unavailable' as const,reason});
 if(!Number.isFinite(Date.parse(asOf)))return absent('Invalid assessment time.');
 const cfo=figures.filter(f=>f.metric==='cfo'&&f.confidence==='reported'&&f.value!==null&&f.inputs.length===1).sort((a,b)=>b.period_end.localeCompare(a.period_end))[0];
 if(!cfo)return absent('A reported annual operating cash flow is unavailable.');
 const capex=figures.find(f=>f.metric==='capex'&&f.period_end===cfo.period_end&&f.confidence==='reported'&&f.value!==null&&f.inputs.length===1);
 if(!capex)return absent('A matching reported annual capital expenditure is unavailable.');
 const a=cfo.inputs[0],b=capex.inputs[0];
 if(cfo.unit!=='USD'||capex.unit!=='USD'||!a.period_start||a.period_start!==b.period_start||a.accession!==b.accession||!a.raw_event_id||!b.raw_event_id)return absent('Operating cash flow and capital expenditure do not share a verified period, currency and filing.');
 const age=Date.parse(asOf)-Date.parse(cfo.period_end+'T23:59:59.999Z');if(age<0||age>550*86400000)return absent('The matching annual cash-flow period is more than 550 days old or is in the future.');
 const base=cfo.value!-capex.value!;if(capex.value!<0||base<=0)return absent('Reported capital expenditure or cash flow does not support a positive cash-flow scenario.');
 const discount=.12,terminalGrowth=.02,years=5;
 const scenarios=[{label:'Lower',growth:-.05},{label:'Flat',growth:0},{label:'Higher',growth:.05}].map(s=>{let pv=0;for(let year=1;year<=years;year++)pv+=base*(1+s.growth)**year/(1+discount)**year;const terminal=base*(1+s.growth)**years*(1+terminalGrowth)/(discount-terminalGrowth)/(1+discount)**years;return {...s,discount,terminalGrowth,years,presentValue:pv+terminal,terminalShare:terminal/(pv+terminal)};});
 return {status:'illustrative' as const,baseCashFlow:base,cfo:cfo.value,capex:capex.value,unit:'USD',periodStart:a.period_start,periodEnd:a.period_end,filed:a.filed,accession:a.accession,rawEventId:a.raw_event_id,method:'reported CFO minus reported capital expenditure; five projected years plus perpetual terminal value',scenarios,limitations:'Hypothetical assumptions, not a forecast or fair value. CFO minus capex is not audited free cash flow or owner earnings and may omit financing needs, acquisitions, share-based compensation, noncontrolling interests and future dilution. These company-level figures cannot be compared to a stock price without verified security and share-class information.'};
}
