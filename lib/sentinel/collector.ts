import {env} from 'cloudflare:workers';
import {database,hash,iso} from '@/db/store';
import {NEWS_SOURCES,parseQuote,parseRSS,readBody,type FeedSource,type Quote,type NewsItem,type SourceStatus} from './feeds';
type State={source:string;failures:number;retry_at:string|null;checked_at:string|null;last_good_at:string|null;raw_event_id:string|null;lease_until:string|null;error:string|null};
type Raw={id:string;payload:string;known_from:string};
export type Capture<T>={values:T[];source:SourceStatus};
export async function requestWithRetry(url:string,accept:string,fetcher:typeof fetch=fetch){
 let last:unknown;let attempts=0;
 for(let n=0;n<3;n++){
  attempts=n+1;
  try{const response=await fetcher(url,{headers:{Accept:accept},redirect:'manual',signal:AbortSignal.timeout(4000)});
   if(!response.ok){const e=new Error(`Provider HTTP ${response.status}`);if(response.status===429)throw Object.assign(e,{stop:true});if(response.status<500)throw Object.assign(e,{stop:true});throw e;}
   const payload=await readBody(response);return {payload,status:response.status,attempts};
  }catch(e){last=e;if((e as {stop?:boolean})?.stop||n===2)break;await new Promise(r=>setTimeout(r,250*2**n+Math.floor(Math.random()*200)));}
 }
 throw Object.assign(new Error(last instanceof Error?last.message:'Upstream request failed'),{attempts});
}
async function capture<T>(source:string,name:string,url:string,interval:number,parse:(payload:string,received:string)=>T[],refresh=true):Promise<Capture<T>>{
 const db=database();const start=iso();
 if(refresh)await db.prepare('INSERT OR IGNORE INTO source_state(source,failures) VALUES(?,0)').bind(source).run();
 let state=await db.prepare('SELECT * FROM source_state WHERE source=?').bind(source).first<State>();
 const forced=(env as unknown as Record<string,string>).SENTINEL_FORCE_FAIL===source;
 const recovered=!!state?.error?.startsWith('Forced source failure')&&!forced;
 if(refresh&&recovered)await db.prepare('UPDATE source_state SET retry_at=NULL,checked_at=NULL WHERE source=?').bind(source).run();
 const token=crypto.randomUUID();const eligible=recovered||(!state?.checked_at||Date.now()-Date.parse(state.checked_at)>=interval)&&(!state?.retry_at||Date.parse(state.retry_at)<=Date.now());
 if(refresh&&eligible){
  const lease=await db.prepare('UPDATE source_state SET lease_until=?,lease_token=? WHERE source=? AND (lease_until IS NULL OR lease_until < ?) AND (retry_at IS NULL OR retry_at <= ?)').bind(new Date(Date.now()+30000).toISOString(),token,source,start,start).run();
  if(lease.meta.changes){
   let attempts=0;
   try{
    if((env as unknown as Record<string,string>).SENTINEL_FORCE_FAIL===source)throw new Error('Forced source failure (server test flag)');
    const response=await requestWithRetry(url,source.startsWith('coinbase')?'application/json':'application/rss+xml, application/xml, text/xml');attempts=response.attempts;
    const received=iso(),digest=await hash(response.payload),rawId=crypto.randomUUID();
    // Persist the original decoded response before deriving or serving anything.
    await db.prepare('INSERT OR IGNORE INTO raw_event(id,source,fetched_at,published_at,known_from,content_hash,payload,http_status) VALUES(?,?,?,NULL,?,?,?,?)').bind(rawId,source,received,iso(),digest,response.payload,response.status).run();
    const raw=await db.prepare('SELECT id,payload,known_from FROM raw_event WHERE source=? AND content_hash=?').bind(source,digest).first<Raw>();if(!raw)throw new Error('Raw capture unavailable');
    const values=parse(response.payload,received);const completed=iso();
    const operations=[
     db.prepare('INSERT INTO collector_run(id,source,attempted_at,completed_at,status,attempts,raw_event_id) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),source,start,completed,'available',attempts,raw.id),
     db.prepare('UPDATE source_state SET failures=0,retry_at=NULL,checked_at=?,last_good_at=?,raw_event_id=?,error=NULL,lease_until=NULL,lease_token=NULL WHERE source=? AND lease_token=?').bind(completed,received,raw.id,source,token)
    ];
    if(source.startsWith('coinbase')){const q=values[0] as Quote;operations.push(db.prepare('INSERT OR IGNORE INTO fact(id,entity,metric,value,unit,known_from,raw_event_id,derivation) VALUES(?,?,?,?,?,?,?,?)').bind('spot:'+raw.id,q.symbol,'spot_reference',q.amount,q.currency,completed,raw.id,JSON.stringify({path:'data.amount',currencyPath:'data.currency',reconciliation:'unknown',note:'Single-source indicative reference; not verified for decisions.'})));}
    await db.batch(operations);
   }catch(error){
    attempts=attempts||(error as {attempts?:number}).attempts||0;const message=error instanceof Error?error.message.slice(0,250):'Collector error';
    const completed=iso();const failures=(state?.failures||0)+1;const retry=new Date(Date.now()+(failures>=3?300000:30000)).toISOString();
    const ops=[db.prepare('INSERT INTO collector_run(id,source,attempted_at,completed_at,status,attempts,error) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),source,start,completed,failures>=3?'degraded':'unavailable',attempts,message),db.prepare('UPDATE source_state SET failures=failures+1,retry_at=?,checked_at=?,error=?,lease_until=NULL,lease_token=NULL WHERE source=? AND lease_token=?').bind(retry,completed,message,source,token)];
    if(failures===3)ops.push(db.prepare('INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),'system',completed,'feed_health',source,JSON.stringify({message:'Three consecutive requested collection runs failed. Circuit paused for five minutes.',category:'operational',marketImplication:'unknown'})));
    await db.batch(ops);console.error('Sentinel collector failure',source,message);
   }
  }
 }
 state=await db.prepare('SELECT * FROM source_state WHERE source=?').bind(source).first<State>();
 const raw=state?.raw_event_id?await db.prepare('SELECT id,payload,known_from FROM raw_event WHERE id=?').bind(state.raw_event_id).first<Raw>():null;
 const stale=!state?.last_good_at||state.failures>0||Date.now()-Date.parse(state.last_good_at)>interval*2;
 const values=raw?parse(raw.payload,state!.last_good_at!).map(value=>({...value as object,rawEventId:raw.id,knownFrom:raw.known_from,stale,reconciliation:source.startsWith('coinbase')?'unknown':undefined})) as T[]:[];
 return {values,source:{name,status:state&&state.failures>=3?'degraded':stale?'unavailable':'available',checkedAt:state?.checked_at||start,lastGoodAt:state?.last_good_at||null,retryAt:state?.retry_at||null,failures:state?.failures||0,stale,message:stale?(raw?'Last successful response retained; it is not current. ':'No successful response recorded. ')+(state?.error||'Collection pending'):'Latest successful response is stored with provenance.'}};
}
export async function collectMarket(refresh=true){const results=await Promise.all([['BTC','Bitcoin'],['ETH','Ethereum']].map(([symbol,name])=>capture<Quote>('coinbase:'+symbol,`Coinbase ${symbol}/USD`,`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`,60000,(body,received)=>[parseQuote(JSON.parse(body),symbol,name,received)],refresh)));return {quotes:results.flatMap(r=>r.values),sources:results.map(r=>r.source),checkedAt:iso(),storage:'durable',monitoring:'on-demand'};}
export async function collectNews(refresh=true){const results=await Promise.all(NEWS_SOURCES.map((s:FeedSource)=>capture<NewsItem>(s.id,s.name,s.url,240000,(body,received)=>parseRSS(body,s,received),refresh)));const items=results.flatMap(r=>r.values).sort((a,b)=>(Date.parse(b.publishedAt||'')||0)-(Date.parse(a.publishedAt||'')||0));return {items,sources:results.map(r=>r.source),checkedAt:iso(),mode:'public-feeds',storage:'durable',monitoring:'on-demand'};}
