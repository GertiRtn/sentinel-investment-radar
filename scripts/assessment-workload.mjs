// Rows read by ONE assessment-only call (`{"stages":["assessment"]}`), on synthetic data shaped like production.
// Local only: builds a throwaway D1 in Miniflare and runs the same SQL the call runs (queue, lease, stage record, and per
// case: candidate, SEC cache checks, the company file and the Alpaca cache checks). External calls are not made.
// Usage: node scripts/assessment-workload.mjs [candidatesPerHour=125] [factsPerCompany=3000] [filingsPerCompany=1500]
// Fact counts per company measured on real SEC files on 2026-11-26: EMCOR 3,365, Diamondback 2,720, Apple 3,576.
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler/package.json')]}));
const [perHour=125,factsPer=3000,filingsPer=1500]=process.argv.slice(2).map(Number),owner='owner',H=3600000,COMPANIES=6;
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB'],compatibilityDate:'2026-05-15'}),db=await mf.getD1Database('DB');
for(const file of readdirSync('drizzle').filter(s=>s.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(sql).run();
let batch=[];const flush=async()=>{if(batch.length){await db.batch(batch);batch=[]}},push=async s=>{batch.push(s);if(batch.length>=400)await flush();};
const now=Date.now(),iso=ms=>new Date(ms).toISOString(),pad='x'.repeat(900);
// 96 hours of candidates (a third topic-matched), a case for some, plus the other kinds that share signal_log.
for(let h=0;h<96;h++){const at=iso(now-(96-h)*H);
 for(let i=0;i<perHour;i++){const id=`cand-${h}-${i}`,topic=i%3===0;await push(db.prepare("INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'discovery_candidate',NULL,?)").bind(id,owner,at,JSON.stringify({headline:'Fixture '+id,symbols:['S'+(i%400)],priority:topic?'topic match':'unclassified',analysis:{topics:topic?['Earnings or financial results']:[]},providerSummary:pad})));
  if(topic&&i<12)await push(db.prepare("INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'discovery_case',NULL,?)").bind('case-'+id,owner,at,JSON.stringify({candidateId:id,symbol:'S'+(i%400),status:'complete',brief:{pad:pad.repeat(6)}})));}
 for(const s of ['filings','news','discovery','assessment','outcomes','practice','experiment'])await push(db.prepare("INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'pipeline_stage',NULL,?)").bind(`st-${h}-${s}`,owner,at,JSON.stringify({stage:s,status:'complete'})));}
// Companies: entity, SEC runs, facts and filings at the measured sizes.
for(let c=0;c<COMPANIES;c++){const e='sec:000000000'+c;
 await push(db.prepare("INSERT INTO raw_event(id,source,fetched_at,known_from,content_hash,payload,http_status) VALUES(?,?,?,?,?,?,200)").bind('raw-'+c,'sec:x'+c,iso(now),iso(now),'h'+c,'{}'));
 await push(db.prepare("INSERT INTO entity(id,cik,name,tickers,exchanges,sic,created_at,raw_event_id) VALUES(?,?,?,?,?,?,?,?)").bind(e,'000000000'+c,'Company '+c,'["S'+c+'"]','[]','3570',iso(now),'raw-'+c));
 for(let r=0;r<10;r++)await push(db.prepare("INSERT INTO sec_run(id,entity_id,known_from,status,message,raw_event_id) VALUES(?,?,?,?,?,?)").bind(`run-${c}-${r}`,e,iso(now-r*86400000),'success','x','raw-'+c));
 for(let f=0;f<factsPer;f++){const y=2010+(f%16);await push(db.prepare("INSERT INTO financial_fact(id,entity_id,metric,source_tag,value,unit,period_start,period_end,fiscal_year,fiscal_period,form,known_from,filed,accession,raw_event_id,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(`f-${c}-${f}`,e,'m'+(f%40),'Tag'+(f%40),f,'USD',y+'-01-01',y+'-12-31',y,'FY','10-K',(y+1)+'-02-15T23:59:59.999Z',(y+1)+'-02-15','acc-'+c+'-'+f,'raw-'+c,iso(now)));}
 for(let f=0;f<filingsPer;f++)await push(db.prepare("INSERT INTO filing(id,entity_id,accession,form,filed_at,known_from,period_end,items,primary_document,raw_event_id,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(`fl-${c}-${f}`,e,`fl-${c}-${f}`,'8-K','2020-01-01','2020-01-01T23:59:59.999Z',null,null,'x.htm','raw-'+c,iso(now)));}
await flush();
const nowIso=iso(now),since=iso(now-96*H),cooldown=iso(now-6*H);
// The SQL of one assessment-only call (copied from the code paths named on each line).
const call=[
 ['lease: insert-if-missing + conditional update (assessment-lease.ts)',"INSERT OR IGNORE INTO source_state(source,failures) VALUES(?,0)",['sentinel:assessment-lease:'+owner]],
 ['',"UPDATE source_state SET lease_until=?,lease_token=?,checked_at=? WHERE source=? AND (lease_until IS NULL OR lease_until < ?)",[iso(now+300000),'t',nowIso,'sentinel:assessment-lease:'+owner,nowIso]],
 ['queue: topic-matched candidates, 96 h (discoveryQueue)',"SELECT s.id,s.created_at,j.value AS symbol,j.key AS k,json_extract(s.body,'$.analysis.topics') AS topics FROM signal_log s, json_each(s.body,'$.symbols') j WHERE s.owner=? AND s.created_at>? AND s.kind='discovery_candidate' AND json_extract(s.body,'$.priority')='topic match'",[owner,since]],
 ['queue: cases, 96 h',"SELECT json_extract(body,'$.candidateId') AS c,json_extract(body,'$.symbol') AS s FROM signal_log WHERE owner=? AND created_at>? AND kind='discovery_case'",[owner,since]],
 ['queue: attempts, 6 h',"SELECT json_extract(body,'$.candidateId') AS c,json_extract(body,'$.symbol') AS s FROM signal_log WHERE owner=? AND created_at>? AND kind='discovery_attempt'",[owner,cooldown]],
];
const perCase=c=>{const e='sec:000000000'+c;return [
 ['candidate by id',"SELECT body FROM signal_log WHERE id=? AND owner=? AND kind='discovery_candidate'",['cand-1-0',owner]],
 ['Alpaca pause check (batch loop)',"SELECT retry_at FROM source_state WHERE source=?",['alpaca:rate-limit']],
 ['SEC ticker list cache',"SELECT * FROM source_state WHERE source=?",['sec:https://www.sec.gov/files/company_tickers.json']],
 ['discovery ingest marker',"SELECT last_good_at FROM source_state WHERE source=?",['sentinel:discovery-ingest:v1:'+c]],
 ['latest SEC run',"SELECT status FROM sec_run WHERE entity_id=? ORDER BY known_from DESC LIMIT 1",[e]],
 ['company file: entity',"SELECT * FROM entity WHERE id=?",[e]],
 ['company file: SEC runs',"SELECT * FROM sec_run WHERE entity_id=? ORDER BY known_from DESC LIMIT 10",[e]],
 ['company file: facts with a successful run',"SELECT f.* FROM financial_fact f WHERE entity_id=? AND EXISTS(SELECT 1 FROM sec_run s WHERE s.entity_id=f.entity_id AND s.status='success' AND s.raw_event_id=f.raw_event_id AND (?='public' OR s.known_from<=?))",[e,'public',nowIso]],
 ['company file: filings',"SELECT * FROM filing WHERE entity_id=? AND known_from<=? AND (?='public' OR recorded_at<=?) ORDER BY known_from DESC,accession DESC",[e,nowIso,'public',nowIso]],
 ['company file: estimates',"SELECT * FROM maintenance_estimate WHERE entity_id=? AND owner=? AND known_from<=? ORDER BY known_from DESC",[e,owner,nowIso]],
 ['asset cache',"SELECT * FROM source_state WHERE source=?",['alpaca:paper-asset:S'+c]],
 ['quote state',"SELECT * FROM source_state WHERE source=?",['alpaca:iex:S'+c]],
];};
const tail=[
 ['stage record (pipeline-stage-v1)',"INSERT OR IGNORE INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'pipeline_stage',NULL,?)",['pipeline-stage:x:assessment',owner,nowIso,'{}']],
 ['lease release',"UPDATE source_state SET lease_until=NULL,lease_token=NULL WHERE source=? AND lease_token=?",['sentinel:assessment-lease:'+owner,'t']],
 ['run record',"INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'pipeline_run',NULL,?)",['pipeline-run:x',owner,nowIso,'{}']],
];
let total=0;const lines=[];const run=async([name,sql,args])=>{const r=await db.prepare(sql).bind(...args).all();const n=r.meta.rows_read??0;total+=n;if(name)lines.push([name,n]);else lines[lines.length-1][1]+=n;return n;};
for(const q of call)await run(q);
let cases=0;for(let c=0;c<COMPANIES;c++){const before=total;for(const q of perCase(c))await run(q);cases+=total-before;}
for(const q of tail)await run(q);
const signal=(await db.prepare('SELECT COUNT(*) n FROM signal_log').first()).n;
console.log(`synthetic: ${perHour} candidates/hour × 96 h · ${signal.toLocaleString()} signal_log rows · ${COMPANIES} companies × ${factsPer} facts, ${filingsPer} filings`);
for(const [n,v] of lines)console.log(String(v.toLocaleString()).padStart(10)+'  '+n);
console.log(`\nOne assessment-only call (6 cases): about ${total.toLocaleString()} rows read; the 6 cases account for ${cases.toLocaleString()} (${Math.round(cases/COMPANIES).toLocaleString()} each).`);
for(const every of [30,15]){const calls=24*60/every,day=calls*total;console.log(`Every ${every} min: ${calls} calls/day ≈ ${day.toLocaleString()} rows/day for these calls alone${day>=4e6?'  ⚠ near or above a 5,000,000/day free allowance':day>=2.5e6?'  ⚠ more than half of a 5,000,000/day free allowance':''}.`);}
console.log('Not counted: rows read inside a first-time SEC ingest, derived-metric writes, the hourly run\'s other stages. The free allowance figure is from general knowledge, not checked for the Sites platform.');
await mf.dispose();
