import {database,iso} from '@/db/store';
import {identity,json,failure} from '@/lib/sentinel/api';
import {buildFollowing,CHANGE_WINDOW_DAYS,type FollowInput} from '@/lib/sentinel/thesis-monitor';
import {caseEvidenceScore} from '@/lib/sentinel/evidence-score';
import {friendlyLabel} from '@/lib/sentinel/screen-label';
export const dynamic='force-dynamic';

/** Followed companies: thesis status from the owner's kill criteria, plus what changed this week. Stored records only. */
export async function GET(request:Request){
 try{
  const owner=await identity(request),db=database(),now=iso(),since=new Date(Date.now()-CHANGE_WINDOW_DAYS*86400000).toISOString();
  const entities=(await db.prepare("SELECT DISTINCT e.id,e.name,e.tickers FROM entity_watch w JOIN entity e ON e.id=w.entity_id WHERE w.owner=? ORDER BY e.name LIMIT 50").bind(owner).all<{id:string;name:string;tickers:string}>()).results;
  const items:FollowInput[]=[];
  for(const e of entities){
   let ticker:string|null=null;try{ticker=JSON.parse(e.tickers)?.[0]??null}catch{}
   const memo=await db.prepare("SELECT thesis,known_from FROM research_memo WHERE owner=? AND entity_id=? AND known_from<=? ORDER BY known_from DESC LIMIT 1").bind(owner,e.id,now).first<{thesis:string;known_from:string}>();
   const crit=(await db.prepare("SELECT c.id,c.predicate_json FROM kill_criterion c JOIN research_memo m ON m.id=c.memo_id WHERE m.owner=? AND m.entity_id=? AND c.known_from<=? AND NOT EXISTS(SELECT 1 FROM kill_criterion n WHERE n.supersedes_id=c.id AND n.known_from<=?)").bind(owner,e.id,now,now).all<{id:string;predicate_json:string}>()).results;
   const criteria=[];
   for(const c of crit){
    const v=await db.prepare("SELECT result,reason,evaluated_at,snapshot_json FROM criterion_evaluation WHERE kill_criterion_id=? AND evaluated_at<=? ORDER BY as_of DESC,evaluated_at DESC,id DESC LIMIT 1").bind(c.id,now).first<{result:string;reason:string;evaluated_at:string;snapshot_json:string}>();
    let snapshot:any=null;try{snapshot=v?JSON.parse(v.snapshot_json):null}catch{}
    criteria.push({id:c.id,predicate:c.predicate_json,latest:v?{result:v.result,reason:v.reason,evaluatedAt:v.evaluated_at,snapshot}:null});
   }
   const changes:FollowInput['changes']=[];
   for(const f of (await db.prepare("SELECT form,filed_at,accession FROM filing WHERE entity_id=? AND recorded_at>=? AND recorded_at<=? ORDER BY filed_at DESC LIMIT 5").bind(e.id,since,now).all<{form:string;filed_at:string;accession:string}>()).results)
    changes.push({kind:'filing',at:f.filed_at,text:`New ${f.form} filed ${f.filed_at} (${f.accession})`,url:null});
   for(const r of (await db.prepare("SELECT body FROM signal_log WHERE owner=? AND kind='news_observation' AND entity=? AND created_at>=? ORDER BY created_at DESC LIMIT 3").bind(owner,e.id,since).all<{body:string}>()).results){const n=JSON.parse(r.body);if(n.headline)changes.push({kind:'news',at:n.publishedAt??null,text:n.headline,url:n.url??null});}
   for(const a of (await db.prepare("SELECT a.known_from,a.body FROM criterion_alert a JOIN criterion_evaluation v ON v.id=a.evaluation_id JOIN kill_criterion c ON c.id=v.kill_criterion_id JOIN research_memo m ON m.id=c.memo_id WHERE a.owner=? AND m.entity_id=? AND a.known_from>=? ORDER BY a.known_from DESC LIMIT 3").bind(owner,e.id,since).all<{known_from:string;body:string}>()).results){const b=JSON.parse(a.body);changes.push({kind:'alert',at:a.known_from,text:`Kill-criterion alert: ${b.title??'condition met'}`,url:null});}
   if(ticker)for(const r of (await db.prepare("SELECT id,created_at,body FROM signal_log WHERE owner=? AND kind='discovery_case' AND json_extract(body,'$.symbol')=? AND created_at>=? ORDER BY created_at DESC LIMIT 2").bind(owner,ticker,since).all<{id:string;created_at:string;body:string}>()).results){const c={...JSON.parse(r.body),id:r.id,createdAt:r.created_at},s=caseEvidenceScore(c);changes.push({kind:'case',at:c.event?.publishedAt??r.created_at,text:`Sentinel case: ${c.event?.headline??'news'}${c.decision?.version==='research-screen-v2'?` · ${friendlyLabel(c.conclusion)}`:''}${s.score!==null?` · evidence ${s.score}/100`:''}`,url:c.event?.url??null});}
   items.push({entityId:e.id,name:e.name,ticker,thesis:memo?{text:memo.thesis,recordedAt:memo.known_from}:null,criteria,changes});
  }
  return json(buildFollowing(items,now));
 }catch(e){return failure(e)}
}
