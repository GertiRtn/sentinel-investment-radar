import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const b=await esbuild.build({entryPoints:['lib/sentinel/market-model.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {ols,marketModel,fitWords,betaWords,peerComparison,ESTIMATION}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));

// Synthetic weekday sessions (no holidays): fixtures only, not market data.
const sessions=n=>{const out=[];let t=Date.parse('2025-06-02T12:00:00Z');while(out.length<n){const d=new Date(t);if(d.getUTCDay()%6)out.push(d.toISOString().slice(0,10));t+=86400000;}return out;};
const rm=i=>0.01*Math.sin(i*0.7)+0.004*Math.cos(i*1.9); // market daily return
const series=(days,ret)=>{let p=100;return days.map((d,i)=>{if(i>0)p*=1+ret(i);return {t:d+'T12:00:00Z',c:p};});};
const near=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<=tol,`${a} vs ${b}`);
const DAYS=sessions(300),EVENT=DAYS[260]; // published 10:00 New York time on day 260 → last close before = day 259
const pub=EVENT+'T15:00:00Z',fetched='2027-01-01T00:00:00Z';
const run=(stock,spy,over={})=>marketModel({stock:{bars:stock},spy:{bars:spy},symbol:'TST',publishedAt:pub,caseAt:EVENT+'T16:00:00Z',fetchedAt:fetched,source:'fixture',adjustment:'all',rawIds:[],...over});

test('OLS matches a hand-checked example',()=>{
 // x=[1,2,3,4], y=[2,4,5,8]: beta = 9.5/5 = 1.9, alpha = 4.75 − 1.9·2.5 = 0, SSR = 0.70, SST = 18.75, R² = 1 − 0.70/18.75,
 // residual sd = √(0.70/2), SE(beta) = √0.35 / √5.
 const f=ols([1,2,3,4],[2,4,5,8]);near(f.beta,1.9,1e-12);near(f.alpha,0,1e-12);near(f.r2,1-0.7/18.75,1e-12);near(f.betaSe,Math.sqrt(0.35)/Math.sqrt(5),1e-12);assert.equal(f.n,4);
 assert.equal(ols([1,1,1,1],[1,2,3,4]),null,'zero market variance');assert.equal(ols([1,2],[1,2]),null,'too few points');
});

test('a known beta and intercept are recovered from prices, using only days before the event',()=>{
 const spy=series(DAYS,rm),stock=series(DAYS,i=>0.0002+1.5*rm(i));
 const r=run(stock,spy);assert.equal(r.status,'ok',r.reason);const s=r.sensitivity;
 near(s.beta,1.5,1e-9);near(s.alpha,0.0002,1e-9);near(s.r2,1,1e-9);
 assert.equal(s.to,DAYS[259],'the window ends at the last close before publication');assert.equal(s.matchedDays,252);assert.equal(s.from,DAYS[259-252]);assert.equal(s.missingSessions,0);assert.equal(s.knownAtAssessment,true);
 assert.match(s.betaText,/about 1\.5% for each 1% move/);assert.match(s.fitText,/^Most/);
});

test('event move: stock above and below the market-based expectation, exact formulas',()=>{
 const spy=series(DAYS,rm);
 for(const jump of [0.04,-0.03]){
  const stock=series(DAYS,i=>1.5*rm(i)+(i===260?jump:0));const r=run(stock,spy);const h1=r.event.horizons.find(h=>h.sessions===1),h5=r.event.horizons.find(h=>h.sessions===5);
  // Independent check for day 1: S = 1.5·rm + jump; E = 1.5·rm; A = jump.
  near(h1.stockPct,(1.5*rm(260)+jump)*100,1e-9);near(h1.expectedPct,1.5*rm(260)*100,1e-9);near(h1.adjustedPct,jump*100,1e-9);near(h1.marketPct,rm(260)*100,1e-9);
  near(h1.carPct,jump*100,1e-9);near(h1.simpleVsSpyPct,(1.5*rm(260)+jump-rm(260))*100,1e-9);
  let S=1,E=1;for(let i=260;i<265;i++){S*=1+1.5*rm(i)+(i===260?jump:0);E*=1+1.5*rm(i);}near(h5.stockPct,(S-1)*100,1e-9);near(h5.expectedPct,(E-1)*100,1e-9);near(h5.adjustedPct,(S-E)*100,1e-9);
  assert.equal(Math.sign(h1.adjustedPct),Math.sign(jump));
 }
});

test('with-intercept variant is reported separately and differs only by the drift',()=>{
 const spy=series(DAYS,rm),stock=series(DAYS,i=>0.001+1.2*rm(i));const h=run(stock,spy).event.horizons[0];
 near(h.withAlpha.expectedPct,(0.001+1.2*rm(260))*100,1e-6);near(h.withAlpha.adjustedPct,0,1e-6);near(h.adjustedPct,0.1,1e-6);
});

test('no look-ahead: post-event prices never change the sensitivity; later sessions are labelled later',()=>{
 const spy=series(DAYS,rm),a=series(DAYS,i=>1.5*rm(i)),b=series(DAYS,i=>1.5*rm(i)+(i>=260?0.05:0));
 const ra=run(a,spy),rb=run(b,spy);near(ra.sensitivity.beta,rb.sensitivity.beta,1e-12);near(ra.sensitivity.r2,rb.sensitivity.r2,1e-12);
 assert.ok(rb.event.horizons.every(h=>h.laterInformation),'assessed before the first post-event close');
 const late=run(a,spy,{caseAt:DAYS[270]+'T23:00:00Z'});assert.equal(late.event.horizons.find(h=>h.sessions===5).laterInformation,false,'closed before a late assessment');assert.equal(late.event.horizons.find(h=>h.sessions===20).laterInformation,true);
 const cut=run(a,spy,{fetchedAt:DAYS[262]+'T12:00:00Z'});assert.equal(cut.event.sessionsAvailable,2,'sessions not closed when fetched are dropped');assert.deepEqual(cut.event.horizons.map(h=>h.sessions),[1]);
 const after=run(a,spy,{publishedAt:EVENT+'T22:00:00Z'});assert.equal(after.sensitivity.to,EVENT,'published after the close: that day is before the event');
});

test('unavailable states: too little data, sparse prices, stale prices, zero variance, incompatible adjustment, no time',()=>{
 const spy=series(DAYS,rm),stock=series(DAYS,i=>1.5*rm(i));
 const short=run(stock.slice(200),spy);assert.equal(short.status,'unavailable');assert.match(short.reason,/at least 120/);assert.equal(short.sensitivity,null);
 const sparse=run(stock.filter((_,i)=>i%8!==3),spy);assert.equal(sparse.status,'unavailable');assert.match(sparse.reason,/% of market sessions/);
 const stale=run(stock.slice(0,254),spy);assert.equal(stale.status,'unavailable');assert.match(stale.reason,/sessions older/);
 const flat=run(stock,DAYS.map(d=>({t:d+'T12:00:00Z',c:400})));assert.equal(flat.status,'unavailable');assert.match(flat.reason,/no variation/);
 assert.equal(run(stock,spy,{adjustment:'raw'}).status,'unavailable');assert.equal(run(stock,spy,{publishedAt:null}).status,'unavailable');
 const bad=run(stock.map((x,i)=>i===100?{...x,c:-5}:x),spy);assert.equal(bad.status,'ok','an invalid bar is dropped, not used');assert.equal(bad.sensitivity.missingSessions,1);
 for(const u of [short,sparse,stale,flat])assert.ok(u.needed&&u.needed.length<160,'one short sentence on what is needed');
});

test('a few missing stock days: returns span the same dates for stock and SPY',()=>{
 const spy=series(DAYS,rm),full=series(DAYS,i=>1.5*rm(i)),gappy=full.filter((_,i)=>i!==120&&i!==180);
 const r=run(gappy,spy);assert.equal(r.status,'ok');near(r.sensitivity.beta,1.5,0.02);assert.equal(r.sensitivity.missingSessions,2);
});

test('wording follows the fit; peers are unavailable with what is needed; nothing claims a forecast',()=>{
 assert.match(fitWords(0.62),/^Most/);assert.match(fitWords(0.3),/^Some/);assert.match(fitWords(0.05),/^Little/);assert.match(betaWords(-0.4),/opposite way/);
 const p=peerComparison();assert.equal(p.status,'unavailable');assert.match(p.needed,/as it stood on the event date/);
 const r=run(series(DAYS,i=>1.5*rm(i)),series(DAYS,rm));const text=JSON.stringify(r);
 assert.ok(!/\b(buy|sell|probabilit|forecast(?!\.)|expected return|target)/i.test(text.replace(/not a forecast/gi,'')),'no advice or forecast wording');
 assert.match(r.basis,/Gross, before any trading costs/);assert.equal(ESTIMATION.maxDays,252);
});
