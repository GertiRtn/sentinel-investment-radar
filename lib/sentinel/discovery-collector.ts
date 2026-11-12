import {env} from 'cloudflare:workers';
import {database,hash,iso} from '@/db/store';
import {parseDiscovery} from './discovery';
import {ApiError} from './api';
export async function collectDiscovery(owner:string){
 const db=database(),credentials=env as unknown as {ALPACA_DATA_KEY_ID?:string;ALPACA_DATA_SECRET?:string};
 if(!credentials.ALPACA_DATA_KEY_ID||!credentials.ALPACA_DATA_SECRET)throw new ApiError(503,'Market news is not connected.');
 const previous=await db.prepare("SELECT body FROM signal_log WHERE owner=? AND kind='discovery_checkpoint' ORDER BY created_at DESC,id DESC LIMIT 1").bind(owner).first<{body:string}>();
 const prev=previous?JSON.parse(previous.body):null,now=iso();
 const start=prev?.token?prev.start:prev?.end?new Date(Date.parse(prev.end)-600000).toISOString():new Date(Date.parse(now)-3600000).toISOString();
 const end=prev?.token?prev.end:new Date(Date.parse(now)-16*60000).toISOString();let token:string|null=prev?.token||null,pages=0;const captures:{text:string;items:ReturnType<typeof parseDiscovery>['items']}[]=[];
 do{
  const params=new URLSearchParams({start,end,limit:'50',sort:'asc',include_content:'false'});if(token)params.set('page_token',token);
  let response:Response;try{response=await fetch('https://data.alpaca.markets/v1beta1/news?'+params,{headers:{'APCA-API-KEY-ID':credentials.ALPACA_DATA_KEY_ID,'APCA-API-SECRET-KEY':credentials.ALPACA_DATA_SECRET,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});}catch{throw new ApiError(502,'Market news source could not be reached.');}
  if(!response.ok)throw new ApiError(response.status===429?429:502,'Market news source unavailable; the checkpoint has not advanced.');
  const text=await response.text();if(text.length>500000)throw new ApiError(502,'Market news response too large.');
  let parsed:ReturnType<typeof parseDiscovery>;try{parsed=parseDiscovery(JSON.parse(text),now)}catch{throw new ApiError(502,'Market news response invalid.');}
  if(parsed.nextPageToken&&parsed.nextPageToken===token)throw new ApiError(502,'Market news pagination did not advance.');
  captures.push({text,items:parsed.items});token=parsed.nextPageToken;pages++;
 }while(token&&pages<5);
 const statements:D1PreparedStatement[]=[],candidateIndexes:{index:number;event:any}[]=[];
 for(const capture of captures){
  const digest=await hash(capture.text),rawId='discovery-raw:'+digest;
  statements.push(db.prepare('INSERT OR IGNORE INTO raw_event(id,source,fetched_at,published_at,known_from,content_hash,payload,http_status) VALUES(?,?,?,NULL,?,?,?,200)').bind(rawId,'alpaca:market-news',now,now,digest,capture.text));
  for(const item of capture.items){const id='discovery:'+await hash(JSON.stringify([owner,item.id,item.updatedAt]));const event={...item,firstObservedAt:now,rawEventId:rawId};candidateIndexes.push({index:statements.length,event});statements.push(db.prepare("INSERT OR IGNORE INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'discovery_candidate',NULL,?)").bind(id,owner,now,JSON.stringify(event)));}
 }
 const checkpoint={start,end,token,pages,completed:!token};statements.push(db.prepare("INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'discovery_checkpoint',NULL,?)").bind(crypto.randomUUID(),owner,iso(),JSON.stringify(checkpoint)));
 const results=await db.batch(statements);const added=candidateIndexes.filter(x=>results[x.index].meta.changes).map(x=>x.event);
 return {status:token?'partial':'complete',window:{start,end},pages,newCount:added.length,items:added,notice:token?'More pages remain; the next run resumes this window.':'Coverage is limited to the provider feed and its entitlement; tags and claims are unverified.'};
}
