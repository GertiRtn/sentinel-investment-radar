import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const b=await esbuild.build({entryPoints:['lib/sentinel/event-verify.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const V=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const {verifyEvent,claimOf,filingStage,headlineStage,htmlToText,findSpan,inWindow,notChecked,precheck}=V;

// Research-quality fixture set (fictional companies except where a real headline shape is the point). Independently reviewable;
// it does not measure production accuracy.
const kase=(over={})=>({id:'case-1',symbol:'ACME',createdAt:'2026-11-10T15:00:00.000Z',identity:{cik:'0000000101',name:'Acme Robotics Inc.'},
 event:{headline:'Acme Robotics Signs Supply Agreement With Globex Industries',publishedAt:'2026-11-10T13:00:00.000Z',providerSummary:null,analysis:{topics:['Contract or customer']}},...over});
const doc=(text,name='ex99-1.htm')=>({url:'https://www.sec.gov/Archives/edgar/data/101/000000010126000001/'+name,name,text,capturedAt:'2026-11-12T09:00:00.000Z',rawId:'raw-'+name});
const filing=(over={})=>({accession:'0000000101-26-000001',form:'8-K',filedAt:'2026-11-10',items:'1.01,9.01',indexUrl:'https://www.sec.gov/Archives/edgar/data/101/000000010126000001/index.json',documents:[doc('Acme Robotics Inc. today announced that it has entered into a supply agreement with Globex Industries, Inc. under which Acme will supply actuators. The agreement runs five years.')],...over});
const run=(k,filings,extra={})=>verifyEvent({kase:k,checkedAt:'2026-11-12T09:00:00.000Z',filings,...extra});

test('claims: counterparty after a cue word, amounts verbatim, the company itself excluded, headline stage',()=>{
 assert.deepEqual(claimOf('Acme Robotics Signs Supply Agreement With Globex Industries','Acme Robotics Inc.').counterparties,['Globex Industries']);
 assert.deepEqual(claimOf('Initech Wins $50 Million Contract From US Army','Initech Corp').counterparties,['US Army']);
 assert.deepEqual(claimOf('Initech Wins $50 Million Contract From US Army','Initech Corp').amounts,['$50 Million']);
 assert.deepEqual(claimOf('Hooli to acquire Pied Piper Inc. for $1.2 billion','Hooli').counterparties,['Pied Piper']);
 assert.deepEqual(claimOf('Shares of Acme jump after deal with Acme Robotics','Acme Robotics Inc.').counterparties,[],'the company is not its own counterparty');
 assert.deepEqual(claimOf('Acme Shares Rise From Record Lows','Acme').counterparties,[],'generic title-case words are not names');
 assert.equal(headlineStage('Hooli Explores Sale Of Unit, Bloomberg Reports'),'proposed');
 assert.equal(headlineStage('Hooli to acquire Pied Piper'),'agreed');
 assert.equal(headlineStage('Hooli completes acquisition of Pied Piper'),'completed');
 assert.equal(headlineStage('Hooli terminates merger agreement with Pied Piper'),'cancelled');
 assert.equal(headlineStage('Hooli shares move'),'unknown');
 assert.deepEqual(['1.01,9.01','2.01','1.01,1.02','8.01',null].map(filingStage),['agreed','completed','cancelled','unknown','unknown']);
});

test('text handling: HTML stripped, entities decoded, spans verbatim and bounded, window by calendar day',()=>{
 const t=htmlToText('<html><style>x{}</style><p>Acme&nbsp;and&#160;Globex&amp;Co</p><script>alert(1)</script><div>signed &#8220;today&#8221;</div></html>');
 assert.equal(t,'Acme and Globex&Co signed “today”');assert.ok(!t.includes('alert'));
 const span=findSpan('A. '+'x '.repeat(300)+'It agreed with Globex Industries on terms. More text follows here.','Globex Industries');
 assert.ok(span.includes('Globex Industries'));assert.ok(span.length<=330);
 assert.equal(findSpan('Globexian partners','Globex'),null,'whole words only');
 assert.ok(inWindow('2026-11-08','2026-11-10T22:00:00Z'));assert.ok(inWindow('2026-11-16','2026-11-10T22:00:00Z'));assert.ok(!inWindow('2026-11-17','2026-11-10T22:00:00Z'));assert.ok(!inWindow('2026-11-07','2026-11-10T00:00:00Z'));
});

test('old and unchecked cases read as headline only',()=>{
 const n=notChecked();assert.equal(n.state,'not_checked');assert.match(n.reason,/only the stored headline and provider summary/);assert.deepEqual(n.evidence,[]);
});

test('ams-OSRAM tagged AMS (American Shared Hospital Services): likely wrong company, nothing examined',()=>{
 const k=kase({symbol:'AMS',identity:{cik:'0000744825',name:'AMERICAN SHARED HOSPITAL SERVICES'},event:{headline:'ams-OSRAM AG Announces Divestment Of Sensor Business',publishedAt:'2026-11-10T07:00:00.000Z',analysis:{topics:['Merger or acquisition']}}});
 const r=run(k,[filing()]);assert.equal(r.state,'wrong_company');assert.deepEqual(r.evidence,[]);assert.deepEqual(r.examined,[],'no filing was read');
});

test('an analyst opinion is not a company event and is never verified by a filing',()=>{
 const r=run(kase({event:{headline:'Analyst Raises Acme Robotics Price Target With Globex Deal In View',publishedAt:'2026-11-10T13:00:00.000Z',analysis:{topics:['Analyst opinion']}}}),[filing()]);
 assert.equal(r.state,'not_company_event');assert.deepEqual(r.evidence,[]);
});

test('a direct company-name match alone is not verification: an unrelated 8-K in the window is not enough',()=>{
 const unrelated=filing({items:'5.02',documents:[doc('Acme Robotics Inc. announced that its Chief Financial Officer will retire. Acme Robotics thanks her for her service.','acme-8k.htm')]});
 const r=run(kase(),[unrelated]);assert.equal(r.state,'insufficient');assert.match(r.reason,/none names Globex Industries/);assert.match(r.reason,/not confirmation/);assert.deepEqual(r.evidence,[]);
 const none=run(kase(),[]);assert.equal(none.state,'insufficient');assert.match(none.reason,/does not mean the report is false/);
});

test('an examined matching filing supports the connection, with source, span, dates and point-in-time flags',()=>{
 const r=run(kase(),[filing()]);
 assert.equal(r.state,'supported');assert.equal(r.evidence.length,1);const e=r.evidence[0];
 assert.equal(e.accession,'0000000101-26-000001');assert.match(e.documentUrl,/^https:\/\/www\.sec\.gov\/Archives\//);assert.ok(e.matched[0].span.includes('Globex Industries'));
 assert.equal(e.knownFrom,'2026-11-10T23:59:59.999Z');assert.equal(e.availableAtAssessment,false,'filed later on the day the case was assessed: not known at assessment');assert.equal(e.capturedAt,'2026-11-12T09:00:00.000Z');assert.equal(r.checkedAt,'2026-11-12T09:00:00.000Z');
 assert.equal(r.stage.claimed,'agreed');assert.equal(r.stage.supported,true);assert.match(r.reason,/does not establish the terms/);
 const early=run(kase({createdAt:'2026-11-11T08:00:00.000Z'}),[filing()]);assert.equal(early.evidence[0].availableAtAssessment,true);
});

test('amount alone does not connect a filing to the event',()=>{
 const k=kase({event:{headline:'Acme Robotics Raises $50 Million',publishedAt:'2026-11-10T13:00:00.000Z',analysis:{topics:['Financing']}}});
 const r=run(k,[filing({documents:[doc('Acme Robotics entered into a $50 million credit facility.')]})]);
 assert.equal(r.state,'insufficient');assert.match(r.reason,/no counterparty is named/);
});

test('a proposed deal keeps its stage: a filing that names the party but states no stage does not upgrade it',()=>{
 const k=kase({event:{headline:'Acme Robotics In Talks With Globex Industries Over Possible Merger',publishedAt:'2026-11-10T13:00:00.000Z',analysis:{topics:['Merger or acquisition']}}});
 const r=run(k,[filing({items:'7.01,9.01'})]);assert.equal(r.state,'supported');assert.equal(r.stage.claimed,'proposed');assert.equal(r.stage.supported,false);assert.match(r.stage.text,/state no stage/);
 const agreedOnly=run(kase({event:{headline:'Acme Robotics Completes Acquisition Of Globex Industries',publishedAt:'2026-11-10T13:00:00.000Z',analysis:{topics:['Merger or acquisition']}}}),[filing()]);
 assert.equal(agreedOnly.stage.claimed,'completed');assert.equal(agreedOnly.stage.supported,false,'an agreement filing does not establish completion');assert.match(agreedOnly.stage.text,/report agreed/);
});

test('a later cancellation is a timeline update, not a contradiction; a cancellation before publication conflicts',()=>{
 const cancel=(filedAt,later)=>filing({accession:'0000000101-26-000009',filedAt,items:'1.02',later,documents:[doc('On this date Acme Robotics terminated its supply agreement with Globex Industries.','cancel.htm')]});
 const r=run(kase(),[filing(),cancel('2027-02-01',true)]);
 assert.equal(r.state,'supported');assert.match(r.reason,/later update to the timeline, not a contradiction/);assert.deepEqual(r.timeline.map(t=>t.stage),['agreed','cancelled']);assert.equal(r.evidence.find(e=>e.stage==='cancelled').availableAtAssessment,false);
 const c=run(kase(),[cancel('2026-11-09',false)]);assert.equal(c.state,'conflicting');assert.match(c.reason,/Unresolved/);
});

test('unavailable: SEC unreadable, foreign issuer, no single SEC company, documents unreadable',()=>{
 assert.equal(run(kase(),[],{sourceError:'HTTP 503'}).state,'unavailable');
 assert.equal(run(kase(),[],{foreignIssuer:true}).state,'unavailable');
 assert.equal(run(kase({identity:{cik:null,name:null}}),[]).state,'unavailable');
 const unread=run(kase(),[filing({documents:[{url:'x',name:'ex99.htm',text:null,error:'HTTP 404'}]})]);assert.equal(unread.state,'unavailable');assert.equal(unread.examined[0].documents[0].read,false);
 assert.equal(precheck(kase()),null);
});
