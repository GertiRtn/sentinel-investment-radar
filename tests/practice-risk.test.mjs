import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const b=await esbuild.build({entryPoints:['lib/sentinel/practice-risk.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const R=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));

const dates=Array.from({length:260},(_,i)=>new Date(Date.UTC(2025,0,1)+i*86400000).toISOString().slice(0,10));
const series=(f)=>new Map(dates.map((d,i)=>[d,f(i)]));
const cfg={...R.RISK_DEFAULTS,paths:2000};

test('seeded and reproducible; a different seed gives a different sample',()=>{
 const closes={A:series(i=>100*(1+0.01*Math.sin(i))),B:series(i=>50*(1+0.02*Math.cos(i/3)))};
 const h=[{symbol:'A',valueCents:300000},{symbol:'B',valueCents:200000}];
 const x=R.riskReport(h,500000,closes,cfg),y=R.riskReport(h,500000,closes,cfg),z=R.riskReport(h,500000,closes,{...cfg,seed:7});
 assert.deepEqual(x,y);assert.notEqual(x.simulation.varUsd,z.simulation.varUsd);
 const a=R.rng(1),c=R.rng(1);assert.equal(a(),c());
});

test('calculation: a constant daily return gives every path the same exact outcome',()=>{
 const closes={A:series(i=>100*1.01**i)};
 const s=R.simulate([{symbol:'A',valueCents:100000}],0,closes,cfg);
 const expected=1000*(1.01**20-1);
 assert.ok(Math.abs(s.percentilesUsd['0.01']-expected)<1e-6&&Math.abs(s.percentilesUsd['0.99']-expected)<1e-6);
 assert.ok(Math.abs(s.varUsd+expected)<1e-6,'VaR is the loss at the 5% tail; here every path gains, so it is negative');
 assert.ok(Math.abs(s.esUsd+expected)<1e-6);
 assert.ok(s.portfolioAnnualisedVolPct<1e-6);
});

test('VaR and expected shortfall: ES is at least VaR; cash dilutes the percentage',()=>{
 const closes={A:series(i=>100*(i%2?0.97:1.03)**1*(1+i*0.0001))};
 const s=R.simulate([{symbol:'A',valueCents:100000}],0,closes,cfg),cash=R.simulate([{symbol:'A',valueCents:100000}],100000,closes,cfg);
 assert.ok(s.esUsd>=s.varUsd);assert.ok(s.varUsd>0);
 assert.ok(Math.abs(cash.varUsd-s.varUsd)<1e-9,'cash does not change the dollar loss');assert.ok(Math.abs(cash.varPct-s.varPct/2)<1e-9);
});

test('correlation is measured from the shared history',()=>{
 const up=series(i=>100+10*Math.sin(i/5)+i*0.01);
 const s=R.simulate([{symbol:'A',valueCents:100000},{symbol:'B',valueCents:100000}],0,{A:up,B:new Map([...up].map(([d,c])=>[d,c*2]))},cfg);
 assert.ok(Math.abs(s.correlation.matrix[0][1]-1)<1e-9);
});

test('concentration: weights, effective positions and flags',()=>{
 const c=R.concentration([{symbol:'A',valueCents:600000},{symbol:'B',valueCents:200000}],200000);
 assert.equal(c.largest.symbol,'A');assert.ok(Math.abs(c.largest.weight-0.6)<1e-12);assert.ok(Math.abs(c.effectivePositions-1/(0.36+0.04))<1e-9);
 assert.equal(c.flags.length,1);assert.match(c.flags[0],/A is 60\.0%/);
});

test('missing or insufficient data is unavailable, never filled',()=>{
 const short={A:new Map(dates.slice(0,50).map((d,i)=>[d,100+i]))};
 const r=R.riskReport([{symbol:'A',valueCents:100000}],0,short,cfg);
 assert.equal(r.simulation.status,'unavailable');assert.match(r.simulation.reason,/Not enough price history for A/);assert.deepEqual(r.stresses,[]);
 assert.equal(R.riskReport([{symbol:'A',valueCents:null}],0,{A:series(()=>1)},cfg).simulation.status,'unavailable','an unpriced position blocks weights');
 assert.equal(R.riskReport([{symbol:'A',valueCents:100000}],0,{},cfg).simulation.status,'unavailable','no history at all');
 assert.match(R.riskReport([],1000000,{},cfg).simulation.reason,/No open Practice positions/);
 const gap={A:series(i=>100+i),B:new Map(dates.filter((_,i)=>i%3===0).map(d=>[d,50]))};
 assert.equal(R.riskReport([{symbol:'A',valueCents:1},{symbol:'B',valueCents:1}],0,gap,cfg).simulation.status,'unavailable','only shared trading days count');
});

test('extreme inputs stay finite and bounded',()=>{
 const crash={A:series(i=>i===100?0.5:(i>100?0.5:100))};
 const s=R.simulate([{symbol:'A',valueCents:1e12}],0,crash,cfg);
 for(const v of [s.varUsd,s.esUsd,...Object.values(s.percentilesUsd)])assert.ok(Number.isFinite(v));
 assert.ok(s.esUsd<=1e10+1e-6,'a long-only position cannot lose more than its value');
 const st=R.stresses([{symbol:'A',valueCents:100000}],0,crash,cfg);
 const worst=st.find(x=>/Worst/.test(x.name));assert.ok(Math.abs(worst.lossUsd-1000*0.995)<1e-6);assert.equal(st[0].lossUsd,100);
});
