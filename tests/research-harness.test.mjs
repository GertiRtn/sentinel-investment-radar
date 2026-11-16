import test from 'node:test';
import assert from 'node:assert/strict';
import {timeSplit,evaluate,finalTest,net,bootstrapByDate} from '../scripts/research/harness.mjs';

// Synthetic fixtures only. A seeded generator: 400 decision dates × 8 symbols; `signal` is known on the date.
function synthetic(effect,seed=7){let a=seed;const rnd=()=>{a=(a*1664525+1013904223)%4294967296;return a/4294967296;},rows=[];
 for(let d=0;d<400;d++){const date=new Date(Date.UTC(2020,0,1)+d*3*86400000).toISOString().slice(0,10),spyFwd=(rnd()-.5)*.06;
  for(let s=0;s<8;s++){const signal=rnd()>.5?1:0;rows.push({date,symbol:'S'+s,features:{signal},spyFwd,fwd:spyFwd+(rnd()-.5)*.10+effect*signal});}}
 return rows;}
const rule=r=>r.features.signal===1,frozen={name:'signal = 1',definedOn:'2026-11-16'};

test('time-ordered split with an embargo: no decision date is in two sets and order is preserved',()=>{
 const s=timeSplit(synthetic(0));const max=xs=>xs.map(r=>r.date).sort().at(-1),min=xs=>xs.map(r=>r.date).sort()[0];
 assert.ok(max(s.train)<min(s.validation)&&max(s.validation)<min(s.test));
 assert.ok((Date.parse(min(s.validation))-Date.parse(max(s.train)))/86400000>=30,'embargo before validation');assert.ok((Date.parse(min(s.test))-Date.parse(max(s.validation)))/86400000>=30);
 assert.ok(s.train.length>s.validation.length&&s.test.length>0);assert.throws(()=>timeSplit(synthetic(0).slice(0,16)));
});
test('costs are charged on both sides; too few observations give no figure',()=>{
 assert.ok(Math.abs(net(0)-(0.9985*0.9985-1))<1e-15);assert.ok(net(0.10)<0.10);
 assert.equal(evaluate(synthetic(0).slice(0,20),()=>true,'x').status,'too_few');
});
test('a signal with a real 3% effect passes the gate on the untouched test set; a signal with no effect does not',()=>{
 const good=finalTest(timeSplit(synthetic(0.03)),rule,frozen);assert.equal(good.gate,'passed',JSON.stringify(good.candidate));assert.ok(good.candidate.averageExcess>0.02&&good.candidate.interval90.lower>0);assert.ok(good.candidate.averageExcess>good.baseline.averageExcess);
 const none=finalTest(timeSplit(synthetic(0)),rule,frozen);assert.equal(none.gate,'not_passed');assert.ok(none.candidate.averageExcess<0.005,'costs alone make a no-effect rule slightly negative');
 assert.throws(()=>finalTest(timeSplit(synthetic(0)),rule,null),/Freeze the rule/);
 assert.deepEqual(finalTest(timeSplit(synthetic(0.03)),rule,frozen),good,'reproducible: seeded bootstrap');
 const ci=bootstrapByDate(synthetic(0).slice(0,400),r=>r.fwd);assert.ok(ci.lower<ci.upper);
});
