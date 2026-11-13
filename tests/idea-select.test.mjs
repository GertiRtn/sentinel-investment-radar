import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const b=await esbuild.build({entryPoints:['lib/sentinel/idea-select.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {selectIdeas,ideaBrief,MAX_IDEAS,CLOSEST_MIN_SCORE}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const now='2026-11-13T15:00:00.000Z';
const c=(id,symbol,over={})=>({id,symbol,createdAt:'2026-11-13T10:00:00.000Z',status:'complete',conclusion:'WAIT',screenVersion:'research-screen-v2',reason:'An eligible price-to-reported-earnings measure is unavailable.',score:70,matchLevel:'named_in_headline',topics:['Earnings or financial results'],priceStatus:'unavailable',securityStatus:'candidate_common',...over});

test('rule-meeting cases come first; close cases follow by evidence; one row per company; never more than five',()=>{
 const r=selectIdeas([c('w1','WAA',{score:85}),c('i1','INV',{conclusion:'INVESTIGATE',score:60}),c('m1','MON',{conclusion:'MONITOR',score:90}),c('i2','INV',{conclusion:'INVESTIGATE',score:55,createdAt:'2026-11-13T11:00:00.000Z'}),c('w2','WAA',{score:70,createdAt:'2026-11-13T12:00:00.000Z'}),...Array.from({length:6},(_,i)=>c('x'+i,'X'+i,{score:60+i}))],now);
 assert.equal(r.version,'idea-select-v1');assert.deepEqual(r.picked.map(p=>[p.symbol,p.tier]),[['INV','meets_rules'],['MON','closest'],['WAA','closest'],['X5','closest'],['X4','closest']]);assert.equal(r.picked.length,MAX_IDEAS);
 assert.equal(r.picked[0].caseId,'i1','the better-evidenced case represents the company');assert.match(r.headline,/1 company meets all three research rules/);
 assert.deepEqual(selectIdeas([c('a','AAA'),c('b','BBB')],now),selectIdeas([c('b','BBB'),c('a','AAA')],now),'input order does not matter');
});
test('left out: wrong company, unconfirmed INVESTIGATE is only "close", analyst-only, old screen, low or missing score, stale and future cases',()=>{
 const r=selectIdeas([c('ams','AMS',{conclusion:'INVESTIGATE',matchLevel:'name_conflict',score:95}),c('tick','TCK',{conclusion:'INVESTIGATE',matchLevel:'ticker_only',score:80}),c('an','ANL',{topics:['Analyst opinion'],score:90}),c('v1','OLD',{screenVersion:'research-screen-v1',conclusion:'INVESTIGATE',score:90}),c('low','LOW',{score:CLOSEST_MIN_SCORE-1}),c('ns','NSC',{score:null}),c('un','UNR',{status:'unresolved',score:80}),c('st','STL',{createdAt:'2026-11-01T10:00:00.000Z',conclusion:'INVESTIGATE'}),c('fu','FUT',{createdAt:'2026-11-14T10:00:00.000Z',conclusion:'INVESTIGATE'})],now);
 assert.deepEqual(r.picked.map(p=>[p.symbol,p.tier]),[['TCK','closest']]);assert.equal(r.counts.wrongCompany,1);assert.equal(r.counts.analystOnly,1);assert.equal(r.counts.olderScreen,1);assert.equal(r.counts.assessed,7);
 assert.match(r.headline,/No case met all three research rules.*is the closest/);
});
test('nothing selected: the summary says why and how many, instead of an empty page',()=>{
 const r=selectIdeas([c('a','AAA',{score:40}),c('b','BBB',{score:null,securityStatus:'unverified'}),c('d','DDD',{score:30,reason:'Recent sourced revenue evidence is incomplete.'}),c('e','EEE',{score:20,status:'unresolved'})],now);
 assert.equal(r.picked.length,0);assert.match(r.headline,/No case met the research rules or came close/);assert.equal(r.counts.notEnoughData,4);
 assert.deepEqual(r.topBlockers.map(x=>x.reason).sort(),['no usable price or earnings figure for a P/E','recent revenue figures missing','security type not confirmed as an ordinary US share']);
 const none=selectIdeas([],now);assert.match(none.headline,/No cases were assessed/);assert.equal(none.counts.assessed,0);
 assert.match(r.note,/not a forecast/);assert.match(r.note,/does not mean a share is cheap/);
});
test('compact card: only valid changes with period and filing link; P/E basis stated; no forecast or instruction wording',()=>{
 const kase={id:'k',symbol:'FIX',createdAt:now,conclusion:'INVESTIGATE',identity:{name:'Fixture Corp'},event:{headline:'Fixture Corp reports results',url:'https://example.test/n',source:'Fixture',publishedAt:now,analysis:{topics:['Earnings or financial results']}},price:{status:'indicative',ratio:20,basis:'last_close',priceLabel:'IEX close 2026-11-12',periodEnd:'2025-12-31'}};
 const row=(label,changePct)=>({label,changePct,comparison:'prior year',latest:{period:{end:'2025-12-31'},source:{accession:'a-1',url:'https://www.sec.gov/x'},sourceTime:'2026-02-01T23:59:59.999Z'}});
 const context={business:[row('Revenue (year)',12.5),row('Net income (year)',null),row('Operating cash flow (year)',-3),row('Operating income (year)',4),row('Revenue (quarter)',9)]};
 const idea={eventMatch:{confirmed:true,label:'Company named in the headline',reason:'x'},security:{text:'Ordinary US share'},view:{tone:'research',label:'Worth your research time now',text:'It meets all three research rules.'},counter:[{text:'The price may already reflect this news.',detail:'d'}],missing:['m1','m2','m3'],nextChecks:['Read the original report.','second']};
 const card=ideaBrief(kase,context,idea,{score:85,band:'Strong evidence',coverage:100},'meets_rules');
 assert.deepEqual(card.changes.map(x=>x.label),['Revenue (year)','Operating cash flow (year)','Operating income (year)']);assert.equal(card.changes[0].url,'https://www.sec.gov/x');assert.equal(card.changes[0].filed,'2026-02-01');assert.equal(card.changes[0].periodEnd,'2025-12-31');
 assert.equal(card.valuation.lastClose,true);assert.equal(card.valuation.value,20);assert.match(card.expectations,/^Unknown/);assert.equal(card.missing.length,2);assert.equal(card.nextCheck,'Read the original report.');assert.equal(card.kind.label,'Event-driven');assert.match(card.score.meaning,/Not a chance of gain/);
 const bare=ideaBrief({...kase,price:{status:'unavailable',reason:'No quote.'}},{business:[]},{...idea,counter:[]},{score:null,coverage:30},'closest');
 assert.equal(bare.valuation.status,'unavailable');assert.equal(bare.counterpoint,null);assert.match(bare.changesNote,/No valid year-on-year comparison/);assert.equal(bare.score.score,null);
 const text=JSON.stringify([card,bare]).toLowerCase();for(const banned of ['buy','sell','price target','probability','expected return','undervalued','upside of'])assert.ok(!text.includes(banned),banned);
});
