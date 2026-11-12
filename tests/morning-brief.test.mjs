import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const b=await esbuild.build({entryPoints:['lib/sentinel/morning-brief.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const B=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));

const NOW='2026-11-12T18:00:00.000Z',hAgo=h=>new Date(Date.parse(NOW)-h*3600000).toISOString();
const rules=(r1,r2,r3)=>[{id:'R1',passed:r1,detail:'Material event topic'},{id:'R2',passed:r2,detail:'Direct company role'},{id:'R3',passed:r3,detail:'Indicative P/E above 0 and at most 30'}];
const kase=(o)=>({id:'case-'+o.symbol+(o.suffix||''),symbol:o.symbol,createdAt:o.createdAt??hAgo(2),conclusion:o.conclusion,reason:o.reason??'r',decision:{version:o.version??'research-screen-v2'},rules:o.rules??rules(true,true,true),readiness:o.readiness??{status:'DATA_READY',blockers:[]},identity:{name:o.name??o.symbol+' Inc.',cik:'1',relevance:{level:'direct_candidate'}},event:{headline:o.headline??o.symbol+' reports results',url:'https://example.test/'+o.symbol,source:'Benzinga',publishedAt:o.publishedAt??hAgo(3),analysis:{topics:o.topics??['Earnings or financial results'],whyReview:['Reported results or guidance may affect the outlook for sales, profitability or cash flow.'],questions:['Check the company release and compare the figures with prior expectations.']}},price:o.price??{status:'indicative',ratio:18.4,quoteTime:'2026-11-12T16:21:00Z',periodEnd:'2025-12-31'},brief:{evidence:[{label:'Revenue',value:1.2e9,periodEnd:'2025-12-31'}]}});
const base={now:NOW,cases:[],watch:[],lastScan:{at:hAgo(1),completed:true,pages:2},pendingCount:12,lastOutcomeAt:null,outcomeCounts:{},shadow:{enabled:false,readings:0}};

test('bottom line leads with the conclusion, then radar, watchlist and system state',()=>{
 const r=B.buildMorningBrief({...base,lastScan:{at:hAgo(1),completed:false,pages:5},pendingCount:269,cases:[kase({symbol:'EXMP',conclusion:'INVESTIGATE',headline:'Example Corp beats guidance'}),kase({symbol:'COST',conclusion:'MONITOR',rules:rules(false,false,false),topics:['Analyst opinion'],price:{status:'indicative',ratio:52.84,quoteTime:'2026-11-12T16:21:00Z',periodEnd:'2026-08-30'}}),kase({symbol:'HUBS',conclusion:'WAIT',readiness:{status:'DATA_INCOMPLETE',blockers:['An eligible price-to-reported-earnings measure is unavailable.']},price:{status:'unavailable',reason:'wide spread'}})]});
 assert.equal(r.bottomLine,'One case is worth a closer look: EXMP — Example Corp beats guidance. 1 more case has complete data but missed a rule. Nothing new on your watchlist. The latest scan was partial; 269 reports are queued.');
 assert.deepEqual(r.counts,{investigate:1,monitor:1,waiting:1,assessed:3});
 assert.equal(r.takes[0].whyItMatters,'Reported results or guidance may affect the outlook for sales, profitability or cash flow.','why-line comes from the rule template, not a model');
 assert.deepEqual(r.takes[0].keyFact,{label:'P/E',value:'18.4',source:'IEX midpoint 16:21 UTC ÷ annual diluted EPS (year to 2025-12-31)'});
 assert.equal(r.radar[0].reason,"Analyst opinion is not a qualifying event · Company's role in the headline is unclear · P/E 52.8 is outside 0–30");
 assert.equal(r.waiting[0].missing,'An eligible price-to-reported-earnings measure is unavailable.');
 assert.equal(r.status.level,'attention');
});

test('an empty day is said plainly, and a stalled scheduler is flagged',()=>{
 const quiet=B.buildMorningBrief(base);
 assert.equal(quiet.bottomLine,'Sentinel assessed no new cases in the last 24 hours. Nothing new on your watchlist.');assert.equal(quiet.status.level,'ok');
 const stalled=B.buildMorningBrief({...base,lastScan:{at:hAgo(7),completed:true,pages:1}});
 assert.match(stalled.bottomLine,/No market scan has run for 7 hours — check the scheduled task\./);assert.equal(stalled.status.level,'problem');
 assert.match(B.buildMorningBrief({...base,lastScan:null}).bottomLine,/No market scan has been recorded yet\./);
 const none=B.buildMorningBrief({...base,cases:[kase({symbol:'HIVE',conclusion:'WAIT'})]});
 assert.match(none.bottomLine,/^No case met all three screening rules in the last 24 hours\./);
});

test('only screen-v2 cases become takes or radar; older labels wait with their version shown',()=>{
 const r=B.buildMorningBrief({...base,cases:[kase({symbol:'OLD',conclusion:'INVESTIGATE',version:'research-screen-v1'})]});
 assert.equal(r.takes.length,0);assert.equal(r.waiting[0].label,'INVESTIGATE (research-screen-v1)');
});

test('window, de-duplication per symbol, caps and ordering',()=>{
 const cases=[kase({symbol:'OUT',conclusion:'INVESTIGATE',createdAt:hAgo(30)}),kase({symbol:'DUP',conclusion:'WAIT',createdAt:hAgo(5)}),kase({symbol:'DUP',suffix:'-new',conclusion:'INVESTIGATE',createdAt:hAgo(1)}),...['A','B','C','D'].map((s,i)=>kase({symbol:s,conclusion:'INVESTIGATE',publishedAt:hAgo(10-i)}))];
 const r=B.buildMorningBrief({...base,cases});
 assert.ok(!JSON.stringify(r.takes).includes('OUT'),'older than 24 h is excluded');
 assert.equal(r.counts.investigate,5);assert.equal(r.takes.length,3);assert.equal(r.moreTakes,2);
 assert.equal(r.takes[0].symbol,'DUP','latest case per symbol, most recent publication first');
 const radar=B.buildMorningBrief({...base,cases:[kase({symbol:'X',conclusion:'MONITOR',rules:rules(false,false,true)}),kase({symbol:'Y',conclusion:'MONITOR',rules:rules(true,true,false)})]});
 assert.deepEqual(radar.radar.map(x=>x.symbol),['Y','X'],'closest misses first');
});

test('watchlist changes, outcome counts and the shadow reader are reported as counts only',()=>{
 const r=B.buildMorningBrief({...base,watch:[{entityId:'sec:1',name:'Apple Inc.',ticker:'AAPL',filings:[{form:'8-K',filedAt:'2026-11-12',accession:'a'}],headlines:[]},{entityId:'sec:2',name:'Etsy, Inc.',ticker:'ETSY',filings:[],headlines:[]}],outcomeCounts:{5:3,20:1},shadow:{enabled:true,readings:7}});
 assert.match(r.bottomLine,/On your watchlist, Apple Inc\. has news or filings\./);
 assert.equal(r.watchlist.changes.length,1);assert.deepEqual(r.watchlist.tracked,['Apple Inc.','Etsy, Inc.']);
 assert.deepEqual(r.outcomes.horizons,[{horizon:5,observed:3},{horizon:20,observed:1},{horizon:60,observed:0},{horizon:120,observed:0}]);
 assert.equal(r.status.shadowReader,'On · 7 readings in 24 h');
});

test('no investment instructions or invented scores anywhere in the brief',()=>{
 const r=B.buildMorningBrief({...base,cases:[kase({symbol:'EXMP',conclusion:'INVESTIGATE'}),kase({symbol:'COST',conclusion:'MONITOR',rules:rules(false,true,true)})]});
 const text=JSON.stringify(r);assert.doesNotMatch(text,/\b(buy|sell|hold|price target|score|probability|confidence)\b/i);
 assert.doesNotMatch(readFileSync('app/brief/page.tsx','utf8'),/\b(buy|sell|price target|probability)\b/i);
 assert.equal(B.keyFact({brief:{evidence:[]},price:{status:'unavailable'}}),null,'no figure means no figure, never a guess');
});
