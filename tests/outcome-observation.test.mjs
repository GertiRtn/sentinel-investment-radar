import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';const require=createRequire(import.meta.url),esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));const b=await esbuild.build({entryPoints:['lib/sentinel/outcome-observation.ts'],bundle:true,write:false,platform:'node',format:'esm'});const {compareForwardBars,OUTCOME_HORIZONS,horizonWaitDays}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const bars=values=>({bars:values.map(([date,c])=>({t:date+'T04:00:00Z',c}))});const a=bars([['2026-01-01',1],['2026-01-02',10],['2026-01-05',11],['2026-01-06',12],['2026-01-07',13],['2026-01-08',14],['2026-01-09',15],['2026-01-12',100]]);const bmk=bars([['2026-01-02',20],['2026-01-05',20],['2026-01-06',20],['2026-01-07',20],['2026-01-08',20],['2026-01-09',22],['2026-01-12',99]]);
test('uses completed matched dates strictly after the case with five close-to-close intervals',()=>{const r=compareForwardBars(a,bmk,'2026-01-01T16:00:00Z','2026-01-12T13:00:00Z');assert.equal(r.entryDate,'2026-01-02');assert.equal(r.exitDate,'2026-01-09');assert.ok(Math.abs(r.stockReturn-.5)<1e-9);assert.ok(Math.abs(r.excessReturn-.4)<1e-9)});
test('insufficient matching bars wait and duplicates fail closed',()=>{assert.equal(compareForwardBars(a,bars([['2026-01-02',1]]),'2026-01-01T16:00:00Z','2026-01-12T13:00:00Z'),null);assert.throws(()=>compareForwardBars(bars([['2026-01-02',1],['2026-01-02',2]]),bmk,'2026-01-01T16:00:00Z','2026-01-12T13:00:00Z'))});
test('longer horizons use intervals+1 matched closes and stay separate from the 5-interval result',()=>{
 const days=Array.from({length:30},(_,i)=>new Date(Date.UTC(2026,0,2)+i*86400000).toISOString().slice(0,10));
 const stock={bars:days.map((d,i)=>({t:d+'T04:00:00Z',c:100+i}))},spy={bars:days.map(d=>({t:d+'T04:00:00Z',c:50}))};
 const five=compareForwardBars(stock,spy,'2026-01-01T16:00:00Z','2026-03-01T00:00:00Z');
 const twenty=compareForwardBars(stock,spy,'2026-01-01T16:00:00Z','2026-03-01T00:00:00Z',20);
 assert.equal(five.horizonIntervals,5);assert.equal(five.matchedDates.length,6);assert.ok(Math.abs(five.stockReturn-.05)<1e-9);
 assert.equal(twenty.horizonIntervals,20);assert.equal(twenty.matchedDates.length,21);assert.equal(twenty.exitDate,days[20]);assert.ok(Math.abs(twenty.stockReturn-.2)<1e-9);assert.equal(twenty.benchmarkReturn,0);
 assert.equal(compareForwardBars(stock,spy,'2026-01-01T16:00:00Z','2026-03-01T00:00:00Z',60),null,'not enough closes yet: wait, never guess');
 for(const bad of [0,-5,2.5])assert.throws(()=>compareForwardBars(stock,spy,'2026-01-01T16:00:00Z','2026-03-01T00:00:00Z',bad));
});
test('horizons and their waiting periods',()=>{
 assert.deepEqual([...OUTCOME_HORIZONS],[5,20,60,120]);
 assert.deepEqual(OUTCOME_HORIZONS.map(horizonWaitDays),[8,29,85,169],'5 keeps its original 8-day wait');
});
