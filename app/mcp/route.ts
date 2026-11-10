import {database} from '@/db/store';
import {ingest} from '@/lib/sentinel/edgar';

// Site dispatch authenticates MCP callers; every operation is scoped to that caller's watchlist.
export async function POST(request:Request){
 let msg:any;try{msg=await request.json()}catch{return Response.json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}})}
 const id=msg.id??null;
 const reply=(result:unknown)=>Response.json({jsonrpc:'2.0',id,result},{headers:{'Cache-Control':'no-store'}});
 const error=(code:number,message:string)=>Response.json({jsonrpc:'2.0',id,error:{code,message}});
 if(msg.method==='server/discover')return reply({supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
 if(msg.method==='tools/list')return reply({tools:[{name:'refresh_saved_company_filings',description:'Check up to five of your saved companies for SEC filing updates, oldest check first. Returns successes, failures and last check times; never trades.',inputSchema:{type:'object',properties:{},additionalProperties:false}}]});
 if(msg.method!=='tools/call'||msg.params?.name!=='refresh_saved_company_filings')return error(-32601,'Method or tool not found');
 const owner=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
 if(!owner||!email)return reply({content:[{type:'text',text:'A signed-in identity and verified contact email are required. No companies were checked.'}],isError:true});
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return reply({content:[{type:'text',text:'A valid SEC contact email is required. No companies were checked.'}],isError:true});
 const db=database();
 const rows=await db.prepare("SELECT e.id,e.name,e.cik,MAX(r.known_from) AS last_check FROM entity_watch w JOIN entity e ON e.id=w.entity_id LEFT JOIN sec_run r ON r.entity_id=e.id WHERE w.owner=? GROUP BY e.id,e.name,e.cik ORDER BY COALESCE(MAX(r.known_from),'') ASC,e.id LIMIT 5").bind(owner).all<{id:string;name:string;cik:string;last_check:string|null}>();
 const results=[];
 for(const entity of rows.results){
  try{const result=await ingest(entity.cik,email);results.push({company:entity.name,status:'success',checked_at:new Date().toISOString(),observations_processed:result.observations,new_filings:result.newFilings});}
  catch(e){results.push({company:entity.name,status:'failed',checked_at:new Date().toISOString(),message:e instanceof Error?e.message:'Update failed'});}
 }
 return reply({content:[{type:'text',text:JSON.stringify({results,checked:results.length,note:'SEC responses can be cached for up to 24 hours. Failures retain stored records. This tool does not evaluate trades.'})}],isError:results.some(r=>r.status==='failed')});
}
