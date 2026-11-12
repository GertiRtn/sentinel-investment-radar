import {checkWatchlistNews,refreshWatchlistFilings} from '@/lib/sentinel/pipeline';
import {observeOneOutcome} from '@/lib/sentinel/outcome-collector';
import {assessDiscoveryBatch} from '@/lib/sentinel/discovery-case';
import {collectDiscovery} from '@/lib/sentinel/discovery-collector';
import {mcpCaller} from '@/app/auth';

// Site dispatch authenticates MCP callers; every operation is scoped to that caller's watchlist.
export async function POST(request:Request){
 let msg:any;try{msg=await request.json()}catch{return Response.json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}})}
 const id=msg.id??null;
 const reply=(result:unknown)=>Response.json({jsonrpc:'2.0',id,result},{headers:{'Cache-Control':'no-store'}});
 const error=(code:number,message:string)=>Response.json({jsonrpc:'2.0',id,error:{code,message}});
 if(msg.method==='server/discover')return reply({supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
 if(msg.method==='tools/list')return reply({tools:[{name:'refresh_saved_company_news',description:'Check saved companies for recent news, store source captures and return research topics. Does not trade or claim profitability.',inputSchema:{type:'object',properties:{},additionalProperties:false}},{name:'refresh_saved_company_filings',description:'Check up to five of your saved companies for SEC filing updates, oldest check first. Returns successes, failures and last check times; never trades.',inputSchema:{type:'object',properties:{},additionalProperties:false}}]});
 if(msg.method!=='tools/call'||!['refresh_saved_company_filings','refresh_saved_company_news'].includes(msg.params?.name))return error(-32601,'Method or tool not found');
 const caller=await mcpCaller(request),owner=caller?.owner??null,email=caller?.email??null;
 if(!owner)return reply({content:[{type:'text',text:'A signed-in identity is required. No companies were checked.'}],isError:true});
 const ownerId:string=owner;
 if(msg.params.name==='refresh_saved_company_news'){const result=await checkWatchlistNews(ownerId);return reply({content:[{type:'text',text:JSON.stringify(result)}],isError:result.results.some(r=>r.status==='failed')});}
 if(!email)return reply({content:[{type:'text',text:'A verified contact email is required. No companies were checked.'}],isError:true});
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return reply({content:[{type:'text',text:'A valid SEC contact email is required. No companies were checked.'}],isError:true});
 const results=await refreshWatchlistFilings(ownerId,email);
 const news=await checkWatchlistNews(ownerId);let discovery;try{discovery=await collectDiscovery(ownerId)}catch(e){discovery={status:'failed',message:e instanceof Error?e.message:'Market discovery failed'};}let discoveryAssessment;try{discoveryAssessment=await assessDiscoveryBatch(ownerId,email)}catch(e){discoveryAssessment={status:'failed',message:e instanceof Error?e.message:'Assessment failed'};}let outcomeObservation;try{outcomeObservation=await observeOneOutcome(ownerId)}catch(e){outcomeObservation={status:'failed',message:e instanceof Error?e.message:'Outcome observation failed'};}return reply({content:[{type:'text',text:JSON.stringify({results,checked:results.length,news,discovery,discoveryAssessment,outcomeObservation,note:'SEC responses can be cached for up to 24 hours. News reports may be delayed. Failures retain stored records. This tool does not evaluate trades.'})}],isError:results.some(r=>r.status==='failed')});
}
