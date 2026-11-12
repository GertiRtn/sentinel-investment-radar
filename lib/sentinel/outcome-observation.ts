/** Forward horizons in matched trading-day intervals. 5 is the original v1 horizon; the others are separate records. */
export const OUTCOME_HORIZONS=[5,20,60,120] as const;
/** Calendar days to wait before a horizon can possibly be complete (5 → 8, as before). */
export const horizonWaitDays=(intervals:number)=>Math.ceil(intervals*7/5)+1;
/** Compares intervals+1 matched completed daily closes (default 5 intervals = six closes), beginning after the case date. */
export function compareForwardBars(stock:any,benchmark:any,caseAt:string,asOf:string,intervals=5){
 const caseDay=caseAt.slice(0,10),today=asOf.slice(0,10);if(!Number.isFinite(Date.parse(caseAt))||!Number.isFinite(Date.parse(asOf))||!Array.isArray(stock?.bars)||!Array.isArray(benchmark?.bars))throw new Error('Invalid historical bars.');
 const valid=(rows:any[])=>{const map=new Map<string,number>();for(const b of rows){if(typeof b.t!=='string'||!Number.isFinite(Date.parse(b.t))||typeof b.c!=='number'||!Number.isFinite(b.c)||b.c<=0)continue;const day=b.t.slice(0,10);if(day<=caseDay||day>=today)continue;if(map.has(day))throw new Error('Duplicate daily bar.');map.set(day,b.c);}return map;};
 const a=valid(stock.bars),b=valid(benchmark.bars),days=[...a.keys()].filter(day=>b.has(day)).sort();if(!Number.isInteger(intervals)||intervals<1)throw new Error('Invalid horizon.');if(days.length<intervals+1)return null;
 const entry=days[0],exit=days[intervals],stockReturn=a.get(exit)!/a.get(entry)!-1,benchmarkReturn=b.get(exit)!/b.get(entry)!-1;
 return {entryDate:entry,exitDate:exit,stockEntry:a.get(entry)!,stockExit:a.get(exit)!,benchmarkEntry:b.get(entry)!,benchmarkExit:b.get(exit)!,stockReturn,benchmarkReturn,excessReturn:stockReturn-benchmarkReturn,matchedDates:days.slice(0,intervals+1),horizonIntervals:intervals};
}
