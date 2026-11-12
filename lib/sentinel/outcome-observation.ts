/** Compares six matched completed daily close observations, beginning after the case date. */
export function compareForwardBars(stock:any,benchmark:any,caseAt:string,asOf:string){
 const caseDay=caseAt.slice(0,10),today=asOf.slice(0,10);if(!Number.isFinite(Date.parse(caseAt))||!Number.isFinite(Date.parse(asOf))||!Array.isArray(stock?.bars)||!Array.isArray(benchmark?.bars))throw new Error('Invalid historical bars.');
 const valid=(rows:any[])=>{const map=new Map<string,number>();for(const b of rows){if(typeof b.t!=='string'||!Number.isFinite(Date.parse(b.t))||typeof b.c!=='number'||!Number.isFinite(b.c)||b.c<=0)continue;const day=b.t.slice(0,10);if(day<=caseDay||day>=today)continue;if(map.has(day))throw new Error('Duplicate daily bar.');map.set(day,b.c);}return map;};
 const a=valid(stock.bars),b=valid(benchmark.bars),days=[...a.keys()].filter(day=>b.has(day)).sort();if(days.length<6)return null;
 const entry=days[0],exit=days[5],stockReturn=a.get(exit)!/a.get(entry)!-1,benchmarkReturn=b.get(exit)!/b.get(entry)!-1;
 return {entryDate:entry,exitDate:exit,stockEntry:a.get(entry)!,stockExit:a.get(exit)!,benchmarkEntry:b.get(entry)!,benchmarkExit:b.get(exit)!,stockReturn,benchmarkReturn,excessReturn:stockReturn-benchmarkReturn,matchedDates:days.slice(0,6),horizonIntervals:5};
}
