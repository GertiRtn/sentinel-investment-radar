import {identity,json,failure,ApiError} from '@/lib/sentinel/api';
import {database,iso} from '@/db/store';
import {QUEUE_WINDOW_HOURS} from '@/lib/sentinel/discovery-case';
import {caseNewsDirection} from '@/lib/sentinel/news-direction';
import {matchLevelOf} from '@/lib/sentinel/event-match';
import {funnelCounts,FUNNEL_WINDOWS} from '@/lib/sentinel/discovery-funnel';
export const dynamic='force-dynamic';

/** Discovery funnel counts (discovery-funnel-v1). Read-only, on request only: three bounded reads, nothing written, nothing changed in collection or assessment. */
export async function GET(request:Request){try{
 const owner=await identity(request),hours=Number(new URL(request.url).searchParams.get('hours')??96);
 if(!(FUNNEL_WINDOWS as readonly number[]).includes(hours))throw new ApiError(400,'hours must be 24, 96 or 168.');
 const db=database(),now=iso(),since=new Date(Date.parse(now)-hours*3600000).toISOString(),cooldown=new Date(Date.parse(now)-6*3600000).toISOString();
 const [cands,cases,attempts]=await db.batch([
  db.prepare("SELECT id,created_at,json_extract(body,'$.priority') priority,json_extract(body,'$.symbols') symbols FROM signal_log WHERE owner=? AND created_at>? AND kind='discovery_candidate'").bind(owner,since),
  db.prepare("SELECT json_extract(body,'$.candidateId') c,json_extract(body,'$.symbol') s,json_extract(body,'$.conclusion') conclusion,json_extract(body,'$.event.headline') headline,json_extract(body,'$.event.providerSummary') summary,json_extract(body,'$.identity.name') name,json_extract(body,'$.eventMatch.version') mv,json_extract(body,'$.eventMatch.level') ml,json_extract(body,'$.newsDirection.version') ndv,json_extract(body,'$.newsDirection.direction') nd FROM signal_log WHERE owner=? AND created_at>? AND kind='discovery_case'").bind(owner,since),
  db.prepare("SELECT json_extract(body,'$.candidateId') c,json_extract(body,'$.symbol') s,created_at FROM signal_log WHERE owner=? AND created_at>? AND kind='discovery_attempt'").bind(owner,cooldown),
 ]);
 const list=(v:unknown)=>{try{const a=JSON.parse(String(v??'[]'));return Array.isArray(a)?a.map(String):[]}catch{return []}};
 return json(funnelCounts({now,windowHours:hours,queueWindowHours:QUEUE_WINDOW_HOURS,capacityPerRun:6,
  candidates:(cands.results as any[]).map(r=>({id:r.id,createdAt:r.created_at,priority:String(r.priority??''),symbols:list(r.symbols)})),
  cases:(cases.results as any[]).map(r=>({candidateId:String(r.c),symbol:String(r.s),conclusion:String(r.conclusion??''),
   direction:String(caseNewsDirection({newsDirection:r.ndv?{version:r.ndv,direction:r.nd}:null,event:{headline:r.headline,providerSummary:r.summary}}).direction),
   matchLevel:matchLevelOf({...r,symbol:r.s})})),
  attempts:(attempts.results as any[]).map(r=>({candidateId:String(r.c),symbol:String(r.s),createdAt:r.created_at}))}));
}catch(e){return failure(e)}}
