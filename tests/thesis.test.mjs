import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const load=async file=>{const b=await esbuild.build({entryPoints:[file],bundle:true,write:false,platform:'node',format:'esm'});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));};
const {buildThesis,MAX_POINTS}=await load('lib/sentinel/thesis.ts');
const {eventMatch}=await load('lib/sentinel/event-match.ts');
const {buildEvidencePack}=await load('lib/sentinel/evidence-pack.ts');
const {whatChanged,priceContext}=await load('lib/sentinel/case-context.ts');
const {checkStatus,regularSession}=await load('lib/sentinel/auto-practice.ts');

const asOf='2026-11-13T10:00:00.000Z';
const fig=(metric,value,end,start,{filed='2026-02-01',form='10-K',recorded='2026-02-02T00:00:00.000Z',unit='USD',tag=metric}={})=>({metric,value,unit,period_end:end,confidence:'reported',inputs:[{source_tag:tag,period_start:start,accession:'0000000001-'+end.slice(2,4)+'-1',raw_event_id:'raw-'+metric+end,form,known_from:filed+'T23:59:59.999Z',recorded_at:recorded,filed,value,unit}]});
const annual=(metric,now,prior)=>[fig(metric,now,'2025-12-31','2025-01-01'),fig(metric,prior,'2024-12-31','2024-01-01',{filed:'2025-02-01',recorded:'2025-02-02T00:00:00.000Z'})];
const kaseOf=(over={})=>({id:'discovery-case:x',symbol:'FIX',createdAt:asOf,status:'complete',conclusion:'INVESTIGATE',decision:{version:'research-screen-v2'},
 event:{headline:'Fixture Corp reports quarterly results',url:'https://example.test/news',source:'Fixture Wire',publishedAt:'2026-11-13T09:00:00.000Z',firstObservedAt:'2026-11-13T09:20:00.000Z',analysis:{topics:['Earnings or financial results']}},
 identity:{name:'Fixture Corp',cik:'0000000001',relevance:{level:'direct_candidate',role:'possible event subject',reason:'r'}},
 price:{status:'indicative',ratio:20,basis:'last_close',priceLabel:'IEX close 2026-11-12',price:100,eps:5,quoteTime:'2026-11-12T21:00:00.000Z',periodStart:'2025-01-01',periodEnd:'2025-12-31',filed:'2026-02-01',accession:'0000000001-25-1'},...over});
const build=(kase,figures,quarterly=[],price)=>{const pack=buildEvidencePack({caseId:kase.id,kase,figures,quarterlyFigures:quarterly,asOf:kase.createdAt,recordedBy:kase.createdAt});const context=whatChanged(pack,kase);const match=eventMatch({headline:kase.event.headline,summary:kase.event.providerSummary,companyName:kase.identity?.name,symbol:kase.symbol});return {t:buildThesis({kase,context,match,price}),context,pack};};
const healthy=[...annual('revenue',120e6,100e6),...annual('net_income',10e6,8e6),...annual('cfo',15e6,12e6),...annual('operating_income',20e6,16e6)];

test('A–E for a supported company announcement: sourced positives with periods, what each establishes, and honest unknowns',()=>{
 const {t}=build(kaseOf(),healthy);
 assert.equal(t.version,'investment-thesis-v1');assert.equal(t.promoted,true);
 assert.equal(t.appeared.match.status,'supported');assert.equal(t.appeared.eventType.type,'company_report');assert.equal(t.appeared.url,'https://example.test/news');assert.equal(t.appeared.publishedAt,'2026-11-13T09:00:00.000Z');assert.equal(t.appeared.assessedAt,asOf);
 assert.equal(t.supports.length,MAX_POINTS);assert.deepEqual(t.supports.map(o=>o.topic),['Revenue','Profitability','Cash flow'],'one of each before any repeat');assert.equal(t.counts.supports,5);
 const rev=t.supports[0];assert.match(rev.text,/Revenue \(year\) rose \+20\.0%/);assert.equal(rev.basis,'vs prior year');assert.deepEqual(rev.periods,{latest:'2025-12-31',prior:'2024-12-31'});assert.equal(rev.source.accession,'0000000001-25-1');assert.match(rev.source.url,/^https:\/\/www\.sec\.gov\//);assert.equal(rev.source.filed,'2026-02-01');assert.equal(rev.cites.length,2);
 for(const o of t.supports){assert.match(o.establishes,/^Establishes/);assert.match(o.establishes,/nothing about whether the shares are attractive/);}
 assert.equal(t.challenges.length,1);assert.equal(t.challenges[0].status,'unknown');assert.match(t.challenges[0].text,/expectations: unknown/i);assert.match(t.challengesNote,/not evidence of safety/);
 assert.equal(t.questions.length,3);assert.match(t.questions[0].question,/What exactly did Fixture Corp report/);assert.match(t.questions[1].question,/guidance and with what analysts expected/);
 assert.match(t.summary.reason.text,/Revenue \(year\) rose/);assert.equal(t.summary.counter.status,'unknown');
 assert.deepEqual(build(kaseOf(),healthy).t,t,'deterministic');
});
test('counter-evidence: falling revenue, a loss and cash outflow are shown with sources; dilution and funding follow',()=>{
 const weak=[...annual('revenue',80e6,100e6),...annual('net_income',-12e6,-3e6),...annual('cfo',-9e6,2e6),...annual('cash',5e6,9e6).map(f=>({...f,inputs:[{...f.inputs[0],period_start:null}]})),...annual('total_debt',40e6,30e6).map(f=>({...f,inputs:[{...f.inputs[0],period_start:null}]}))];
 const {t}=build(kaseOf({conclusion:'MONITOR',price:{status:'unavailable',reason:'The latest reported annual diluted EPS is zero or negative; a positive P/E is not meaningful.'}}),weak);
 assert.equal(t.supports.length,0);assert.match(t.supportsNote,/gap in the evidence, not a negative finding/);
 assert.deepEqual(t.challenges.map(o=>[o.topic,o.status]),[['Revenue','supported'],['Profitability','supported'],['Cash flow','supported']]);assert.ok(t.counts.challenges>=4,'funding gap is counted beyond the three shown');
 assert.match(t.challenges[0].text,/fell -20\.0%/);assert.match(t.challenges[1].text,/a loss/);assert.ok(t.challenges.every(o=>o.source?.accession&&o.periods?.latest==='2025-12-31'));
 assert.equal(t.priceValuation.valuation.status,'unavailable');assert.match(t.priceValuation.valuation.reason,/zero or negative/);assert.match(t.questions[2].question,/cost relative to earnings/);
});
test('mismatched company: never promoted, no supporting observations, the match leads the challenges and the questions',()=>{
 const {t}=build(kaseOf({symbol:'AMS',identity:{name:'AMERICAN SHARED HOSPITAL SERVICES',cik:'0000000001',relevance:{level:'review',role:'unknown',reason:'not named'}},event:{headline:'ams-OSRAM Reports Q3 2026 Financial Results',url:'https://example.test/ams',source:'Wire',publishedAt:'2026-11-13T09:00:00.000Z',analysis:{topics:['Earnings or financial results']}}}),healthy);
 assert.equal(t.promoted,false);assert.equal(t.appeared.match.status,'likely_wrong');assert.equal(t.supports.length,0);assert.equal(t.counts.supports,0);assert.match(t.supportsNote,/probably not the company in this report/);
 assert.equal(t.challenges[0].topic,'Company match');assert.match(t.challenges[0].text,/probably not about AMERICAN SHARED/);assert.equal(t.summary.reason,null);assert.match(t.summary.reasonNote,/Not offered as an idea/);assert.match(t.questions[0].question,/actually concern/);
 const unsure=build(kaseOf({event:{headline:'Shares of FIX slide',publishedAt:'2026-11-13T09:00:00.000Z',analysis:{topics:[]}},identity:{name:'Fixture Corp',cik:'0000000001',relevance:{level:'review',role:'unknown',reason:'x'}}}),healthy).t;
 assert.equal(unsure.appeared.match.status,'uncertain');assert.equal(unsure.promoted,true);assert.equal(unsure.challenges[0].topic,'Company match');assert.equal(unsure.supports.length,3,'figures are still shown, with the warning first');assert.equal(unsure.appeared.eventType.type,'unclear');
});
test('analyst opinion is told apart from a company announcement',()=>{
 const {t}=build(kaseOf({event:{headline:'Baird Downgrades Fixture Corp to Neutral, Lowers Price Target',publishedAt:'2026-11-13T09:00:00.000Z',analysis:{topics:['Analyst opinion']}},identity:{name:'Fixture Corp',cik:'0000000001',relevance:{level:'review',role:'mentioned company',reason:'x'}}}),healthy);
 assert.equal(t.appeared.eventType.type,'analyst_opinion');assert.equal(t.challenges[0].topic,'Kind of report');assert.match(t.questions[0].question,/analyst/);
 assert.equal(build(kaseOf({identity:{name:'Fixture Corp',cik:'0000000001',relevance:{level:'direct_candidate',role:'possible affected party',reason:'x'}}}),healthy).t.appeared.eventType.type,'about_company');
});
test('valid comparison periods only: a non-comparable prior year gives no % and becomes an unknown, not a claim',()=>{
 const gap=[fig('revenue',120e6,'2025-12-31','2025-01-01'),fig('revenue',100e6,'2023-12-31','2023-01-01',{filed:'2024-02-01',recorded:'2024-02-02T00:00:00.000Z'})];
 const {t}=build(kaseOf(),gap);
 assert.ok(!t.supports.some(o=>o.topic==='Revenue'));assert.deepEqual(t.challenges.map(o=>o.topic),['Revenue trend','Profitability','Cash flow']);assert.ok(t.challenges.every(o=>o.status==='unknown'&&o.source===null));assert.equal(t.counts.challenges,0);
 const zero=build(kaseOf(),[...annual('revenue',120e6,0)]).t;assert.ok(!zero.supports.some(o=>o.topic==='Revenue'),'a zero base gives no % change');
 const none=build(kaseOf({identity:null}),[]).t;assert.equal(none.supports.length,0);assert.equal(none.appeared.match.status,'uncertain');
});
test('point in time: a figure filed after the assessment never appears',()=>{
 const later=[fig('revenue',500e6,'2026-09-30','2025-10-01',{filed:'2026-11-20'}),...annual('revenue',120e6,100e6)];
 const lt=build(kaseOf(),later).t;assert.ok(!JSON.stringify(lt).includes('500'),'filed after the case: never shown');assert.ok(!lt.supports.some(o=>o.topic==='Revenue'),'and no comparison is built on it');
 // The recorded-time boundary is applied when figures are loaded (companyFile 'recorded' mode); the route test covers it.
});
test('price and valuation: actual price basis and EPS period; before is known at assessment, after is later; nothing causal',()=>{
 const days=[];for(let d=new Date('2026-09-28T05:00:00Z');d<new Date('2026-11-20');d=new Date(+d+86400000))if(d.getUTCDay()%6)days.push(d.toISOString().slice(0,10)+'T05:00:00Z');
 const bars=f=>({bars:days.map((t,i)=>({t,c:f(i)}))});
 const price=priceContext({stock:bars(i=>100+i),spy:bars(()=>500),symbol:'FIX',publishedAt:'2026-11-13T09:00:00.000Z',caseAt:asOf,fetchedAt:'2026-11-19T22:00:00.000Z',source:'Alpaca IEX daily bars',adjustment:'all',rawIds:['a','b']});
 const {t}=build(kaseOf(),healthy,[],price);const pv=t.priceValuation;
 assert.equal(pv.priceMove.status,'ok');assert.equal(pv.priceMove.before.timing,'known_at_assessment');assert.equal(pv.priceMove.after.timing,'later_than_assessment');assert.equal(pv.priceMove.before.to,'2026-11-12');assert.equal(pv.priceMove.after.from,'2026-11-12');assert.equal(pv.priceMove.before.spyPct,0);assert.ok(pv.priceMove.before.stockPct>10);
 assert.match(t.questions[2].question,/against SPY in the 20 sessions before the report/);
 assert.equal(pv.valuation.pe,20);assert.match(pv.valuation.priceBasis,/Last completed daily close/);assert.equal(pv.valuation.priceTime,'2026-11-12T21:00:00.000Z');assert.deepEqual(pv.valuation.epsPeriod,{start:'2025-01-01',end:'2025-12-31'});assert.match(pv.valuation.limitation,/Share basis/);
 assert.equal(build(kaseOf(),healthy).t.priceValuation.priceMove.status,'not_loaded');assert.equal(build(kaseOf(),healthy,[],{status:'unavailable',reason:'HTTP 429'}).t.priceValuation.priceMove.reason,'HTTP 429');
 assert.deepEqual(build(kaseOf(),healthy,[],price).t.supports,build(kaseOf(),healthy).t.supports,'loading prices does not change the observations');
 const high=build(kaseOf({conclusion:'MONITOR',price:{...kaseOf().price,ratio:39.5}}),healthy).t;assert.ok(high.challenges.some(o=>o.topic==='Valuation'&&/above the research screen/.test(o.text)&&/does not show the shares are overpriced/.test(o.establishes)));
 const text=JSON.stringify([t,high]).toLowerCase();for(const banned of ['buy','sell','price target','probability','expected return','undervalued','caused the','overlooked','upside'])assert.ok(!text.includes(banned),banned);
});
test('Practice last check: recorded fields are shown, anything not recorded is unknown, nothing is inferred',()=>{
 assert.deepEqual(checkStatus(null),{recorded:false,at:null,trigger:'unknown',marketOpen:'unknown',freshQuotes:'unknown',opened:'unknown',closed:'unknown',skipped:'unknown',waiting:'unknown',casesSeen:'unknown',notMeetingRules:'unknown',note:null});
 const old=checkStatus({at:'2026-11-13T13:26:00.000Z',trigger:'hourly',opened:[],closed:[],skipped:['AMS'],counts:{candidates:3,notMeetingRules:3}});
 assert.equal(old.marketOpen,'unknown','an older record without the field is not guessed from its time');assert.equal(old.waiting,'unknown');assert.equal(old.skipped,1);assert.equal(old.casesSeen,3);
 const full=checkStatus({at:'2026-11-13T15:26:00.000Z',trigger:'manual',opened:['FIX'],closed:[],skipped:[],waiting:[{}],counts:{candidates:9,notMeetingRules:7},market:{regularHours:true,freshSpyQuote:true}});
 assert.equal(full.marketOpen,true);assert.equal(full.freshQuotes,true);assert.equal(full.opened,1);assert.equal(full.waiting,1);assert.equal(full.trigger,'manual');
 assert.equal(checkStatus({market:{regularHours:false,freshSpyQuote:null}}).freshQuotes,'unknown');
 assert.deepEqual([regularSession('2026-11-13T14:29:00Z'),regularSession('2026-11-13T14:30:00Z'),regularSession('2026-11-13T20:59:00Z'),regularSession('2026-11-13T21:00:00Z'),regularSession('2026-11-14T15:00:00Z'),regularSession('2026-07-01T13:30:00Z'),regularSession('bad')],[false,true,true,false,false,true,null]);
});
