import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const load=async f=>{const b=await esbuild.build({entryPoints:[f],bundle:true,write:false,platform:'node',format:'esm'});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));};
const {newsDirection,caseNewsDirection,showableAsIdea}=await load('lib/sentinel/news-direction.ts');
const {selectIdeas}=await load('lib/sentinel/idea-select.ts');
const {rankCases}=await load('lib/sentinel/discover-rank.ts');
const d=h=>newsDirection({headline:h}).direction;

test('good news: deals, wins, beats, raised guidance, approvals, growing results (real headline shapes)',()=>{
 for(const h of ['EMCOR To Acquire P1 Construction In All-Cash Deal; Terms Not Disclosed','Acme Wins $50 Million Contract From US Army','Acme Beats Analyst Estimates, Raises Full-Year Guidance',
  'Acme Receives FDA Approval For Lead Drug','Acme Reports Record Quarterly Revenue','Acme And Globex Announce Merger Agreement','Acme Announces $500 Million Share Repurchase Program','Acme Q3 Revenue Rose 28% On Data Centre Demand'])
  assert.equal(d(h),'positive',h);
});

test('bad news: scandal and solvency are always bad, even with good words',()=>{
 for(const h of ['SEC Charges Acme With Accounting Fraud','Acme Faces Class Action Lawsuit Over Disclosures','Acme To Restate Three Years Of Results','Acme Receives Nasdaq Deficiency Notice',
  'Acme Files For Chapter 11 Bankruptcy','Short Seller Report Targets Acme','Acme Recalls 2 Million Devices','Acme Under Investigation; Wins New Contract']){
  const r=newsDirection({headline:h});assert.equal(r.direction,'negative',h);assert.equal(r.scandal,true,h);assert.match(r.label,/scandal/);}
});

test('bad news for the business, not a scandal',()=>{
 for(const h of ['Acme Misses Estimates As Demand Weakens','Acme Cuts Full-Year Guidance','Acme To Lay Off 1,200 Workers','Acme Terminates Merger With Globex','Acme CEO Steps Down Effective Immediately',
  'Acme Shares Plunge After Trial Data','Acme Prices $200 Million Public Offering','Acme Revenue Falls 12% In Third Quarter']){
  const r=newsDirection({headline:h});assert.equal(r.direction,'negative',h);assert.equal(r.scandal,false,h);}
});

test('mixed and neutral; the summary is used only when the headline says nothing',()=>{
 assert.equal(d('Acme Beats Estimates But Cuts Guidance'),'mixed');assert.equal(d('Acme Denied FDA Approval For Lead Drug'),'mixed');
 assert.equal(d('Siebert Financial Corp. Reports Third Quarter 2026 Financial Results'),'neutral');
 const s=newsDirection({headline:'Acme Reports Third Quarter Results',summary:'Revenue rose 18% to $40.2 million.'});assert.equal(s.direction,'positive');assert.equal(s.basis,'summary');assert.match(s.text,/provider summary/);
 const h=newsDirection({headline:'Acme Wins Contract',summary:'The company also disclosed an SEC investigation.'});assert.equal(h.direction,'positive','a headline with a clear direction is not overridden by the summary');
 assert.equal(newsDirection({}).direction,'neutral');assert.match(newsDirection({headline:'Acme Wins Contract'}).note,/does not guarantee/);
 assert.equal(showableAsIdea({direction:'positive'}),true);assert.equal(showableAsIdea({direction:'neutral'}),true);assert.equal(showableAsIdea({direction:'negative'}),false);assert.equal(showableAsIdea({direction:'mixed'}),false);
 assert.equal(caseNewsDirection({newsDirection:{version:'news-direction-v2',direction:'negative'},event:{headline:'Acme Wins Contract'}}).direction,'negative','the stored label of the current version wins');
 const old=caseNewsDirection({newsDirection:{version:'news-direction-v1',direction:'negative'},event:{headline:'Acme Wins Contract'}});assert.equal(old.direction,'positive');assert.equal(old.label,'Good news (recomputed with news-direction-v2)');
});

const NOW='2026-11-15T12:00:00.000Z',lc=(id,o={})=>({id,symbol:id.toUpperCase(),createdAt:'2026-11-14T12:00:00.000Z',status:'complete',conclusion:'INVESTIGATE',screenVersion:'research-screen-v2',reason:null,score:80,matchLevel:'named_in_headline',topics:['Acquisition or transaction'],priceStatus:'indicative',securityStatus:'candidate_common',direction:'positive',...o});
test('ideas: only good news meets the rules; neutral at most closest; bad and mixed never shown but counted',()=>{
 const r=selectIdeas([lc('good'),lc('flat',{direction:'neutral'}),lc('bad',{direction:'negative'}),lc('mix',{direction:'mixed'})],NOW);
 assert.deepEqual(r.picked.map(p=>[p.symbol,p.tier]),[['GOOD','meets_rules'],['FLAT','closest']]);assert.equal(r.counts.badNews,2);assert.equal(r.counts.meetsRules,1);assert.equal(r.version,'idea-select-v2');
});

test('Discover: bad or mixed news listed after the rest, wrong company still last',()=>{
 const c=(sym,headline,o={})=>({id:'c-'+sym,symbol:sym,createdAt:'2026-11-14T12:00:00.000Z',conclusion:'INVESTIGATE',decision:{version:'research-screen-v2'},identity:{name:sym+' Corp'},event:{headline},...o});
 const r=rankCases([c('BAD','BAD Corp Faces Class Action Lawsuit'),c('GOOD','GOOD Corp Wins Contract'),c('AMS','ams-OSRAM AG sells unit',{identity:{name:'AMERICAN SHARED HOSPITAL SERVICES'}})],NOW);
 assert.deepEqual(r.rows.map(x=>x.symbol),['GOOD','BAD','AMS']);assert.equal(r.rows[1].newsDirection.direction,'negative');assert.equal(r.version,'discover-rank-v3');
});
