import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const b=await esbuild.build({entryPoints:['lib/sentinel/practice.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const P=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));

const NOW='2026-11-12T18:00:00.000Z',dAgo=d=>new Date(Date.parse(NOW)-d*86400000).toISOString();
const px=(c,at=NOW)=>({priceCents:c,at,rawEventId:'raw-'+c,source:'IEX midpoint'});
const open=(o)=>({version:'practice-v2',action:'open',sequence:o.seq,positionId:o.id,symbol:o.symbol,amountCents:o.amount,quantityMicros:Math.floor(o.amount*1e6/o.entry),price:px(o.entry,o.at),spy:px(o.spy,o.at),thesis:'Margins expand after the merger.',exitPlan:'+15%',killCondition:'Guidance cut',conviction:o.conviction??60,caseId:null,evidenceScore:o.score??null,createdAt:o.at});
const close=(o)=>({version:'practice-v2',action:'close',sequence:o.seq,positionId:o.id,symbol:o.symbol,price:px(o.exit,o.at),spy:px(o.spy,o.at),reason:'Hit target',createdAt:o.at});
const live=(m)=>Object.fromEntries(Object.entries(m).map(([k,v])=>[k,v===null?null:{...px(v),stale:false}]));

test('starts with $10,000 and marks open positions at live prices against SPY',()=>{
 const s=P.practiceState({trades:[open({seq:1,id:'a',symbol:'MSFT',amount:200000,entry:40000,spy:50000,at:dAgo(10)})],reviews:[],marks:[],live:live({MSFT:44000,SPY:51000}),now:NOW});
 assert.equal(s.startCents,1000000);assert.equal(s.cashCents,800000);
 const p=s.open[0];assert.equal(p.valueCents,220000);assert.equal(p.returnPct,10);assert.equal(Math.round(p.spyReturnPct*100)/100,2);assert.equal(Math.round(p.vsSpyPct*100)/100,8);
 assert.equal(s.equityCents,1020000);assert.equal(s.benchmarkCents,1004000);assert.equal(s.returnPct,2);
 assert.equal(p.reviewDue.days,7,'1-week review is due after 10 days');
});

test('a missing live price makes value unknown, never a guess, and blocks the daily mark',()=>{
 const s=P.practiceState({trades:[open({seq:1,id:'a',symbol:'MSFT',amount:100000,entry:40000,spy:50000,at:dAgo(1)})],reviews:[],marks:[],live:live({MSFT:null,SPY:51000}),now:NOW});
 assert.equal(s.open[0].valueCents,null);assert.equal(s.open[0].returnPct,null);assert.equal(s.equityCents,null);assert.equal(s.returnPct,null);
 assert.equal(P.dailyMark(s,NOW),null);
});

test('closing realises the gain at the recorded close price; cash returns',()=>{
 const s=P.practiceState({trades:[open({seq:1,id:'a',symbol:'MSFT',amount:100000,entry:40000,spy:50000,at:dAgo(40)}),close({seq:2,id:'a',symbol:'MSFT',exit:36000,spy:55000,at:dAgo(5)})],reviews:[],marks:[],live:{},now:NOW});
 assert.equal(s.open.length,0);assert.equal(s.closed[0].returnPct,-10);assert.equal(s.closed[0].vsSpyPct,-20);
 assert.equal(s.cashCents,990000);assert.equal(s.equityCents,990000);assert.equal(s.closed[0].reviewDue,null);
});

test('reviews: the latest unrecorded milestone is due; a recorded one is not asked again',()=>{
 const t=[open({seq:1,id:'a',symbol:'MSFT',amount:100000,entry:40000,spy:50000,at:dAgo(35)})];
 const s1=P.practiceState({trades:t,reviews:[],marks:[],live:live({MSFT:40000,SPY:50000}),now:NOW});assert.equal(s1.open[0].reviewDue.days,30);
 const s2=P.practiceState({trades:t,reviews:[{positionId:'a',milestone:30,decision:'keep',note:'ok',createdAt:NOW}],marks:[],live:live({MSFT:40000,SPY:50000}),now:NOW});assert.equal(s2.open[0].reviewDue.days,7,'an earlier skipped milestone is still asked');
});

test('scorecard groups by evidence band and conviction, median only from 5 trades',()=>{
 const trades=[];for(let i=0;i<5;i++){trades.push(open({seq:i*2+1,id:'h'+i,symbol:'H'+i,amount:10000,entry:100,spy:100,score:80,conviction:80,at:dAgo(50)}));trades.push(close({seq:i*2+2,id:'h'+i,symbol:'H'+i,exit:100+i*5,spy:100,at:dAgo(1)}));}
 trades.push(open({seq:11,id:'w',symbol:'W',amount:10000,entry:100,spy:100,score:30,conviction:20,at:dAgo(3)}));
 const s=P.practiceState({trades,reviews:[],marks:[],live:live({W:90,SPY:100}),now:NOW});
 const strong=s.scorecard.byEvidence.find(b=>b.band==='Strong evidence'),weak=s.scorecard.byEvidence.find(b=>b.band==='Weak evidence');
 assert.equal(strong.trades,5);assert.equal(strong.medianVsSpyPct,10);assert.equal(strong.beatSpy,4);
 assert.equal(weak.trades,1);assert.equal(weak.medianVsSpyPct,null);assert.equal(weak.enough,false);
 assert.ok(s.scorecard.byConviction.some(b=>b.band==='High (70–100)'&&b.trades===5));
});

test('prices come only from sane recorded quotes',()=>{
 assert.deepEqual(P.priceFromQuote({bid:99.9,ask:100.1,sourceTime:dAgo(0.01),rawEventId:'r'},NOW),{priceCents:10000,at:dAgo(0.01),rawEventId:'r',source:'IEX midpoint'});
 assert.match(P.priceFromQuote({bid:90,ask:110,sourceTime:NOW,rawEventId:'r'},NOW),/wider than 2%/);
 assert.match(P.priceFromQuote({bid:99,ask:100,sourceTime:dAgo(6),rawEventId:'r'},NOW),/too old/);
 assert.match(P.priceFromQuote({bid:99,ask:100,sourceTime:NOW},NOW),/No usable/);
});

test('opening permits empty notes and validates cash and conviction',()=>{
 const ok={amountCents:100000,conviction:70,thesis:'Margins expand after the merger.',exitPlan:'+15%',killCondition:'Guidance cut'};
 assert.equal(P.validateOpen(ok,1000000),null);
 assert.match(P.validateOpen({...ok,amountCents:2000000},1000000),/Not enough/);
 assert.match(P.validateOpen({...ok,conviction:101},1000000),/0 to 100/);
 assert.equal(P.validateOpen({...ok,thesis:'',exitPlan:'',killCondition:''},1000000),null);
});
