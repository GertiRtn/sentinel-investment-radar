import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const load=async entry=>{const b=await esbuild.build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm'});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));};
const M=await load(`export * from './lib/sentinel/event-match';export * from './lib/sentinel/news-direction';export * from './lib/sentinel/news-assessment';export {researchDecisionV2} from './lib/sentinel/price-assessment';export * from './lib/sentinel/verified-party';export * from './lib/sentinel/label-dry-run';`);
const {eventMatch,eventMatchV1,caseEventMatch,newsDirection,caseNewsDirection,showableAsIdea,assessNews,assessCompanyRelevance,analystOpinion,researchDecisionV2,verifiedParty,labelDryRun}=M;

// Constructed headlines (the founder's fixtures), not stored cases.
/** Everything the labels decide for one headline and SEC company, plus the screen's R1 and R2. */
function labels(headline,company,symbol){
 const relevance=assessCompanyRelevance(headline,company,symbol),match=eventMatch({headline,companyName:company,symbol}),direction=newsDirection({headline}),topics=assessNews({id:'x',headline}).topics;
 const rules=researchDecisionV2({identity:{relevance},price:{status:'indicative',ratio:20},brief:{stale:false,evidence:[{label:'Revenue',value:1,periodEnd:'2026-09-30'}]},asOf:'2026-11-26T00:00:00Z',topics}).rules;
 return {match,relevance,direction,topics,R1:rules.find(r=>r.id==='R1').passed,R2:rules.find(r=>r.id==='R2').passed};
}

test('a first word alone is "Partial name only": not confirmed, R2 fails',()=>{
 for(const [h,name,sym] of [['Apple Reports Record Quarterly Revenue','Apple Hospitality REIT, Inc.','APLE'],['Target Raises Full-Year Outlook','Target Hospitality Corp.','TH'],['Meta Announces Quarterly Dividend','Meta Materials Inc.','MMAT']]){
  const l=labels(h,name,sym);
  assert.equal(l.match.level,'partial_name_only',h);assert.equal(l.match.confirmed,false);assert.equal(l.match.label,'Partial name only — not confirmed');assert.equal(l.match.version,'event-match-v2');
  assert.equal(l.R2,false,h);assert.equal(l.relevance.level,'review');assert.equal(l.relevance.version,'headline-relevance-v4');
  // Under v1 these were "named in headline": the change is real.
  assert.equal(eventMatchV1({headline:h,companyName:name,symbol:sym}).level,'named_in_headline');
 }
});

test('the full name or a recognised ticker form is "named in headline"',()=>{
 const l=labels('Apple Reports Record Quarterly Revenue','Apple Inc.','AAPL');
 assert.equal(l.match.level,'named_in_headline');assert.equal(l.match.confirmed,true);assert.equal(l.relevance.level,'direct_candidate');assert.equal(l.relevance.role,'possible event subject');
 assert.equal(l.direction.direction,'positive');assert.equal(l.R1,true);assert.equal(l.R2,true);
 for(const h of ['Hospitality REIT (APLE) Reports Record Revenue','Shares rise as NASDAQ: APLE reports record revenue','NYSE:APLE reports record revenue'])
  assert.equal(eventMatch({headline:h,companyName:'Apple Hospitality REIT, Inc.',symbol:'APLE'}).level,'named_in_headline',h);
 assert.equal(eventMatch({headline:'Hotel REIT profits rise',companyName:'Apple Hospitality REIT, Inc.',symbol:'APLE'}).level,'ticker_only','no name and no ticker form: ticker tag only');
 assert.equal(eventMatch({headline:'Profits at aple rise',companyName:'Apple Hospitality REIT, Inc.',symbol:'APLE'}).level,'name_conflict','a lower-case use of the letters is the unchanged name-conflict rule, not a ticker form');
 assert.equal(eventMatch({headline:'Apple Hospitality REIT Reports Results',companyName:'Apple Hospitality REIT, Inc.',symbol:'APLE'}).level,'named_in_headline');
});

test('analyst opinion runs first: "Analyst opinion", "Not company news", "Mentioned", never R1, never good news',()=>{
 for(const [h,name,sym] of [['Goldman Sachs Upgrades Apple to Buy','Apple Inc.','AAPL'],['JPMorgan Raises Price Target on Nvidia','JPMORGAN CHASE & CO','JPM'],['Morgan Stanley Raises Nvidia Price Target After Earnings Beat','NVIDIA CORP','NVDA']]){
  const l=labels(h,name,sym);
  assert.deepEqual(l.topics,['Analyst opinion'],h);assert.equal(l.R1,false,h);
  assert.equal(l.direction.direction,'not_company_news');assert.equal(l.direction.label,'Not company news');assert.equal(showableAsIdea(l.direction),false);
  assert.equal(l.relevance.level,'review');assert.equal(l.relevance.role,'mentioned company');assert.equal(l.R2,false);
 }
 assert.equal(newsDirection({headline:'Goldman Sachs Upgrades Apple to Buy'}).direction,'not_company_news','v1 called it good news (acquisition words)');
 // The detection words are never shown: nothing displayed names them.
 const shown=JSON.stringify([newsDirection({headline:'Goldman Sachs Upgrades Apple to Buy'}),assessCompanyRelevance('Goldman Sachs Upgrades Apple to Buy','Apple Inc.','AAPL')].map(x=>[x.label,x.text,x.reason]));
 assert.ok(!/\b(buy|sell|hold|upgrade|price target|rating|outperform|overweight)\b/i.test(shown),shown);
});

test('analyst-opinion patterns, exceptions and the two narrowed forms',()=>{
 for(const h of ['Company Hosts Analyst Day','XYZ to Host Investor Day in New York']) {assert.equal(analystOpinion(h),false,h);assert.notEqual(newsDirection({headline:h}).direction,'not_company_news');}
 for(const h of ['Analyst says XYZ is fairly valued','Bank initiates coverage of XYZ','XYZ downgrades follow results','Moody’s affirms XYZ rating','XYZ cut to Sell at Bank','XYZ raised to Outperform','XYZ moved to Overweight from Neutral','XYZ upgraded to Buy'])
  assert.equal(analystOpinion(h),true,h);
 // Narrowed (see PR): "to Hold/Buy/Sell" is a rating only at the end or before rating words; a results comparison with analysts is not an opinion.
 for(const h of ['XYZ to Hold Third Quarter Earnings Conference Call','Microsoft to Buy Activision for $69 Billion','XYZ to Sell Unit to Partner','XYZ Revenue Tops Analyst Estimates'])
  assert.equal(analystOpinion(h),false,h);
 assert.equal(labels('XYZ Revenue Tops Analyst Estimates','XYZ Corp','XYZ').R1,true,'an earnings beat keeps its topic');
});

test('event role: wording only, labelled "not verified"; an affected party stays an affected party',()=>{
 // The brief's headline names only "Activision"; the SEC name is "Activision Blizzard". Under rule 1 that is a first
 // word alone, so it is "Partial name only" with no role (listed in the PR). With the full name it is an affected party.
 const short=labels('Microsoft to Acquire Activision','ACTIVISION BLIZZARD, INC.','ATVI');
 assert.equal(short.match.level,'partial_name_only');assert.equal(short.relevance.level,'review');assert.equal(short.relevance.label,'Role from headline wording: not verified');
 const r=assessCompanyRelevance('Microsoft to Acquire Activision Blizzard','ACTIVISION BLIZZARD, INC.','ATVI');
 assert.equal(r.level,'direct_candidate');assert.equal(r.role,'possible affected party');assert.equal(r.label,'Role from headline wording: not verified');assert.equal(r.basis,'headline wording');
 assert.equal(labels('Microsoft to Acquire Activision Blizzard','ACTIVISION BLIZZARD, INC.','ATVI').R2,true,'verification is not a requirement for R2');
});

test('ams-OSRAM tagged AMS is still a name conflict',()=>{
 const m=eventMatch({headline:'ams-OSRAM to cut 500 jobs',companyName:'AMERICAN SHARED HOSPITAL SERVICES',symbol:'AMS'});
 assert.equal(m.level,'name_conflict');assert.equal(m.evidence,'ams-OSRAM');
});

test('old stored labels are read as stored when current, else recomputed and labelled; nothing is written',()=>{
 const old={event:{headline:'Goldman Sachs Upgrades Apple to Buy'},identity:{name:'Apple Inc.'},symbol:'AAPL',eventMatch:{version:'event-match-v1',level:'named_in_headline',label:'Company named in the headline'},newsDirection:{version:'news-direction-v1',direction:'positive',label:'Good news'}};
 const frozen=JSON.stringify(old);
 const m=caseEventMatch(old),d=caseNewsDirection(old);
 assert.equal(m.label,'Company named in the headline (recomputed with event-match-v2)');assert.equal(m.recomputedWith,'event-match-v2');
 assert.equal(d.direction,'not_company_news');assert.equal(d.label,'Not company news (recomputed with news-direction-v2)');assert.equal(d.storedVersion,'news-direction-v1');
 assert.equal(JSON.stringify(old),frozen,'the stored case object is not changed');
 const cur={...old,eventMatch:{version:'event-match-v2',level:'named_in_headline',label:'Company named in the headline'},newsDirection:{version:'news-direction-v2',direction:'not_company_news',label:'Not company news'}};
 assert.equal(caseEventMatch(cur).label,'Company named in the headline');assert.equal(caseNewsDirection(cur).label,'Not company news');
});

test('verified party: only from an existing filing check, an 8-K or 10-Q by the company within 2 days naming the other party',()=>{
 const kase={event:{publishedAt:'2026-11-10T14:00:00Z'}};
 const ev=(over={})=>({form:'8-K',filedAt:'2026-11-11',accession:'0000000001-26-000010',documentUrl:'https://www.sec.gov/x',matched:[{kind:'counterparty',term:'Activision Blizzard',span:'…'}],...over});
 const check=(evidence,state='supported')=>({version:'event-verify-v1',state,label:'Supported by a company filing',checkedAt:'2026-11-12T00:00:00Z',evidence});
 const ok=verifiedParty(kase,check([ev()]));assert.equal(ok.state,'verified');assert.equal(ok.party,'Activision Blizzard');assert.equal(ok.label,'Verified party: Activision Blizzard');
 assert.equal(verifiedParty(kase,check([ev({form:'10-Q'})])).state,'verified');
 for(const [why,v] of [['no check',null],['not supported',check([ev()],'insufficient')],['filed 3 days later',check([ev({filedAt:'2026-11-13'})])],['other form',check([ev({form:'S-4'})])],['amount only',check([ev({matched:[{kind:'amount',term:'$1 billion',span:'…'}]})])],['filing type alone',check([ev({matched:[]})])]])
  assert.equal(verifiedParty(kase,v).state,'not_verified',why);
 assert.equal(verifiedParty(kase,null).label,'Not verified');
});

test('dry run: counts by rule, and no headline, id, symbol or company name in the output',()=>{
 const rows=[
  {headline:'Apple Reports Record Quarterly Revenue',summary:null,companyName:'Apple Hospitality REIT, Inc.',symbol:'APLE',storedMatch:{version:'event-match-v1',level:'named_in_headline'},storedDirection:{version:'news-direction-v1',direction:'positive'},storedRelevance:{version:'headline-relevance-v3',level:'direct_candidate',role:'possible event subject'},topics:['Earnings or financial results']},
  {headline:'Goldman Sachs Upgrades Apple to Buy',summary:null,companyName:'Apple Inc.',symbol:'AAPL',storedMatch:{version:'event-match-v1',level:'named_in_headline'},storedDirection:{version:'news-direction-v1',direction:'positive'},storedRelevance:{version:'headline-relevance-v3',level:'direct_candidate',role:'possible event subject'},topics:['Analyst opinion']},
  {headline:'Morgan Stanley Raises Nvidia Price Target After Earnings Beat',summary:null,companyName:'NVIDIA CORP',symbol:'NVDA',storedMatch:null,storedDirection:null,storedRelevance:{version:'headline-relevance-v3',level:'review',role:'mentioned company'},topics:['Earnings or financial results','Analyst opinion']},
  {headline:'Apple Reports Record Quarterly Revenue',summary:null,companyName:'Apple Inc.',symbol:'AAPL',storedMatch:{version:'event-match-v1',level:'named_in_headline'},storedDirection:{version:'news-direction-v1',direction:'positive'},storedRelevance:{version:'headline-relevance-v3',level:'direct_candidate',role:'possible event subject'},topics:['Earnings or financial results']},
  {headline:'ams-OSRAM to cut 500 jobs',summary:null,companyName:'AMERICAN SHARED HOSPITAL SERVICES',symbol:'AMS',storedMatch:{version:'event-match-v1',level:'name_conflict'},storedDirection:null,storedRelevance:null,topics:[]},
 ];
 const r=labelDryRun(rows,'2026-11-26T00:00:00Z');
 assert.equal(r.cases,5);assert.equal(r.match.compared,5);assert.equal(r.match.changed,1);assert.deepEqual(r.match.transitions,{'named_in_headline → partial_name_only':1});
 assert.deepEqual(r.analyst,{flagged:2,directionWouldChange:2,materialTopicWouldBeDropped:1,directRoleWouldBecomeMentioned:1});
 assert.equal(r.role.compared,4);assert.equal(r.role.notAssessed,1);assert.equal(r.role.changed,2);assert.deepEqual(r.role.byCause,{analystOpinion:1,nameRule:1});
 const text=JSON.stringify(r);for(const x of ['Apple','Goldman','Nvidia','NVDA','AAPL','APLE','ams-OSRAM','AMERICAN','Hospitality'])assert.ok(!text.includes(x),x);
});
