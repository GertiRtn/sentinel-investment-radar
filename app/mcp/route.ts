import {researchDecisionV2} from '@/lib/sentinel/price-assessment';
import {database,hash} from '@/db/store';
import {ingest} from '@/lib/sentinel/edgar';
import {collectCompanyNews} from '@/app/api/company-news/route';
import {assessNews,assessCompanyRelevance} from '@/lib/sentinel/news-assessment';
import {observeOneOutcome} from '@/lib/sentinel/outcome-collector';
import {assessDiscoveryBatch} from '@/lib/sentinel/discovery-case';
import {collectDiscovery} from '@/lib/sentinel/discovery-collector';
import {buildBrief} from '@/lib/sentinel/brief-builder';

// Site dispatch authenticates MCP callers; every operation is scoped to that caller's watchlist.
export async function POST(request:Request){
 let msg:any;try{msg=await request.json()}catch{return Response.json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}})}
 const id=msg.id??null;
 const reply=(result:unknown)=>Response.json({jsonrpc:'2.0',id,result},{headers:{'Cache-Control':'no-store'}});
 const error=(code:number,message:string)=>Response.json({jsonrpc:'2.0',id,error:{code,message}});
 if(msg.method==='server/discover')return reply({supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
 if(msg.method==='tools/list')return reply({tools:[{name:'refresh_saved_company_news',description:'Check saved companies for recent news, store source captures and return research topics. Does not trade or claim profitability.',inputSchema:{type:'object',properties:{},additionalProperties:false}},{name:'refresh_saved_company_filings',description:'Check up to five of your saved companies for SEC filing updates, oldest check first. Returns successes, failures and last check times; never trades.',inputSchema:{type:'object',properties:{},additionalProperties:false}}]});
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
 const db=database();
 const rows=await db.prepare("SELECT e.id,e.name,e.cik,MAX(r.known_from) AS last_check FROM entity_watch w JOIN entity e ON e.id=w.entity_id LEFT JOIN sec_run r ON r.entity_id=e.id WHERE w.owner=? GROUP BY e.id,e.name,e.cik ORDER BY COALESCE(MAX(r.known_from),'') ASC,e.id LIMIT 5").bind(owner).all<{id:string;name:string;cik:string;last_check:string|null}>();
 const results=[];
 for(const entity of rows.results){
  try{const result=await ingest(entity.cik,email);results.push({company:entity.name,status:'success',checked_at:new Date().toISOString(),observations_processed:result.observations,new_filings:result.newFilings});}
  catch(e){results.push({company:entity.name,status:'failed',checked_at:new Date().toISOString(),message:e instanceof Error?e.message:'Update failed'});}
 }
 const news=await checkNews();let discovery;try{discovery=await collectDiscovery(ownerId)}catch(e){discovery={status:'failed',message:e instanceof Error?e.message:'Market discovery failed'};}let discoveryAssessment;try{discoveryAssessment=await assessDiscoveryBatch(ownerId,email)}catch(e){discoveryAssessment={status:'failed',message:e instanceof Error?e.message:'Assessment failed'};}let outcomeObservation;try{outcomeObservation=await observeOneOutcome(ownerId)}catch(e){outcomeObservation={status:'failed',message:e instanceof Error?e.message:'Outcome observation failed'};}return reply({content:[{type:'text',text:JSON.stringify({results,checked:results.length,news,discovery,discoveryAssessment,outcomeObservation,note:'SEC responses can be cached for up to 24 hours. News reports may be delayed. Failures retain stored records. This tool does not evaluate trades.'})}],isError:results.some(r=>r.status==='failed')});
}
