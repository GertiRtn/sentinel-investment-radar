import {env} from 'cloudflare:workers';
import {database,hash,iso} from '@/db/store';
import {identity,body,json,failure,ApiError} from '@/lib/sentinel/api';
import {parseCompanyNews} from '@/lib/sentinel/company-news';
export const dynamic='force-dynamic';
export async function collectCompanyNews(owner:string,entity:string){
 const db=database();
 const company=await db.prepare('SELECT e.tickers FROM entity_watch w JOIN entity e ON e.id=w.entity_id WHERE w.owner=? AND e.id=?').bind(owner,entity).first<{tickers:string}>();if(!company)throw new ApiError(404,'Select a saved company first.');
 const tickers=JSON.parse(company.tickers),symbol=typeof tickers?.[0]==='string'?tickers[0].toUpperCase():'';if(!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol))throw new ApiError(400,'No supported US ticker is available.');
 const credentials=env as unknown as {ALPACA_DATA_KEY_ID?:string;ALPACA_DATA_SECRET?:string};if(!credentials.ALPACA_DATA_KEY_ID||!credentials.ALPACA_DATA_SECRET)throw new ApiError(503,'Company news is not connected.');
 const source='alpaca:news:'+symbol,now=iso();const cached=await db.prepare('SELECT * FROM source_state WHERE source=?').bind(source).first<any>();
 if(cached?.retry_at&&Date.parse(cached.retry_at)>Date.now())throw new ApiError(429,'News source is temporarily paused. Try again later.');
 if(cached?.last_good_at&&Date.now()-Date.parse(cached.last_good_at)<240000){const raw=await db.prepare('SELECT * FROM raw_event WHERE id=?').bind(cached.raw_event_id).first<any>();if(raw)return {items:parseCompanyNews(JSON.parse(raw.payload),symbol,raw.fetched_at),capturedAt:raw.fetched_at,rawEventId:raw.id,cached:true};}
 const start=new Date(Date.parse(now)-7*86400000).toISOString();const url='https://data.alpaca.markets/v1beta1/news?symbols='+encodeURIComponent(symbol)+'&limit=10&sort=desc&include_content=false&start='+encodeURIComponent(start);let response:Response;
 try{response=await fetch(url,{headers:{'APCA-API-KEY-ID':credentials.ALPACA_DATA_KEY_ID,'APCA-API-SECRET-KEY':credentials.ALPACA_DATA_SECRET,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});}catch{throw new ApiError(502,'Company news source could not be reached.');}
 if(!response.ok){if(response.status===429){const retry=new Date(Date.now()+60000).toISOString();await db.prepare('INSERT INTO source_state(source,failures,retry_at,error) VALUES(?,1,?,?) ON CONFLICT(source) DO UPDATE SET failures=failures+1,retry_at=excluded.retry_at,error=excluded.error').bind(source,retry,'Rate limited').run();}throw new ApiError(response.status===429?429:502,'Company news is unavailable. Check account access or try again later.');}
 const text=await response.text();if(text.length>200000)throw new ApiError(502,'News response too large.');let parsed:any,items;try{parsed=JSON.parse(text);items=parseCompanyNews(parsed,symbol,now)}catch{throw new ApiError(502,'News source returned an invalid response.');}
 const digest=await hash(text);let raw=await db.prepare('SELECT id,fetched_at FROM raw_event WHERE source=? AND content_hash=?').bind(source,digest).first<any>();if(!raw){await db.prepare('INSERT OR IGNORE INTO raw_event(id,source,fetched_at,published_at,known_from,content_hash,payload,http_status) VALUES(?,?,?,NULL,?,?,?,200)').bind(crypto.randomUUID(),source,now,now,digest,text).run();raw=await db.prepare('SELECT id,fetched_at FROM raw_event WHERE source=? AND content_hash=?').bind(source,digest).first<any>();}if(!raw)throw new ApiError(503,'News could not be recorded.');
 await db.prepare('INSERT INTO source_state(source,failures,checked_at,last_good_at,raw_event_id) VALUES(?,0,?,?,?) ON CONFLICT(source) DO UPDATE SET failures=0,checked_at=excluded.checked_at,last_good_at=excluded.last_good_at,raw_event_id=excluded.raw_event_id,retry_at=NULL,error=NULL').bind(source,now,now,raw.id).run();return {items,capturedAt:raw.fetched_at,rawEventId:raw.id,cached:false};
}
export async function POST(request:Request){try{const owner=await identity(request),input=await body(request),entity=typeof input?.entity==='string'?input.entity:'';return json(await collectCompanyNews(owner,entity));}catch(e){return failure(e)}}
