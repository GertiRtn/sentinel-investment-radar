import {env} from 'cloudflare:workers';
import {database,hash,iso} from '@/db/store';
import {identity,body,json,failure,ApiError} from '@/lib/sentinel/api';
import {parseIexQuote} from '@/lib/sentinel/stock-quote';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{
 const owner=await identity(request),input=await body(request),entity=typeof input?.entity==='string'?input.entity:'',db=database();
 const company=await db.prepare('SELECT e.tickers FROM entity_watch w JOIN entity e ON e.id=w.entity_id WHERE w.owner=? AND e.id=?').bind(owner,entity).first<{tickers:string}>();if(!company)throw new ApiError(404,'Select a saved company first.');
 const tickers=JSON.parse(company.tickers);const symbol=Array.isArray(tickers)&&typeof tickers[0]==='string'?tickers[0].toUpperCase():'';if(!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol))throw new ApiError(400,'No supported US ticker is available for this company.');
 return json(await collectStockQuote(symbol));
 }catch(e){return failure(e)}}

export async function collectStockQuote(symbol:string){
 if(!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol))throw new ApiError(400,'Invalid ticker.');const db=database();
 const bindings=env as unknown as {ALPACA_DATA_KEY_ID?:string;ALPACA_DATA_SECRET?:string};if(!bindings.ALPACA_DATA_KEY_ID||!bindings.ALPACA_DATA_SECRET)throw new ApiError(503,'Stock prices are not connected yet. A free Alpaca paper account and secure server credentials are required.');
 const source='alpaca:iex:'+symbol,state=await db.prepare('SELECT * FROM source_state WHERE source=?').bind(source).first<any>();const now=iso();
 if(state?.retry_at&&Date.parse(state.retry_at)>Date.now())throw new ApiError(429,'The stock-price source is temporarily paused. Try again later.');
 if(state?.last_good_at&&Date.now()-Date.parse(state.last_good_at)<60000){const raw=await db.prepare('SELECT * FROM raw_event WHERE id=?').bind(state.raw_event_id).first<any>();if(raw){const q=parseIexQuote(JSON.parse(raw.payload),symbol,raw.fetched_at);return {...q,stale:Date.now()-Date.parse(q.sourceTime)>300000,rawEventId:raw.id,cached:true};}}
 const url='https://data.alpaca.markets/v2/stocks/'+encodeURIComponent(symbol)+'/quotes/latest?feed=iex';let response:Response;
 try{response=await fetch(url,{headers:{'APCA-API-KEY-ID':bindings.ALPACA_DATA_KEY_ID,'APCA-API-SECRET-KEY':bindings.ALPACA_DATA_SECRET,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});}catch{throw new ApiError(502,'The stock-price source could not be reached.');}
 if(!response.ok){if(response.status===429){const retry=new Date(Date.now()+60000).toISOString();await db.prepare('INSERT INTO source_state(source,failures,retry_at,error) VALUES(?,1,?,?) ON CONFLICT(source) DO UPDATE SET failures=failures+1,retry_at=excluded.retry_at,error=excluded.error').bind(source,retry,'Rate limited').run();}throw new ApiError(response.status===429?429:502,'The stock-price source did not return a quote. Check account access or try again later.');}
 const text=await response.text();if(text.length>64000)throw new ApiError(502,'The quote response was too large.');let parsed:any;try{parsed=JSON.parse(text)}catch{throw new ApiError(502,'The quote response could not be read.');}let quote;try{quote=parseIexQuote(parsed,symbol,now)}catch{throw new ApiError(502,'The stock-price source returned an invalid or incomplete quote.');}
 const digest=await hash(text);let raw=await db.prepare('SELECT id,fetched_at FROM raw_event WHERE source=? AND content_hash=?').bind(source,digest).first<{id:string;fetched_at:string}>();if(!raw){const id=crypto.randomUUID();await db.prepare('INSERT OR IGNORE INTO raw_event(id,source,fetched_at,published_at,known_from,content_hash,payload,http_status) VALUES(?,?,?,?,?,?,?,200)').bind(id,source,now,quote.sourceTime,now,digest,text).run();raw=await db.prepare('SELECT id,fetched_at FROM raw_event WHERE source=? AND content_hash=?').bind(source,digest).first<{id:string;fetched_at:string}>();}
 if(!raw)throw new ApiError(503,'The quote could not be recorded.');await db.prepare('INSERT INTO source_state(source,failures,checked_at,last_good_at,raw_event_id) VALUES(?,0,?,?,?) ON CONFLICT(source) DO UPDATE SET failures=0,checked_at=excluded.checked_at,last_good_at=excluded.last_good_at,raw_event_id=excluded.raw_event_id,retry_at=NULL,error=NULL').bind(source,now,now,raw.id).run();return {...quote,capturedAt:raw.fetched_at,rawEventId:raw.id,cached:false};

}
