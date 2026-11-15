import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const b=await esbuild.build({entryPoints:['lib/sentinel/investment-case.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {assessInvestmentCase,mechanismState,observe,combine,isFinancial}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));

// Synthetic fixtures only (fictional company "Acme Robotics"). Not market data.
const F=(metric,end,value)=>({metric,value,period_end:end,inputs:[{form:end.endsWith('12-31')?'10-K':'10-Q',filed:end,accession:'0000000101-26-000001'}]});
const sessions=n=>{const o=[];let t=Date.parse('2025-03-03T12:00:00Z');while(o.length<n){const d=new Date(t);if(d.getUTCDay()%6)o.push(d.toISOString().slice(0,10));t+=86400000;}return o;};
const DAYS=sessions(180),bars=f=>DAYS.map((d,i)=>({date:d,close:f(i)}));
const annual=(o={})=>{const v={rev:[900,1000,1100],ni:100,ocf:120,op:[100,115],debt:200,cash:50,eps:2,shares:50e6,...o};const out=[];
 ['2023-12-31','2024-12-31','2025-12-31'].forEach((e,k)=>v.rev[k]!==null&&v.rev[k]!==undefined&&out.push(F('revenue',e,v.rev[k])));
 if(v.op){out.push(F('operating_income','2024-12-31',v.op[0]));out.push(F('operating_income','2025-12-31',v.op[1]));}
 for(const [m,x] of [['net_income',v.ni],['cfo',v.ocf],['debt_combined',v.debt],['cash',v.cash],['eps_diluted',v.eps],['shares_diluted',v.shares]])if(x!==null&&x!==undefined)out.push(F(m,'2025-12-31',x));return out;};
const quarterly=(pairs)=>pairs.flatMap(([end,rev,op])=>[F('revenue',end,rev),...(op!==undefined?[F('operating_income',end,op)]:[])]);
const Q_OK=[['2024-06-30',240,24],['2024-09-30',250,25],['2025-06-30',260,27],['2025-09-30',280,29]];
const kase=(o={})=>({id:'discovery-case:acme',symbol:'ACME',createdAt:'2026-03-01T15:00:00.000Z',identity:{cik:'0000000101',name:'Acme Robotics Inc'},
 event:{headline:'Acme Robotics Reports Third Quarter Results',publishedAt:'2026-03-01T13:00:00.000Z',analysis:{topics:['Earnings or financial results']}},price:{status:'indicative',ratio:20},...o});
const run=(o={})=>assessInvestmentCase({kase:kase(o.kase),sic:o.sic??'3569',annual:o.annual??annual(),quarterly:o.quarterly??quarterly(Q_OK),filings:o.filings===undefined?[]:o.filings,
 stock:o.stock===undefined?bars(i=>100+i*0.05):o.stock,spy:o.spy===undefined?bars(()=>400):o.spy,verification:o.verification??null,computedAt:'2026-03-02T00:00:00.000Z'});
const ck=(r,id)=>r.checks.find(c=>c.id===id),mech=(r,id)=>r.mechanisms.find(m=>m.id===id);

test('baseline: growth supported in every condition, company named in its own event → Research priority; price never established',()=>{
 const r=run();assert.equal(r.verdict.id,'priority',r.verdict.why);assert.equal(mech(r,'growth').state,'supported');assert.equal(mech(r,'growth').supportedCount,4);
 assert.equal(r.priceOpportunity.status,'not_established');assert.match(r.use,/Not used for notifications/);
 assert.equal(mech(r,'distress').state,'not_applicable','no confirmed problem');assert.equal(ck(r,'pe_history').state,'not_checked');
});

test('unavailable or unchecked input is unknown, never "not a concern"',()=>{
 const r=run({quarterly:[]});assert.equal(ck(r,'revenue_trend').state,'unavailable');
 const held=mech(r,'held_up').conditions.find(c=>c.label==='Revenue trend not a concern');assert.equal(held.status,'unknown');
 assert.equal(mech(r,'growth').state,'not_established','quarter unknown → not established, never supported');assert.equal(r.verdict.id,'watch');
 const noDebt=run({annual:annual({debt:null})});assert.equal(ck(noDebt,'debt').state,'unavailable');assert.ok(!noDebt.concerns.includes('Debt'));
 const noFilings=run({filings:null});assert.equal(ck(noFilings,'listing').state,'unavailable');
});

test('1 seasonal retailer: quarter-on-quarter drop is not a concern or an improvement',()=>{
 const r=run({quarterly:quarterly([['2024-09-30',566],['2025-06-30',1000],['2025-09-30',600]])});
 assert.equal(ck(r,'revenue_trend').state,'supported');assert.ok(Math.abs(ck(r,'revenue_trend').value.quarterChangePct-6)<0.1);assert.equal(mech(r,'distress').state,'not_applicable');
});

test('2 bank: cash, debt, margin and runway checks not applicable; no mechanisms; Watch',()=>{
 assert.equal(isFinancial('6022'),true);assert.equal(isFinancial('6798'),false,'REITs are not treated as financial');
 const r=run({sic:'6022',annual:annual({ocf:-500,debt:9000,cash:100})});
 for(const id of ['cash_backed','debt','margin_trend','runway','ocf','net_income'])assert.equal(ck(r,id).state,'not_applicable',id);
 for(const id of ['held_up','growth','distress'])assert.equal(mech(r,id).state,'not_applicable',id);
 assert.equal(r.verdict.id,'watch');assert.match(r.verdict.why,/Financial company/);assert.equal(r.companyType,'financial');
});

test('3 missing data: no revenue → Insufficient evidence',()=>{
 const r=run({annual:annual({rev:[null,null,null]}),quarterly:[]});assert.equal(r.verdict.id,'insufficient');assert.match(r.verdict.why,/latest annual revenue/);
});

test('4 genuine turnaround: revenue fell two years, both latest quarters up on a year earlier, cash-generative → Turnaround candidate',()=>{
 const r=run({annual:annual({rev:[1200,1100,1000],ni:40,ocf:50}),quarterly:quarterly([['2024-06-30',240],['2024-09-30',245],['2025-06-30',250],['2025-09-30',260]])});
 assert.equal(ck(r,'revenue_trend').state,'concern');assert.equal(mech(r,'distress').state,'supported',JSON.stringify(mech(r,'distress').conditions));assert.equal(r.verdict.id,'turnaround');
});

test('turnaround needs a supported runway check or positive operating cash flow',()=>{
 const r=run({annual:annual({rev:[1200,1100,1000],ni:-40,ocf:-50,cash:null}),quarterly:quarterly([['2024-06-30',240],['2024-09-30',245],['2025-06-30',250],['2025-09-30',260]])});
 const d=mech(r,'distress');assert.equal(d.conditions.find(c=>c.label==='Can fund itself').status,'unknown');assert.equal(d.state,'not_established');assert.notEqual(r.verdict.id,'turnaround');
});

test('5 one-quarter bounce: improvement not met → Watch with one concern',()=>{
 const r=run({annual:annual({rev:[1200,1100,1000],ni:40,ocf:50}),quarterly:quarterly([['2024-06-30',240],['2024-09-30',245],['2025-06-30',230],['2025-09-30',260]])});
 assert.equal(mech(r,'distress').state,'not_established');assert.equal(r.concerns.length,1);assert.equal(r.verdict.id,'watch');
});

test('6 loss-maker with short runway; not-applicable beats contradicted, and both facts are shown',()=>{
 const r=run({annual:annual({rev:[1200,1100,1000],ni:-50,ocf:-60,cash:60,debt:300,eps:-1})});
 assert.equal(ck(r,'cash_backed').state,'not_applicable');assert.equal(ck(r,'runway').state,'concern');assert.equal(ck(r,'debt').state,'unavailable');assert.match(ck(r,'debt').text,/not computable/);
 const h=mech(r,'held_up');assert.equal(h.state,'not_applicable');assert.ok(h.conditions.some(c=>c.status==='concern'),'the revenue concern is still listed');assert.ok(h.conditions.some(c=>c.status==='not_applicable'));
 assert.equal(mechanismState([{status:'not_applicable'},{status:'concern'}]),'not_applicable');assert.equal(mechanismState([{status:'met'},{status:'concern'}]),'contradicted');assert.equal(mechanismState([{status:'met'},{status:'unknown'}]),'not_established');
 assert.equal(mech(r,'distress').state,'contradicted','cannot fund itself');assert.equal(r.verdict.id,'material','revenue and runway are two confirmed concerns');
});

test('7 profitable but no cash: concern; held-up and growth contradicted',()=>{
 const r=run({annual:annual({ocf:-10,cash:500})});assert.equal(ck(r,'cash_backed').state,'concern');
 assert.equal(mech(r,'held_up').state,'contradicted');assert.equal(mech(r,'growth').state,'contradicted');assert.equal(r.verdict.id,'watch');
});

test('8 deal only: a verified deal never makes a research priority',()=>{
 const r=run({annual:annual({rev:[900,1000,1020]}),verification:{state:'supported',checkedAt:'2026-03-05T00:00:00Z'}});
 assert.equal(mech(r,'deal').state,'supported');assert.equal(r.verdict.id,'watch');assert.equal(ck(r,'event_filing').value.laterThanAssessment,true,'checked after the assessment');
});

test('9 wrong company → Insufficient evidence',()=>{
 const r=run({kase:{symbol:'AMS',identity:{cik:'0000744825',name:'AMERICAN SHARED HOSPITAL SERVICES'},event:{headline:'ams-OSRAM AG Announces Divestment',publishedAt:'2026-03-01T13:00:00.000Z',analysis:{topics:['Merger or acquisition']}}}});
 assert.equal(r.verdict.id,'insufficient');assert.match(r.verdict.why,/different company/);
});

test('10 analyst opinion with supported growth → Watch, not Research priority',()=>{
 const r=run({kase:{event:{headline:'Analyst lifts Acme Robotics target',publishedAt:'2026-03-01T13:00:00.000Z',analysis:{topics:['Analyst opinion']}}}});
 assert.equal(mech(r,'growth').state,'supported');assert.equal(ck(r,'event_named').state,'not_applicable');assert.equal(r.verdict.id,'watch');assert.match(r.verdict.why,/analyst opinion/);
});

test('11 share count: never assumed split-adjusted; unavailable without the cover-page count; size is labelled approximate',()=>{
 const r=run({annual:annual({shares:200e6})});const sc=r.characteristics.find(c=>c.id==='share_count');assert.equal(sc.state,'unavailable');assert.match(sc.text,/does not assume/);
 const size=r.characteristics.find(c=>c.id==='small_company');assert.match(size.text,/Approximate/);
});

test('12 year-to-date cash flow only: single-quarter cash improvement is unavailable',()=>{
 const r=run({annual:annual({ocf:-10,cash:500})});const d=mech(r,'distress');assert.equal(d.conditions.find(c=>c.label==='Improvement matched to the problem').status,'unknown');assert.match(JSON.stringify(d.conditions),/year to date/);
});

test('13 observation rules fixed in advance: +12% baseline, then +3% and −1% → mixed, failed → mechanism mixed',()=>{
 assert.equal(observe('revenue_growth',12,3),'mixed');assert.equal(observe('revenue_growth',12,-1),'failed');assert.equal(observe('revenue_growth',12,6),'held');
 assert.equal(combine([['mixed'],['failed']]),'mixed');assert.equal(combine([['failed'],['failed']]),'failed');assert.equal(combine([['held','held'],['held','held']]),'held');
 assert.equal(combine([['held']]),'not_yet');assert.equal(combine([['held'],['not_yet']]),'not_yet');assert.equal(observe('margin_vs_baseline',null,10),'unavailable');assert.equal(observe('margin_vs_baseline',10,6.5),'mixed');assert.equal(observe('ocf_positive',null,undefined),'not_yet');
});

test('material concerns: two confirmed concerns and nothing supported (shape of ROLR)',()=>{
 const r=run({annual:annual({ocf:-30,cash:500}),quarterly:quarterly([['2024-06-30',240],['2024-09-30',250],['2025-06-30',200],['2025-09-30',120]])});
 assert.deepEqual(r.concerns.sort(),['Profit backed by cash','Revenue trend']);assert.equal(r.verdict.id,'material');assert.match(r.verdict.text,/thesis not established/);
});

test('held up while the price fell: steep fall + cash-backed + steady revenue, named company event → Research priority',()=>{
 const r=run({annual:annual({rev:[1000,1000,1020]}),stock:bars(i=>i<53?100:Math.max(50,100-(i-53)*0.5)),spy:bars(()=>400)});
 assert.equal(ck(r,'steep_fall').value.steep,true);assert.equal(mech(r,'held_up').state,'supported',JSON.stringify(mech(r,'held_up').conditions));assert.equal(r.verdict.id,'priority');
});

test('listing notice in the 12 months before assessment is a business concern; later filings are ignored',()=>{
 const r=run({filings:[{form:'8-K',items:'3.01,9.01',filed_at:'2025-10-01'},{form:'8-K',items:'3.01',filed_at:'2026-04-01'}]});
 assert.equal(ck(r,'listing').state,'concern');assert.match(ck(r,'listing').text,/2025-10-01/);assert.ok(!ck(r,'listing').text.includes('2026-04-01'));
});

test('no advice wording anywhere; retrospective flag',()=>{
 const r=run();const text=JSON.stringify(r);assert.ok(!/\b(buy|sell|price target|probabilit|expected return|undervalued|bargain)\b/i.test(text));assert.equal(r.retrospective,false);
});
