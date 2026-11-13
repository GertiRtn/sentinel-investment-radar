import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const b=await esbuild.build({entryPoints:['lib/sentinel/auto-practice.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {planAuto,autoState,currentExperiment,AUTO_POLICY,AUTO_VERSION,MIN_CLOSED_FOR_RECORD}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const now='2026-11-13T15:00:00.000Z',startedAt='2026-11-13T09:00:00.000Z';
const q=(dollars,at=now,spreadPct=0.1)=>({priceCents:Math.round(dollars*100),at,rawEventId:'raw-'+dollars,source:'IEX midpoint',spreadPct});
const c=(id,symbol,over={})=>({caseId:id,symbol,status:'complete',assessedAt:'2026-11-13T11:00:00.000Z',publishedAt:'2026-11-13T10:00:00.000Z',firstObservedAt:'2026-11-13T10:30:00.000Z',screenVersion:'research-screen-v2',conclusion:'INVESTIGATE',securityStatus:'candidate_common',securityVersion:'security-identity-v2',matchLevel:'named_in_headline',score:85,headline:symbol+' reports results',...over});
const input=(over={})=>({now,startedAt,active:true,cashCents:1_000_000,open:[],decidedCaseIds:[],candidates:[c('a','AAA'),c('b','BBB'),c('c','CCC')],prices:{AAA:q(100),BBB:q(50),CCC:q(25),SPY:q(500)},...over});

test('opens at most two per check, oldest assessment first, with explicit cost and a SPY leg that pays the same cost',()=>{
 const p=planAuto(input());assert.deepEqual(p,planAuto(input()),'deterministic');
 assert.deepEqual(p.opens.map(o=>o.symbol),['AAA','BBB']);assert.equal(p.skips.length,0);assert.deepEqual(p.waiting.map(w=>w.symbol),['CCC']);assert.match(p.waiting[0].reason,/Limit of 2 new positions/);
 const o=p.opens[0];assert.equal(o.amountCents,100000);assert.equal(o.costCents,150,'15 bp of $1,000');assert.equal(o.quantityMicros,Math.floor(99850*1e6/10000));assert.equal(o.spyQuantityMicros,Math.floor(99850*1e6/50000));assert.equal(o.price.rawEventId,'raw-100');assert.equal(o.case.score,85);
 assert.equal(p.version,AUTO_VERSION);assert.ok(!/forecast|probab|expected return/i.test(JSON.stringify(p)));
});
test('gates: screen, security version, event match, held symbol and bad clocks are final skips with reasons; non-qualifying cases are only counted',()=>{
 const p=planAuto(input({open:[{positionId:'p0',symbol:'HLD',openedAt:'2026-11-13T12:00:00.000Z',quantityMicros:1e6,spyQuantityMicros:1e6}],candidates:[
  c('w','WWW',{conclusion:'WAIT'}),c('m','MMM',{conclusion:'MONITOR'}),c('v1','VVV',{screenVersion:'research-screen-v1'}),
  c('s','SSS',{securityVersion:'security-identity-v1'}),c('u','UUU',{securityStatus:'unverified'}),c('t','AMS',{matchLevel:'name_conflict'}),c('o','OOO',{matchLevel:'ticker_only'}),c('n','NNN',{matchLevel:'named_in_summary'}),
  c('h','HLD'),c('k','KKK',{firstObservedAt:'2026-11-13T12:00:00.000Z'}),c('x','XXX',{publishedAt:null}),c('z','bad symbol')]}));
 assert.equal(p.opens.length,0);assert.equal(p.counts.notMeetingRules,3);
 assert.deepEqual(Object.fromEntries(p.skips.map(s=>[s.caseId,s.code])),{s:'security_unverified',u:'security_unverified',t:'event_match_unconfirmed',o:'event_match_unconfirmed',n:'event_match_unconfirmed',h:'already_held',k:'invalid_timing',x:'invalid_timing',z:'invalid_symbol'});
 assert.ok(p.skips.every(s=>s.reason.length>10&&s.case.headline));
});
test('prospective only: cases assessed before the start or in the future are never acted on or recorded',()=>{
 const p=planAuto(input({candidates:[c('old','OLD',{assessedAt:'2026-11-13T08:59:00.000Z',publishedAt:'2026-11-13T08:00:00.000Z',firstObservedAt:'2026-11-13T08:30:00.000Z'}),c('eq','EQQ',{assessedAt:startedAt}),c('fut','FUT',{assessedAt:'2026-11-13T16:00:00.000Z'})],prices:{OLD:q(10),EQQ:q(10),FUT:q(10),SPY:q(500)}}));
 assert.equal(p.opens.length+p.skips.length+p.waiting.length,0);assert.equal(p.counts.beforeStart,2);
});
test('prices fail closed: missing, stale, wide or future quotes (stock or SPY) never fill; the case waits, then expires with the reason',()=>{
 for(const prices of [{SPY:q(500)},{AAA:q(100,'2026-11-13T14:40:00.000Z'),SPY:q(500)},{AAA:q(100,now,1.5),SPY:q(500)},{AAA:q(100,'2026-11-13T15:00:01.000Z'),SPY:q(500)},{AAA:q(100)},{AAA:q(100),SPY:q(500,'2026-11-12T21:00:00.000Z')},{AAA:{...q(100),rawEventId:''},SPY:q(500)},{AAA:{...q(100),priceCents:0},SPY:q(500)}]){
  const p=planAuto(input({candidates:[c('a','AAA')],prices}));assert.equal(p.opens.length,0);assert.equal(p.skips.length,0);assert.match(p.waiting[0].reason,/No fresh, narrow IEX quote/);assert.deepEqual(p.needsQuote.sort(),['AAA','SPY']);}
 const late=planAuto(input({now:'2026-11-17T11:00:01.000Z',candidates:[c('a','AAA')],prices:{}}));
 assert.equal(late.skips[0].code,'expired');assert.match(late.skips[0].reason,/Not opened within 96 hours.*No fresh/);assert.equal(late.waiting.length,0);
 assert.equal(planAuto(input({now:'2026-11-17T10:59:00.000Z',candidates:[c('a','AAA')],prices:{}})).waiting.length,1,'still inside the window');
});
test('limits: slots, cash, decided cases and a stopped experiment',()=>{
 const five=Array.from({length:5},(_,i)=>({positionId:'p'+i,symbol:'H'+i,openedAt:'2026-11-13T12:00:00.000Z',quantityMicros:1e6,spyQuantityMicros:1e6}));
 assert.match(planAuto(input({open:five})).waiting[0].reason,/All 5 position slots/);
 const poor=planAuto(input({cashCents:150000}));assert.equal(poor.opens.length,1);assert.match(poor.waiting[0].reason,/Not enough virtual cash/);
 assert.equal(planAuto(input({decidedCaseIds:['a','b','c']})).opens.length,0);
 const stopped=planAuto(input({active:false}));assert.equal(stopped.opens.length,0);assert.match(stopped.waiting[0].reason,/stopped/);assert.deepEqual(stopped.needsQuote,[]);
 assert.throws(()=>planAuto(input({cashCents:-1})));assert.throws(()=>planAuto(input({now:'nope'})));
});
test('time exit: closes only after 30 days and only with fresh paired quotes; freed cash and slots are not reused in the same pass',()=>{
 const five=Array.from({length:5},(_,i)=>({positionId:'p'+i,symbol:'H'+i,openedAt:i===0?'2026-10-14T14:59:00.000Z':i===1?'2026-10-14T15:00:01.000Z':'2026-10-01T15:00:00.000Z',quantityMicros:9_985_000,spyQuantityMicros:1_997_000}));
 const p=planAuto(input({open:five,prices:{H0:q(110),AAA:q(100),SPY:q(520)}}));
 assert.deepEqual(p.closes.map(x=>x.positionId),['p0']);const cl=p.closes[0];assert.equal(cl.grossCents,109835);assert.equal(cl.costCents,165);assert.equal(cl.proceedsCents,109670);assert.equal(cl.spyProceedsCents,103844-156);assert.equal(cl.code,'time_exit');
 assert.equal(p.waiting.filter(w=>w.positionId).length,3,'due positions without quotes wait');assert.ok(!p.waiting.some(w=>w.positionId==='p1'),'29.99 days is not due');
 assert.equal(p.opens.length,0,'no slot is reused before the close is confirmed');
 assert.equal(planAuto(input({active:false,open:five,candidates:[],prices:{H0:q(110),SPY:q(520)}})).closes.length,1,'a stopped experiment still closes on schedule');
});

const rec=(d,at,extra={})=>({...d,version:AUTO_VERSION,experimentId:'exp',at,...extra});
test('ledger fold: cash, costs, net value and a same-cost SPY benchmark; unknown price means unknown value, never a guess',()=>{
 const plan=planAuto(input());const decisions=plan.opens.map((o,i)=>rec(o,'2026-11-13T15:00:00.000Z',{positionId:'pos'+i}));
 const flat=autoState({experimentId:'exp',decisions,closes:[],live:{AAA:q(100),BBB:q(50),SPY:q(500)},now:'2026-11-14T15:00:00.000Z'});
 assert.equal(flat.cashCents,800000);assert.equal(flat.costsCents,300);assert.equal(flat.open.length,2);
 assert.equal(flat.open[0].valueCents,99850-150,'entry cost and the exit cost you would pay today');assert.equal(flat.open[0].returnPct.toFixed(2),'-0.30');assert.equal(flat.open[0].vsSpyPct,0,'flat stock and flat SPY tie after equal costs');
 assert.equal(flat.equityCents,800000+2*99700);assert.equal(flat.benchmarkCents,flat.equityCents);
 const unknown=autoState({experimentId:'exp',decisions,closes:[],live:{AAA:q(100),SPY:q(500)},now});assert.equal(unknown.equityCents,null);assert.equal(unknown.returnPct,null);assert.equal(unknown.open[1].valueCents,null);
 const noSpy=autoState({experimentId:'exp',decisions,closes:[],live:{AAA:q(100),BBB:q(50)},now});assert.equal(noSpy.benchmarkCents,null);assert.notEqual(noSpy.equityCents,null);
 const close={positionId:'pos0',symbol:'AAA',code:'time_exit',reason:'30-day holding period completed.',price:q(110),spy:q(520),grossCents:109835,costCents:165,proceedsCents:109670,spyProceedsCents:103688};
 const after=autoState({experimentId:'exp',decisions,closes:[rec(close,'2026-12-13T15:00:00.000Z')],live:{BBB:q(50),SPY:q(500)},now:'2026-12-13T16:00:00.000Z'});
 assert.equal(after.cashCents,800000+109670);assert.equal(after.costsCents,300+165);assert.equal(after.closed.length,1);assert.equal(after.closed[0].returnPct.toFixed(2),'9.67');assert.equal(after.closed[0].spyReturnPct.toFixed(2),'3.69');assert.equal(after.closed[0].ageDays,30);
 assert.equal(after.record.closedTrades,1);assert.equal(after.record.beatSpy,1);assert.equal(after.record.enough,false);assert.match(after.record.note,new RegExp('Too few closed trades.*1 of at least '+MIN_CLOSED_FOR_RECORD));
 assert.equal(autoState({experimentId:'other',decisions,closes:[],live:{},now}).cashCents,AUTO_POLICY.startingCashCents,'experiments do not share a ledger');
});
test('experiment control: latest start wins, stop is per experiment, policy is frozen with the start',()=>{
 assert.equal(currentExperiment([]),null);
 const a={version:AUTO_VERSION,action:'start',experimentId:'e1',at:'2026-11-13T09:00:00.000Z',policy:AUTO_POLICY};
 assert.equal(currentExperiment([a]).active,true);
 const stopped=currentExperiment([a,{version:AUTO_VERSION,action:'stop',experimentId:'e1',at:'2026-11-14T09:00:00.000Z'}]);assert.equal(stopped.active,false);assert.equal(stopped.stoppedAt,'2026-11-14T09:00:00.000Z');
 const second=currentExperiment([a,{version:AUTO_VERSION,action:'stop',experimentId:'e1',at:'2026-11-14T09:00:00.000Z'},{...a,experimentId:'e2',at:'2026-11-15T09:00:00.000Z'}]);assert.equal(second.experimentId,'e2');assert.equal(second.active,true);assert.equal(second.earlier,1);
 assert.equal(Object.isFrozen(AUTO_POLICY),true);
});
