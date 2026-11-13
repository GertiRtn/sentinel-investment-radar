import {researchDecisionV2} from '@/lib/sentinel/price-assessment';
import {database,hash} from '@/db/store';
import {ingest} from '@/lib/sentinel/edgar';
import {collectCompanyNews} from '@/app/api/company-news/route';
import {assessNews,assessCompanyRelevance} from '@/lib/sentinel/news-assessment';
import {observeOutcomes} from '@/lib/sentinel/outcome-collector';
import {assessDiscoveryBatch} from '@/lib/sentinel/discovery-case';
import {markPractice} from '@/app/api/practice/route';
import {autoPracticeStep} from '@/lib/sentinel/auto-practice-run';
import {collectDiscovery} from '@/lib/sentinel/discovery-collector';
import {buildBrief} from '@/lib/sentinel/brief-builder';
import {parseStages,runStage,skippedRecord,summarise,STAGES,type StageRecord} from '@/lib/sentinel/pipeline';

// Site dispatch authenticates MCP callers; every operation is scoped to that caller's watchlist.
export async function POST(request:Request){
 let msg:any;try{msg=await request.json()}catch{return Response.json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}})}
 const id=msg.id??null;
 const reply=(result:unknown)=>Response.json({jsonrpc:'2.0',id,result},{headers:{'Cache-Control':'no-store'}});
 const error=(code:number,message:string)=>Response.json({jsonrpc:'2.0',id,error:{code,message}});
 if(msg.method==='server/discover')return reply({supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
 if(msg.method==='tools/list')return reply({tools:[{name:'refresh_saved_company_news',description:'Check saved companies for recent news, store source captures and return research topics. Does not trade or claim profitability.',inputSchema:{type:'object',properties:{},additionalProperties:false}},{name:'refresh_saved_company_filings',description:'Runs the hourly refresh: SEC filings, saved-company news, market discovery, assessment, outcomes and the virtual Practice steps. Optional stages limits it to some of them; omit it to run everything. Returns a per-stage status with elapsed times; never trades.',inputSchema:{type:'object',properties:{stages:{type:'array',items:{type:'string',enum:[...STAGES]},minItems:1,description:'Run only these stages. Default: all.'}},additionalProperties:false}}]});
 if(msg.method!=='tools/call'||!['refresh_saved_company_filings','refresh_saved_company_news'].includes(msg.params?.name))return error(-32601,'Method or tool not found');
 const owner=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
 if(!owner)return reply({content:[{type:'text',text:'A signed-in identity is required. No companies were checked.'}],isError:true});
 const ownerId:string=owner;
 async function checkNews(){
  const db=database(),rows=await db.prepare("SELECT e.id,e.name,e.tickers FROM entity_watch w JOIN entity e ON e.id=w.entity_id WHERE w.owner=? ORDER BY e.id LIMIT 20").bind(ownerId).all<{id:string;name:string;tickers:string}>();const results=[];
  for(const company of rows.results){try{const capture=await collectCompanyNews(ownerId,company.id);const items=[];let reviewCount=0;for(const item of capture.items){const relevance=assessCompanyRelevance(item.headline,company.name);const analysis=assessNews(item),id='news:'+await hash(JSON.stringify([ownerId,company.id,item.id,item.updatedAt||item.publishedAt]));if(await db.prepare('SELECT id FROM signal_log WHERE id=? AND owner=?').bind(id,ownerId).first())continue;if(relevance.level==='review'){const event={headline:item.headline,url:item.url,source:item.source,publishedAt:item.publishedAt,updatedAt:item.updatedAt,rawEventId:capture.rawEventId,analysis,relevance};const inserted=await db.prepare("INSERT OR IGNORE INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'news_observation',?,?)").bind(id,ownerId,new Date().toISOString(),company.id,JSON.stringify(event)).run();if(inserted.meta.changes)reviewCount++;continue;}const brief=await buildBrief(ownerId,company.id);const event={headline:item.headline,url:item.url,source:item.source,publishedAt:item.publishedAt,updatedAt:item.updatedAt,rawEventId:capture.rawEventId,analysis,relevance,researchCase:{...(()=>{const decision=researchDecisionV2({identity:{relevance},price:null,brief,asOf:brief.asOf,topics:analysis.topics});return {version:'event-case-v2',createdAt:brief.asOf,conclusion:decision.conclusion,reason:decision.reason,decision,readiness:decision.readiness,rules:decision.rules}})(),company:brief.company,quote:brief.quote,reportedResults:brief.evidence,recentFilings:brief.recentFilings,filingsStale:brief.stale,missing:brief.missing,risks:brief.risks}};const inserted=await db.prepare("INSERT OR IGNORE INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'news_observation',?,?)").bind(id,ownerId,new Date().toISOString(),company.id,JSON.stringify(event)).run();if(inserted.meta.changes)items.push(event);}results.push({company:company.name,status:'success',capturedAt:capture.capturedAt,rawEventId:capture.rawEventId,items,reviewCount});}catch(e){results.push({company:company.name,status:'failed',message:e instanceof Error?e.message:'News check failed'});}}
  return {checked:results.length,results,note:'Headlines are unverified; topics are keyword-based and do not constitute a buy recommendation. Limited to 20 saved companies.'};
 }
 if(msg.params.name==='refresh_saved_company_news'){const result=await checkNews();return reply({content:[{type:'text',text:JSON.stringify(result)}],isError:result.results.some(r=>r.status==='failed')});}
 if(!email)return reply({content:[{type:'text',text:'A verified contact email is required. No companies were checked.'}],isError:true});
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return reply({content:[{type:'text',text:'A valid SEC contact email is required. No companies were checked.'}],isError:true});
 const parsed=parseStages(msg.params?.arguments?.stages);if('error' in parsed)return reply({content:[{type:'text',text:parsed.error+' Nothing was run.'}],isError:true});
 const wanted=new Set<string>(parsed.stages),runStarted=Date.now(),startedAt=new Date().toISOString(),records:StageRecord[]=[],out:Record<string,any>={};
 const step=async(stage:(typeof STAGES)[number],key:string,fn:()=>Promise<any>)=>{if(!wanted.has(stage)){records.push(skippedRecord(stage));return;}const r=await runStage(stage,fn);records.push(r.record);out[key]=r.result;};
 await step('filings','filings',async()=>{
  const db=database(),rows=await db.prepare("SELECT e.id,e.name,e.cik,MAX(r.known_from) AS last_check FROM entity_watch w JOIN entity e ON e.id=w.entity_id LEFT JOIN sec_run r ON r.entity_id=e.id WHERE w.owner=? GROUP BY e.id,e.name,e.cik ORDER BY COALESCE(MAX(r.known_from),'') ASC,e.id LIMIT 5").bind(ownerId).all<{id:string;name:string;cik:string;last_check:string|null}>();
  const results:any[]=[],begun=Date.now();let deferred=0;
  for(const entity of rows.results){
   // Protective cap, not a measured value: stop starting new companies after 30 s so later stages are not starved. Oldest-checked-first order means the deferred ones go first next run.
   if(results.length>0&&Date.now()-begun>=30000){deferred++;continue;}
   try{const result=await ingest(entity.cik,email);results.push({company:entity.name,status:'success',checked_at:new Date().toISOString(),observations_processed:result.observations,new_filings:result.newFilings});}
   catch(e){results.push({company:entity.name,status:'failed',checked_at:new Date().toISOString(),message:e instanceof Error?e.message:'Update failed'});}
  }
  return {results,checked:results.length,deferred};
 });
 await step('news','news',checkNews);
 await step('discovery','discovery',()=>collectDiscovery(ownerId));
 await step('assessment','discoveryAssessment',()=>assessDiscoveryBatch(ownerId,email));
 await step('outcomes','outcomeObservation',()=>observeOutcomes(ownerId));
 await step('practice','practiceMark',()=>markPractice(ownerId));
 await step('experiment','autoPractice',()=>autoPracticeStep(ownerId));
 const summary=summarise(records),elapsedMs=Date.now()-runStarted;let recorded=true;
 // Append-only record of what this run did, so the stage times and failures can be read afterwards. Failing to store it never fails the run.
 try{await database().prepare("INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'pipeline_run',NULL,?)").bind('pipeline-run:'+crypto.randomUUID(),ownerId,startedAt,JSON.stringify({version:'pipeline-v1',startedAt,elapsedMs,requested:parsed.stages,summary,stages:records})).run();}catch{recorded=false;}
 const filings=out.filings;
 return reply({content:[{type:'text',text:JSON.stringify({pipeline:{version:'pipeline-v1',status:summary.status,elapsedMs,failed:summary.failed,partial:summary.partial,skipped:summary.skipped,recorded,stages:records},results:filings?.results,checked:filings?.checked,news:out.news,discovery:out.discovery,discoveryAssessment:out.discoveryAssessment,outcomeObservation:out.outcomeObservation,practiceMark:out.practiceMark,autoPractice:out.autoPractice,note:'SEC responses can be cached for up to 24 hours. News reports may be delayed. A failed stage never stops the others and is never reported as complete; partial means work remains for the next run. Failures retain stored records. This tool does not evaluate trades.'})}],isError:summary.failed.length>0});
}
