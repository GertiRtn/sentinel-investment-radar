import type {Figure} from './financial';
import {freeCashFlow} from './free-cash-flow';
/** Illustrative assumptions shared with implied-expectations.ts. Changing one changes both, so it needs new versions. */
export const DCF_ASSUMPTIONS=Object.freeze({discount:.12,terminalGrowth:.02,years:5});
/** Hypothetical company-level cash-flow scenarios. These are not a per-share valuation. */
export function cashflowScenarios(figures:Figure[],asOf:string){
 const absent=(reason:string)=>({status:'unavailable' as const,reason});
 if(!Number.isFinite(Date.parse(asOf)))return absent('Invalid assessment time.');
 // Base = free cash flow from the one shared function (capex-tags-v3), then this scenario's own checks.
 const fcf=freeCashFlow(figures);
 if(fcf.status!=='reported')return absent(fcf.reason);
 const age=Date.parse(asOf)-Date.parse(fcf.periodEnd+'T23:59:59.999Z');if(age<0||age>550*86400000)return absent('The matching annual cash-flow period is more than 550 days old or is in the future.');
 const base=fcf.value;if(base<=0)return absent('Reported capital expenditure or cash flow does not support a positive cash-flow scenario.');
 const {discount,terminalGrowth,years}=DCF_ASSUMPTIONS;
 const scenarios=[{label:'Lower',growth:-.05},{label:'Flat',growth:0},{label:'Higher',growth:.05}].map(s=>{let pv=0;for(let year=1;year<=years;year++)pv+=base*(1+s.growth)**year/(1+discount)**year;const terminal=base*(1+s.growth)**years*(1+terminalGrowth)/(discount-terminalGrowth)/(1+discount)**years;return {...s,discount,terminalGrowth,years,presentValue:pv+terminal,terminalShare:terminal/(pv+terminal)};});
 return {status:'illustrative' as const,baseCashFlow:base,cfo:fcf.cfo,capex:fcf.capex,unit:'USD',periodStart:fcf.periodStart,periodEnd:fcf.periodEnd,filed:fcf.filed,accession:fcf.accession,rawEventId:fcf.rawEventId,capexTag:fcf.capexTag,capexTagList:fcf.capexTagList,otherCapexTags:fcf.otherCapexTags,capexNote:fcf.capexNote,fcfVersion:fcf.version,method:'reported CFO minus reported capital expenditure; five projected years plus perpetual terminal value',scenarios,limitations:'Hypothetical assumptions, not a forecast or fair value. CFO minus capex is not audited free cash flow or owner earnings and may omit financing needs, acquisitions, share-based compensation, noncontrolling interests and future dilution. These company-level figures cannot be compared to a stock price without verified security and share-class information.'};
}
