import {env} from 'cloudflare:workers';
import {database} from '@/db/store';
import {discoveryQueue} from '@/lib/sentinel/discovery-case';
import {identity,json,failure} from '@/lib/sentinel/api';
import {buildMorningBrief,BRIEF_WINDOW_HOURS} from '@/lib/sentinel/morning-brief';
import {caseEvidenceScore} from '@/lib/sentinel/evidence-score';
export const dynamic='force-dynamic';

/** The executive morning brief for the signed-in owner, built from stored records only. */
export async function GET(request:Request){
 try{
  const owner=await identity(request),db=database(),now=new Date().toISOString(),since=new Date(Date.now()-BRIEF_WINDOW_HOURS*3600000).toISOString();
  const cases=(await db.prepare("SELECT id,created_at,body FROM signal_log WHERE owner=? AND kind='discovery_case' AND created_at>=? ORDER BY created_at DESC LIMIT 400").bind(owner,since).all<{id:string;created_at:string;body:string}>()).results.map(r=>({...JSON.parse(r.body),id:r.id,createdAt:r.created_at}));
  const watched=(await db.prepare("SELECT DISTINCT e.id,e.name,e.tickers FROM entity_watch w JOIN entity e ON e.id=w.entity_id WHERE w.owner=? ORDER BY e.name LIMIT 50").bind(owner).all<{id:string;name:string;tickers:string}>()).results;
  const filingsSince=new Date(Date.now()-3*86400000).toISOString().slice(0,10);
  const watch=[];
  for(const e of watched){
   const filings=(await db.prepare("SELECT form,filed_at,accession FROM filing WHERE entity_id=? AND recorded_at>=? AND filed_at>=? ORDER BY filed_at DESC LIMIT 5").bind(e.id,since,filingsSince).all<{form:string;filed_at:string;accession:string}>()).results.map(f=>({form:f.form,filedAt:f.filed_at,accession:f.accession}));
   const news=(await db.prepare("SELECT body FROM signal_log WHERE owner=? AND kind='news_observation' AND entity=? AND created_at>=? ORDER BY created_at DESC LIMIT 3").bind(owner,e.id,since).all<{body:string}>()).results.map(r=>JSON.parse(r.body)).filter((n:any)=>n.headline);
   let ticker:string|null=null;try{ticker=JSON.parse(e.tickers)?.[0]??null}catch{}
   watch.push({entityId:e.id,name:e.name,ticker,filings,headlines:news.map((n:any)=>({headline:n.headline,url:n.url??null,publishedAt:n.publishedAt??null}))});
  }
  const cp=await db.prepare("SELECT created_at,body FROM signal_log WHERE owner=? AND kind='discovery_checkpoint' ORDER BY created_at DESC,id DESC LIMIT 1").bind(owner).first<{created_at:string;body:string}>();
  const cpBody=cp?JSON.parse(cp.body):null;
  const pending={n:(await discoveryQueue(owner)).pending.length};
  const lastOutcome=await db.prepare("SELECT MAX(created_at) AS at FROM signal_log WHERE owner=? AND kind IN ('discovery_outcome','outcome_attempt')").bind(owner).first<{at:string|null}>();
  const counts=(await db.prepare("SELECT COALESCE(json_extract(body,'$.horizonIntervals'),5) AS h,COUNT(*) AS n FROM signal_log WHERE owner=? AND kind='discovery_outcome' GROUP BY h").bind(owner).all<{h:number;n:number}>()).results;
  const shadowReadings=await db.prepare("SELECT COUNT(*) AS n FROM signal_log WHERE owner=? AND kind='shadow_reading' AND created_at>=?").bind(owner,since).first<{n:number}>();
  const brief=buildMorningBrief({now,cases,watch,
   lastScan:cp?{at:cp.created_at,completed:!!cpBody?.completed,pages:cpBody?.pages??null}:null,
   pendingCount:pending?.n??null,lastOutcomeAt:lastOutcome?.at??null,
   outcomeCounts:Object.fromEntries(counts.map(c=>[Number(c.h),c.n])),
   shadow:{enabled:(env as unknown as {SHADOW_READER_ENABLED?:string}).SHADOW_READER_ENABLED==='1',readings:shadowReadings?.n??0}});
  // Full case records for the side panel (same owner, same window).
  return json({...brief,caseDetails:Object.fromEntries(cases.map(c=>[c.id,{id:c.id,symbol:c.symbol,conclusion:c.conclusion,reason:c.reason,decision:c.decision,rules:c.rules??[],readiness:c.readiness??null,event:c.event,identity:c.identity?{name:c.identity.name,cik:c.identity.cik,relevance:c.identity.relevance}:null,price:c.price,evidence:c.brief?.evidence??[],missing:c.missing??[],createdAt:c.createdAt,evidenceScore:caseEvidenceScore(c)}]))});
 }catch(e){return failure(e)}
}
