import test from 'node:test';
import assert from 'node:assert/strict';
import {timeSplit,evaluate,finalTest,net,validateRows,HARNESS_VERSION} from '../scripts/research/harness.mjs';
import {median,afterCosts,excessAfterCosts,blockBootstrapMean,overlapBlockLength,validDay} from '../lib/sentinel/research-stats.ts';

// ALL DATA IN THIS FILE IS SYNTHETIC. Seeded generators; nothing here is market data or a performance claim.
const day=i=>new Date(Date.UTC(2020,0,1)+i*86400000).toISOString().slice(0,10);
// 400 decision dates three days apart × 8 symbols; each outcome window is 28 calendar days; `signal` is known on the date.
function synthetic(effect,seed=7,windowDays=28){let a=seed;const rnd=()=>{a=(a*1664525+1013904223)%4294967296;return a/4294967296;},rows=[];
 for(let d=0;d<400;d++){const date=day(d*3),exitDate=day(d*3+windowDays),spyFwd=(rnd()-.5)*.06;
  for(let s=0;s<8;s++){const signal=rnd()>.5?1:0;rows.push({date,exitDate,symbol:'S'+s,features:{signal},spyFwd,fwd:spyFwd+(rnd()-.5)*.10+effect*signal});}}
 return rows;}
const rule=r=>r.features.signal===1,frozen={name:'signal = 1',definedOn:'2026-11-16'};

test('defect 1 (synthetic): no outcome window crosses into a later set, whatever its length; purged rows are counted',()=>{
 for(const windowDays of [28,84,170]){
  const s=timeSplit(synthetic(0,7,windowDays));
  assert.ok(s.train.every(r=>r.exitDate<s.boundaries.validationFrom),`train windows end before validation (${windowDays} days)`);
  assert.ok(s.validation.every(r=>r.exitDate<s.boundaries.testFrom),`validation windows end before test (${windowDays} days)`);
  assert.ok(s.purged.train>0&&s.purged.validation>0,'rows near a boundary are purged, not kept');
 }
 // The case harness-v1 got wrong: 60-session (84-day) windows with a 30-day calendar gap.
 const long=timeSplit(synthetic(0,7,84));assert.ok(long.purged.train>=8*28,'about 28 decision dates × 8 symbols are purged before validation');
 // An embargo adds a margin on top of the purge.
 const emb=timeSplit(synthetic(0,7,28),{embargoDays:10});assert.ok(emb.train.every(r=>Date.parse(r.exitDate)<Date.parse(emb.boundaries.validationFrom)-10*86400000+86400000));
 const max=xs=>xs.map(r=>r.date).sort().at(-1),min=xs=>xs.map(r=>r.date).sort()[0];const s=timeSplit(synthetic(0));
 assert.ok(max(s.train)<min(s.validation)&&max(s.validation)<min(s.test),'order preserved');assert.throws(()=>timeSplit(synthetic(0).slice(0,16)));
});

test('defect 2 (synthetic): stock and SPY pay the same costs, so matching SPY shows zero excess',()=>{
 assert.ok(Math.abs(net(0)-(0.9985*0.9985-1))<1e-15);assert.ok(afterCosts(0.10)<0.10);
 for(const r of [-0.2,0,0.05,0.3])assert.equal(excessAfterCosts(r,r),0,`equal returns ${r}`);
 const flat=Array.from({length:40},(_,i)=>({date:day(i),exitDate:day(i+28),symbol:'X'+i,fwd:0.05,spyFwd:0.05}));
 const e=evaluate(flat,()=>true,'same as SPY');assert.equal(e.averageExcess,0,'harness-v1 showed -0.31% here');assert.match(e.costBasis,/Stock and SPY each pay 15 bp on entry and 15 bp on exit/);
 // Costs still matter when returns differ: +10% vs SPY flat is less than 10 points after costs.
 const x=excessAfterCosts(0.10,0);assert.ok(x<0.10&&x>0.099);
});

test('defect 3 (synthetic): invalid rows are rejected with a reason and never reach a figure',()=>{
 const good=Array.from({length:40},(_,i)=>({date:day(i),exitDate:day(i+28),symbol:'G'+i,fwd:0.02,spyFwd:0.01}));
 const bad=[{date:day(50),exitDate:day(78),symbol:'N',fwd:NaN,spyFwd:0.01},{date:day(51),exitDate:day(79),symbol:'U',fwd:0.02,spyFwd:undefined},{date:day(52),exitDate:day(80),symbol:'L',fwd:-1.7,spyFwd:0},
  {date:day(53),exitDate:day(81),symbol:'W',fwd:-1,spyFwd:0},{date:day(54),exitDate:day(82),symbol:'I',fwd:Infinity,spyFwd:0},{date:'2020-02-30',exitDate:day(90),symbol:'D',fwd:0,spyFwd:0},
  {date:day(55),exitDate:day(55),symbol:'E',fwd:0,spyFwd:0},{date:day(56),symbol:'M',fwd:0,spyFwd:0},null];
 const v=validateRows([...good,...bad]);assert.equal(v.valid.length,40);assert.equal(v.rejected.length,9);
 assert.deepEqual(v.rejected.map(x=>x.reason),['stock return missing, not finite, or -100% or worse','SPY return missing, not finite, or -100% or worse','stock return missing, not finite, or -100% or worse','stock return missing, not finite, or -100% or worse','stock return missing, not finite, or -100% or worse','decision date missing or invalid','exit date is not after the decision date','exit date missing or invalid','not an observation']);
 const e=evaluate([...good,...bad],()=>true,'with invalid rows');assert.equal(e.status,'computed');assert.equal(e.n,40);assert.equal(e.rejected,9);assert.ok(Number.isFinite(e.averageExcess)&&Number.isFinite(e.medianExcess));
 assert.equal(validDay('2020-02-30'),false);assert.equal(validDay('2020-02-29'),true);
 // Rejected rows cannot lift a set over the minimum.
 assert.equal(evaluate([...good.slice(0,25),...bad],()=>true,'x').status,'too_few');
});

test('defect 4 (synthetic): the median of an even count is the average of the two middle values',()=>{
 assert.equal(median([1,2,3,4]),2.5);assert.equal(median([3,1,2]),2);assert.ok(Number.isNaN(median([])));
 const rows=Array.from({length:30},(_,i)=>({date:day(i),exitDate:day(i+28),symbol:'M'+i,fwd:i<15?0:0.1,spyFwd:0}));
 const e=evaluate(rows,()=>true,'median');assert.ok(Math.abs(e.medianExcess-(excessAfterCosts(0,0)+excessAfterCosts(0.1,0))/2)<1e-15,'about 4.97%, not 9.67%');
});

test('block bootstrap (synthetic): wider than a date-level bootstrap when nearby dates move together; deterministic',()=>{
 // Strongly persistent series: values change only every 10 dates, as overlapping 10-date windows would.
 const groups=Array.from({length:200},(_,i)=>({date:day(i),values:[Math.floor(i/10)%2?0.04:-0.04]}));
 const iid=blockBootstrapMean(groups,{blockLength:1}),blk=blockBootstrapMean(groups,{blockLength:10});
 assert.ok(blk.upper-blk.lower>(iid.upper-iid.lower)*1.5,`block ${blk.upper-blk.lower} vs date-level ${iid.upper-iid.lower}`);
 assert.deepEqual(blockBootstrapMean(groups,{blockLength:10}),blk,'same data, same interval');
 assert.equal(overlapBlockLength(Array.from({length:50},(_,i)=>({date:day(i),exitDate:day(i+9)}))),10,'window spans 10 decision dates');
 assert.equal(overlapBlockLength([{date:day(0),exitDate:day(1)}]),1);
 assert.equal(blockBootstrapMean([],{}).lower,NaN);
 const e=evaluate(synthetic(0),()=>true,'all');assert.ok(e.interval90.blockLength>=9&&e.interval90.blockLength<=11,'28-day windows, decisions every 3 days: about 10 dates per window');
});

test('the gate (synthetic): a planted 3% effect passes on the untouched test set; no effect does not; reproducible',()=>{
 const good=finalTest(timeSplit(synthetic(0.03)),rule,frozen);assert.equal(good.gate,'passed',JSON.stringify(good.candidate));assert.equal(good.version,HARNESS_VERSION);
 assert.ok(good.candidate.averageExcess>0.02&&good.candidate.interval90.lower>0);assert.ok(good.candidate.averageExcess>good.baseline.averageExcess);
 const none=finalTest(timeSplit(synthetic(0)),rule,frozen);assert.equal(none.gate,'not_passed');assert.ok(Math.abs(none.candidate.averageExcess)<0.01);
 assert.throws(()=>finalTest(timeSplit(synthetic(0)),rule,null),/Freeze the rule/);
 assert.deepEqual(finalTest(timeSplit(synthetic(0.03)),rule,frozen),good,'reproducible: seeded bootstrap');
});
