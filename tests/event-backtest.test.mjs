import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const b=await esbuild.build({entryPoints:['lib/sentinel/event-backtest.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const B=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));

const days=['2026-03-02','2026-03-03','2026-03-04','2026-03-05','2026-03-06','2026-03-09'];
const series=(start,step)=>days.map((d,i)=>({date:d,open:start+i*step,close:start+i*step+0.5}));
const bars={ABC:series(100,2),SPY:series(500,1)};
const A={...B.DEFAULT_ASSUMPTIONS,holdSessions:2,spreadBps:0,feeBps:0,slippageBps:0,latencyMinutes:15};
const ev=(o)=>({id:'e',symbol:'ABC',publishedAt:'2026-03-03T13:00:00.000Z',firstObservedAt:'2026-03-03T13:05:00.000Z',assessedAt:'2026-03-03T14:20:00.000Z',signal:true,...o});

test('orders never fill before the information existed: latency can push the fill to the next session',()=>{
 const r=B.runBacktest([ev({assessedAt:'2026-03-03T14:20:00.000Z'})],bars,{...A,latencyMinutes:15}).trades[0];
 assert.ok(Date.parse(r.orderAt)>Date.parse('2026-03-03T14:30:00.000Z'));assert.equal(r.entryDate,'2026-03-04','order at 14:35 misses the 14:30 open; fills next session');
 const early=B.runBacktest([ev({assessedAt:'2026-03-03T09:00:00.000Z',firstObservedAt:'2026-03-03T08:00:00.000Z',publishedAt:'2026-03-03T07:00:00.000Z'})],bars,A).trades[0];
 assert.equal(early.entryDate,'2026-03-03','pre-open signal fills at that session open');
});

test('costs are explicit on both sides and the SPY comparator pays the same costs',()=>{
 const free=B.runBacktest([ev({assessedAt:'2026-03-03T09:00:00.000Z',firstObservedAt:'2026-03-03T08:00:00.000Z',publishedAt:'2026-03-03T07:00:00.000Z'})],bars,A).trades[0];
 assert.equal(free.entryPrice,102);assert.equal(free.exitPrice,106);assert.equal(free.costs,0);
 const costly=B.runBacktest([ev({assessedAt:'2026-03-03T09:00:00.000Z',firstObservedAt:'2026-03-03T08:00:00.000Z',publishedAt:'2026-03-03T07:00:00.000Z'})],bars,{...A,spreadBps:20,feeBps:5,slippageBps:5}).trades[0];
 assert.ok(costly.netReturnPct<free.netReturnPct);assert.ok(costly.costs>0);assert.ok(costly.spyReturnPct<free.spyReturnPct);
});

test('missing bars reject the fill instead of guessing; out-of-order clocks and no-signal events are skipped',()=>{
 const late=B.runBacktest([ev({assessedAt:'2026-03-08T10:00:00.000Z',firstObservedAt:'2026-03-08T09:00:00.000Z'})],bars,A).trades[0];assert.equal(late.status,'rejected');assert.match(late.reason,/fewer than 2 sessions/);
 const noSpy=B.runBacktest([ev({assessedAt:'2026-03-03T09:00:00.000Z',firstObservedAt:'2026-03-03T08:00:00.000Z',publishedAt:'2026-03-03T07:00:00.000Z'})],{ABC:bars.ABC,SPY:[]},A).trades[0];assert.equal(noSpy.status,'rejected');
 assert.equal(B.runBacktest([ev({firstObservedAt:'2026-03-03T12:00:00.000Z'})],bars,A).trades[0].status,'skipped','observed before published');
 assert.equal(B.runBacktest([ev({signal:false})],bars,A).trades[0].reason,'no signal');
 assert.throws(()=>B.runBacktest([],{X:[{date:'2026-03-03',open:1,close:1},{date:'2026-03-02',open:1,close:1}]},A),/out of order/);
});

test('deterministic: the same inputs in any order give the same result',()=>{
 const evs=[ev({id:'a'}),ev({id:'b',assessedAt:'2026-03-02T09:00:00.000Z',firstObservedAt:'2026-03-02T08:00:00.000Z',publishedAt:'2026-03-02T07:00:00.000Z'})];
 assert.deepEqual(B.runBacktest(evs,bars,A),B.runBacktest([...evs].reverse(),bars,A));
 assert.equal(B.runBacktest(evs,bars,A).summary.filled,2);
});
