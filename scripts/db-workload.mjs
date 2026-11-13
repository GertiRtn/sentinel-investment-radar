// Measures how many rows the hourly run's main queries read, on synthetic data shaped like production.
// Usage: node scripts/db-workload.mjs [candidates=7000,50000]. Local only: it builds a throwaway D1 in Miniflare.
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {Miniflare}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler/package.json')]}));
const sizes=(process.argv[2]||'7000,50000').split(',').map(Number),owner='owner',H=3600000,DAY=24*H;
const Q={
 'assess queue pick (x6 per run), as on main':{n:6,sql:`SELECT s.id,s.body,j.value symbol FROM signal_log s, json_each(s.body,'$.symbols') j WHERE s.owner=? AND s.kind='discovery_candidate' AND json_extract(s.body,'$.priority')='topic match' AND NOT EXISTS (SELECT 1 FROM signal_log a WHERE a.owner=s.owner AND a.kind='discovery_attempt' AND json_extract(a.body,'$.candidateId')=s.id AND json_extract(a.body,'$.symbol')=j.value AND a.created_at>?) AND NOT EXISTS (SELECT 1 FROM signal_log c WHERE c.owner=s.owner AND c.kind='discovery_case' AND json_extract(c.body,'$.candidateId')=s.id AND json_extract(c.body,'$.symbol')=j.value) ORDER BY CASE WHEN json_extract(s.body,'$.analysis.topics') LIKE '%Earnings or financial results%' THEN 0 ELSE 1 END, s.created_at DESC,s.id ASC,j.key ASC LIMIT 1`,args:now=>[owner,new Date(now-6*H).toISOString()]},
 'assess queue pick (x6), last 72 h only':{n:6,sql:`SELECT s.id,s.body,j.value symbol FROM signal_log s, json_each(s.body,'$.symbols') j WHERE s.owner=? AND s.created_at>? AND s.kind='discovery_candidate' AND json_extract(s.body,'$.priority')='topic match' AND NOT EXISTS (SELECT 1 FROM signal_log a WHERE a.owner=s.owner AND a.kind='discovery_attempt' AND json_extract(a.body,'$.candidateId')=s.id AND json_extract(a.body,'$.symbol')=j.value AND a.created_at>?) AND NOT EXISTS (SELECT 1 FROM signal_log c WHERE c.owner=s.owner AND c.kind='discovery_case' AND json_extract(c.body,'$.candidateId')=s.id AND json_extract(c.body,'$.symbol')=j.value) ORDER BY CASE WHEN json_extract(s.body,'$.analysis.topics') LIKE '%Earnings or financial results%' THEN 0 ELSE 1 END, s.created_at DESC,s.id ASC,j.key ASC LIMIT 1`,args:now=>[owner,new Date(now-72*H).toISOString(),new Date(now-6*H).toISOString()]},
 'NEW queue: candidates in last 96 h (x1 per run)':{n:1,sql:"SELECT s.id,s.created_at,j.value AS symbol,j.key AS k,json_extract(s.body,'$.analysis.topics') AS topics FROM signal_log s, json_each(s.body,'$.symbols') j WHERE s.owner=? AND s.created_at>? AND s.kind='discovery_candidate' AND json_extract(s.body,'$.priority')='topic match'",args:now=>[owner,new Date(now-96*H).toISOString()]},
 'NEW queue: cases in last 96 h (x1)':{n:1,sql:"SELECT json_extract(body,'$.candidateId') AS c,json_extract(body,'$.symbol') AS s FROM signal_log WHERE owner=? AND created_at>? AND kind='discovery_case'",args:now=>[owner,new Date(now-96*H).toISOString()]},
 'NEW queue: attempts in last 6 h (x1)':{n:1,sql:"SELECT json_extract(body,'$.candidateId') AS c FROM signal_log WHERE owner=? AND created_at>? AND kind='discovery_attempt'",args:now=>[owner,new Date(now-6*H).toISOString()]},
 'latest checkpoint':{n:1,sql:"SELECT body FROM signal_log WHERE owner=? AND kind='discovery_checkpoint' ORDER BY created_at DESC,id DESC LIMIT 1",args:()=>[owner]},
 'outcomes: due cases (oldest 400)':{n:1,sql:"SELECT id,created_at,json_extract(body,'$.symbol') AS symbol FROM signal_log WHERE owner=? AND kind='discovery_case' AND created_at<=? AND json_extract(body,'$.status')='complete' ORDER BY created_at ASC,id ASC LIMIT 400",args:now=>[owner,new Date(now-8*DAY).toISOString()]},
 'outcomes: recorded keys':{n:1,sql:"SELECT json_extract(body,'$.caseId') AS c FROM signal_log WHERE owner=? AND kind='discovery_outcome'",args:()=>[owner]},
 'practice records (mark)':{n:1,sql:"SELECT kind,body FROM signal_log WHERE owner=? AND kind IN ('practice_trade','practice_review','practice_mark') ORDER BY created_at,id",args:()=>[owner]},
 'experiment ledger (4 reads)':{n:4,sql:"SELECT body FROM signal_log WHERE owner=? AND kind='auto_practice_decision' ORDER BY created_at,id",args:()=>[owner]},
 'experiment candidates (last 6 days of cases)':{n:1,sql:"SELECT id,created_at,json_extract(body,'$.symbol') symbol FROM signal_log WHERE owner=? AND kind='discovery_case' AND created_at>? ORDER BY created_at ASC,id ASC LIMIT 800",args:now=>[owner,new Date(now-6*DAY).toISOString()]},
 'page view: queue count (Brief and Discover)':{n:0,sql:"SELECT COUNT(*) AS n FROM signal_log s, json_each(s.body,'$.symbols') j WHERE s.owner=? AND s.kind='discovery_candidate' AND json_extract(s.body,'$.priority')='topic match' AND NOT EXISTS(SELECT 1 FROM signal_log c WHERE c.owner=s.owner AND c.kind='discovery_case' AND json_extract(c.body,'$.candidateId')=s.id AND json_extract(c.body,'$.symbol')=j.value)",args:()=>[owner]},
};
const INDEX='CREATE INDEX IF NOT EXISTS signal_owner_kind_time ON signal_log(owner,kind,created_at)';
for(const size of sizes){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB'],compatibilityDate:'2026-05-15'}),db=await mf.getD1Database('DB');
 for(const file of readdirSync('drizzle').filter(s=>s.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(sql).run();
 const now=Date.now(),perHour=125,hours=Math.ceil(size/perHour),pad='x'.repeat(900);let batch=[];const flush=async()=>{if(batch.length){await db.batch(batch);batch=[]}};
 const ins=(id,at,kind,body)=>{batch.push(db.prepare('INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,?,NULL,?)').bind(id,owner,at,kind,JSON.stringify(body)));};
 let cases=0;
 for(let h=0;h<hours;h++){const at=new Date(now-(hours-h)*H).toISOString();
  for(let i=0;i<perHour;i++){const id=`cand-${h}-${i}`,topic=i%3===0;ins(id,at,'discovery_candidate',{headline:'Fixture headline '+id,symbols:['S'+(i%400)],priority:topic?'topic match':'unclassified',analysis:{topics:topic?[i%6===0?'Earnings or financial results':'Analyst opinion']:[]},providerSummary:pad});
   if(topic&&i<18){cases++;ins(`case-${h}-${i}`,at,'discovery_case',{candidateId:id,symbol:'S'+(i%400),status:'complete',conclusion:'WAIT',event:{headline:'x'},brief:{pad:pad.repeat(8)}});}}
  ins('cp-'+h,at,'discovery_checkpoint',{completed:true});if(h%24===0)ins('mark-'+h,at,'practice_mark',{date:at.slice(0,10)});
  if(batch.length>=400)await flush();}
 await flush();
 const total=(await db.prepare('SELECT COUNT(*) n FROM signal_log').first()).n;
 console.log(`\n=== ${size} candidates over ${(hours/24).toFixed(1)} days · ${total} signal_log rows · ${cases} cases ===`);
 const measure=async label=>{let perRun=0;const out=[];for(const [name,q] of Object.entries(Q)){const r=await db.prepare(q.sql).bind(...q.args(now)).all();const plan=(await db.prepare('EXPLAIN QUERY PLAN '+q.sql).bind(...q.args(now)).all()).results.map(p=>p.detail).filter(d=>/signal_log|SCAN|SEARCH s|SEARCH signal/.test(d))[0]||'';perRun+=r.meta.rows_read*q.n;out.push([name,r.meta.rows_read,q.n,r.meta.rows_read*q.n,Math.round(r.meta.duration*10)/10,plan.replace(/\s+/g,' ').slice(0,70)]);}
  console.log(`-- ${label}: about ${perRun.toLocaleString()} rows read per hourly run, ${(perRun*24).toLocaleString()} per day (these queries only)`);for(const o of out)console.log('  '+String(o[1]).padStart(7)+' rows × '+o[2]+'  '+String(o[4]).padStart(6)+' ms  '+o[0]+'   ['+o[5]+']');};
 await measure('schema on main');
 const t=Date.now();await db.prepare(INDEX).run();console.log(`   (index built in ${Date.now()-t} ms; append-only triggers still present: ${(await db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger'").first()).n})`);
 await measure('with signal_owner_kind_time');
 await mf.dispose();
}
