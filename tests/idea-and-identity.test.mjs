import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const load=async file=>{const b=await esbuild.build({entryPoints:[file],bundle:true,write:false,platform:'node',format:'esm'});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));};
const {eventMatch,caseEventMatch}=await load('lib/sentinel/event-match.ts');
const {closeFromBars}=await load('lib/sentinel/last-close.ts');
const {priceAssessment,researchDecisionV2}=await load('lib/sentinel/price-assessment.ts');
const {ideaCard,portfolioFit}=await load('lib/sentinel/idea-card.ts');
const {rankCases}=await load('lib/sentinel/discover-rank.ts');
const ASHS='AMERICAN SHARED HOSPITAL SERVICES';

test('event match: the ams-OSRAM report tagged AMS is flagged as probably another company',()=>{
 const m=eventMatch({headline:'ams-OSRAM Reports Q3 2026 Financial Results',summary:'',companyName:ASHS,symbol:'AMS'});
 assert.equal(m.level,'name_conflict');assert.equal(m.confirmed,false);assert.equal(m.evidence,'ams-OSRAM');assert.match(m.reason,/different company/);assert.equal(m.version,'event-match-v1');
 assert.equal(eventMatch({headline:'Ams Osram cuts jobs',companyName:ASHS,symbol:'AMS'}).level,'name_conflict');
});
test('event match: named, summary-only, ticker-only and unknown stay distinct; only a headline name is confirmed',()=>{
 assert.deepEqual([eventMatch({headline:'American Shared Hospital Services Reports Q3',companyName:ASHS,symbol:'AMS'}).level,eventMatch({headline:'Sector update',summary:'American Shared Hospital Services announced results',companyName:ASHS,symbol:'AMS'}).level,eventMatch({headline:'Shares of AMS fall 5%',companyName:ASHS,symbol:'AMS'}).level,eventMatch({headline:'Hospital stocks slide (NYSE American: AMS)',companyName:ASHS,symbol:'AMS'}).level,eventMatch({headline:'x',companyName:null,symbol:'AMS'}).level],['named_in_headline','named_in_summary','ticker_only','ticker_only','unknown']);
 assert.equal(eventMatch({headline:'Tesla raises guidance',companyName:'Tesla, Inc.',symbol:'TSLA'}).confirmed,true);
 assert.equal(eventMatch({headline:'Sector update',summary:'American Shared Hospital Services announced',companyName:ASHS,symbol:'AMS'}).confirmed,false);
});
test('event match: a stored result is kept; older cases are read from their stored text',()=>{
 const stored={version:'event-match-v1',level:'ticker_only',confirmed:false,evidence:null,label:'x',reason:'y'};
 assert.equal(caseEventMatch({eventMatch:stored,event:{headline:'Tesla raises guidance'},identity:{name:'Tesla, Inc.'},symbol:'TSLA'}),stored);
 assert.equal(caseEventMatch({event:{headline:'Tesla raises guidance'},identity:{name:'Tesla, Inc.'},symbol:'TSLA'}).level,'named_in_headline');
});

const bars={bars:[{t:'2026-11-10T05:00:00Z',c:98},{t:'2026-11-11T05:00:00Z',c:99},{t:'2026-11-12T05:00:00Z',c:100},{t:'2026-11-13T05:00:00Z',c:140}]};
test('last close: latest completed session only, never an open session, never older than five days, never without a capture',()=>{
 const c=closeFromBars(bars,'FIX','2026-11-13T05:25:00.000Z','raw-1');
 assert.equal(c.close,100);assert.equal(c.sessionDate,'2026-11-12');assert.equal(c.closeAt,'2026-11-12T21:00:00.000Z');assert.equal(c.rawEventId,'raw-1');
 assert.equal(closeFromBars(bars,'FIX','2026-11-13T21:00:01.000Z','raw-1').close,140,'the session counts once it has closed');
 assert.equal(closeFromBars(bars,'FIX','2026-11-20T00:00:00.000Z','raw-1'),null,'too old');
 assert.equal(closeFromBars(bars,'FIX','2026-11-13T05:25:00.000Z',''),null);assert.equal(closeFromBars({bars:[{t:'bad',c:1},{t:'2026-11-12T05:00:00Z',c:-1}]},'FIX','2026-11-13T05:25:00.000Z','r'),null);assert.equal(closeFromBars(null,'FIX','2026-11-13T05:25:00.000Z','r'),null);
});
const asOf='2026-11-13T05:25:00.000Z',eps={metric:'eps_diluted',confidence:'reported',value:5,unit:'USD/shares',period_end:'2025-12-31',inputs:[{period_start:'2025-01-01',accession:'a-1',raw_event_id:'raw-eps',form:'10-K',known_from:'2026-02-01T23:59:59.999Z',recorded_at:'2026-02-02T00:00:00.000Z',filed:'2026-02-01'}]};
const security={status:'candidate_common',symbol:'FIX',rawEventId:'raw-asset'};
const offHours={symbol:'FIX',bid:374.96,ask:413.75,sourceTime:'2026-11-12T21:00:00.139Z',stale:true,wideSpread:true,rawEventId:'raw-q'};
const lastClose={symbol:'FIX',close:100,sessionDate:'2026-11-12',closeAt:'2026-11-12T21:00:00.000Z',rawEventId:'raw-bars',source:'Alpaca IEX daily bar'};
test('price basis: off-hours wide quote alone stays unavailable; with a recorded last close the P/E is computed and labelled',()=>{
 const base={figures:[eps],security,asOf,filingsStale:false};
 assert.equal(priceAssessment({...base,quote:offHours}).status,'unavailable');
 assert.equal(priceAssessment({...base,quote:offHours,lastClose:null}).status,'unavailable');
 const r=priceAssessment({...base,quote:offHours,lastClose});
 assert.equal(r.status,'indicative');assert.equal(r.basis,'last_close');assert.equal(r.ratio,20);assert.equal(r.price,100,'the close, not the wide quote midpoint');assert.equal(r.quoteRawId,'raw-bars');assert.equal(r.priceLabel,'IEX close 2026-11-12');assert.match(r.limitations,/last completed daily close/);assert.match(r.limitations,/may have moved since/);
 for(const bad of [{...lastClose,symbol:'OTHER'},{...lastClose,close:0},{...lastClose,rawEventId:''},{...lastClose,closeAt:'2026-11-13T21:00:00.000Z'},{...lastClose,closeAt:'2026-11-01T21:00:00.000Z'}])assert.equal(priceAssessment({...base,quote:offHours,lastClose:bad}).status,'unavailable');
 assert.equal(priceAssessment({...base,security:{status:'unverified'},quote:offHours,lastClose}).status,'unavailable','identity is still required');
});
test('price basis: an eligible live quote is still preferred and the screen rules are unchanged',()=>{
 const live={symbol:'FIX',bid:99.9,ask:100.1,sourceTime:'2026-11-13T05:24:00.000Z',stale:false,wideSpread:false,rawEventId:'raw-live'};
 const r=priceAssessment({figures:[eps],security,asOf,filingsStale:false,quote:live,lastClose:{...lastClose,close:50}});
 assert.equal(r.basis,'live_midpoint');assert.equal(r.ratio,20);assert.equal(r.quoteRawId,'raw-live');
 const brief={stale:false,evidence:[{label:'Revenue',value:1,periodEnd:'2025-12-31',rawEventId:'r'}]},price=priceAssessment({figures:[eps],security,asOf,filingsStale:false,quote:offHours,lastClose});
 const d=researchDecisionV2({identity:{relevance:{level:'direct_candidate'}},price,brief,asOf,topics:['Earnings or financial results']});
 assert.equal(d.conclusion,'INVESTIGATE');assert.equal(d.version,'research-screen-v2');
 assert.equal(researchDecisionV2({identity:{relevance:{level:'review'}},price,brief,asOf,topics:['Earnings or financial results']}).conclusion,'MONITOR');
});

const mk=(over={})=>({id:'c1',symbol:'FIX',createdAt:'2026-11-13T10:00:00.000Z',status:'complete',conclusion:'INVESTIGATE',decision:{version:'research-screen-v2',reason:'All research screening rules met; further verification required.'},rules:[{id:'R1',passed:true},{id:'R2',passed:true},{id:'R3',passed:true}],event:{headline:'Fixture Corp reports quarterly results',source:'Fixture',publishedAt:'2026-11-13T09:00:00.000Z',analysis:{topics:['Earnings or financial results']}},identity:{name:'Fixture Corp',relevance:{level:'direct_candidate',reason:'Headline wording suggests a direct company role.'}},security:{status:'candidate_common'},price:{status:'indicative',ratio:20,basis:'last_close',priceLabel:'IEX close 2026-11-12'},...over});
const ctx={business:[{label:'Revenue (quarter)',changePct:12.34,comparison:'same quarter a year earlier',latest:{period:{end:'2026-09-30'},source:{accession:'a-1'},sourceTime:'2026-11-01'}},{label:'Net income (year)',changePct:-8,comparison:'prior year',latest:{period:{end:'2025-12-31'},source:{accession:'a-2'},sourceTime:'2026-02-01'}},{label:'Operating cash flow (year)',changePct:null,comparison:'prior year',latest:{}}],supports:[{text:'Profitable in the latest year.',mustHold:'Stays profitable.'}],risks:[{text:'Debt exceeds cash.',wrongIf:'Cash covers debt.'}],missing:['Intrinsic value estimate.'],nextChecks:['Read the original report.']};
const score={score:85,band:'Strong evidence',coverage:100,checks:[{label:'A',state:'pass',detail:''},{label:'Fresh SEC data',state:'unknown',detail:'No recent filing.'}]};
const fit=portfolioFit({symbol:'FIX',manual:{open:[{symbol:'AAA',amountCents:200000}],cashCents:800000,startCents:1000000},autoOpenSymbols:['FIX'],standardPositionCents:100000});
test('idea card: a clear rule-based view with for, against, unknowns and fit; never a forecast, target or instruction',()=>{
 const m=eventMatch({headline:mk().event.headline,companyName:'Fixture Corp',symbol:'FIX'});
 const card=ideaCard({kase:mk(),context:ctx,score,match:m,fit});
 assert.equal(card.version,'idea-card-v1');assert.equal(card.view.tone,'research');assert.match(card.view.label,/research time/);assert.match(card.view.text,/not a recommendation/);
 assert.match(card.view.uncertainty,/85\/100/);assert.match(card.view.uncertainty,/1 of 2 checks could not be run: Fresh SEC data/);assert.match(card.view.uncertainty,/not a chance of gain/);
 assert.ok(card.evidenceFor.some(l=>/Revenue \(quarter\) \+12\.3%/.test(l.text)&&/a-1/.test(l.detail)));assert.ok(card.counter.some(l=>/Net income \(year\) -8\.0%/.test(l.text)));
 assert.ok(!JSON.stringify(card).includes('Operating cash flow (year)'),'a comparison with no valid % is not turned into a claim');
 assert.ok(card.evidenceFor.some(l=>/P\/E 20\.0 \(IEX close 2026-11-12/.test(l.text)&&/not a live price/.test(l.detail)));
 assert.ok(card.counter.some(l=>/may already reflect/.test(l.text)));assert.ok(card.missing[0].startsWith('Upside or fair value: not estimated'));
 assert.equal(card.fit.status,'known');assert.equal(card.fit.heldInPractice,false);assert.equal(card.fit.heldInExperiment,true);assert.equal(card.fit.weightIfAddedPct,10);assert.match(card.fit.note,/does not know your real holdings/);
 const text=JSON.stringify(card).toLowerCase();for(const banned of ['buy','sell','price target','probability of','expected return','you should buy','sell now','guarantee'])assert.ok(!text.includes(banned),banned);
 assert.deepEqual(ideaCard({kase:mk(),context:ctx,score,match:m,fit}),card,'deterministic');
});
test('idea card: mismatch, watch, wait, old screen and unknown holdings are stated plainly',()=>{
 const clash=eventMatch({headline:'ams-OSRAM Reports Q3 2026 Financial Results',companyName:ASHS,symbol:'AMS'});
 const c1=ideaCard({kase:mk({symbol:'AMS',identity:{name:ASHS,relevance:{level:'review',reason:'not named'}}}),context:ctx,score,match:clash,fit});
 assert.equal(c1.view.tone,'doubt');assert.equal(c1.view.label,'Probably not about this company');assert.equal(c1.counter[0].text,'Probably a different company.');
 const named=eventMatch({headline:mk().event.headline,companyName:'Fixture Corp',symbol:'FIX'});
 assert.equal(ideaCard({kase:mk({conclusion:'MONITOR',rules:[{id:'R3',passed:false,detail:'Indicative P/E above 0 and at most 30'}]}),context:ctx,score,match:named,fit}).view.tone,'watch');
 const wait=ideaCard({kase:mk({conclusion:'WAIT',decision:{version:'research-screen-v2',reason:'An eligible price-to-reported-earnings measure is unavailable.'},price:{status:'unavailable'}}),context:ctx,score:{score:null,coverage:45,checks:[]},match:named,fit});
 assert.equal(wait.view.label,'Not enough data to judge');assert.match(wait.view.uncertainty,/too thin to score: only 45 of 100/);
 assert.equal(ideaCard({kase:mk({decision:{version:'research-screen-v1'}}),context:ctx,score,match:named,fit}).view.label,'No judgment (older screen)');
 const tickerOnly=ideaCard({kase:mk(),context:ctx,score,match:eventMatch({headline:'Shares of FIX fall',companyName:'Fixture Corp',symbol:'FIX'}),fit:portfolioFit({symbol:'FIX',manual:null,autoOpenSymbols:[],standardPositionCents:100000})});
 assert.match(tickerOnly.view.text,/Company match is unconfirmed/);assert.equal(tickerOnly.fit.status,'unknown');
});
test('discover-rank-v2: a probable mismatch is listed last with the reason; other rows keep their v1 order',()=>{
 const now='2026-11-13T12:00:00.000Z',sc=(n)=>({version:'evidence-score-v1',status:'scored',score:n,band:'x',coverage:100,checks:[]});
 const row=(symbol,score,headline,name)=>({id:'case-'+symbol,symbol,createdAt:'2026-11-13T10:00:00.000Z',conclusion:'WAIT',decision:{version:'research-screen-v2'},evidenceScore:sc(score),event:{headline,publishedAt:'2026-11-13T09:00:00.000Z'},identity:{name}});
 const r=rankCases([row('AMS',90,'ams-OSRAM Reports Q3 2026 Financial Results',ASHS),row('BBB',50,'Beta Corp reports results','Beta Corp'),row('CCC',70,'Shares of CCC fall','Gamma Corp')],now);
 assert.equal(r.version,'discover-rank-v2');assert.deepEqual(r.rows.map(x=>x.symbol),['CCC','BBB','AMS']);
 assert.match(r.rows[2].whyRanked,/^Listed last: /);assert.equal(r.rows[2].eventMatch.level,'name_conflict');assert.equal(r.rows[0].eventMatch.level,'ticker_only');assert.equal(r.rows[1].eventMatch.confirmed,true);
});
