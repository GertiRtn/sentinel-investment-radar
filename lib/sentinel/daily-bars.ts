import {database,hash,iso} from '@/db/store';

const CACHE_MS=6*3600000;

/**
 * Alpaca IEX daily bars (adjustment "all"), fetched on request only, archived append-only in raw_event
 * (deduplicated by content) and reused for 6 hours. Shared by the case sheet and the Practice risk check.
 * Since 2026-11-13 the hourly case assessment also uses it, only when a case has no eligible live quote
 * (a 10-day window, at most 6 small requests per run); see last-close.ts.
 */
export async function archivedDailyBars(ticker:string,start:string,end:string,c:{ALPACA_DATA_KEY_ID:string;ALPACA_DATA_SECRET:string}){
 const db=database(),source=`alpaca:iex:daily-bars:${ticker}:${start}:${end}`;
 const state=await db.prepare('SELECT last_good_at,raw_event_id FROM source_state WHERE source=?').bind(source).first<{last_good_at:string|null;raw_event_id:string|null}>();
 if(state?.last_good_at&&state.raw_event_id&&Date.now()-Date.parse(state.last_good_at)<CACHE_MS){const raw=await db.prepare('SELECT id,fetched_at,payload FROM raw_event WHERE id=?').bind(state.raw_event_id).first<{id:string;fetched_at:string;payload:string}>();if(raw)return {payload:JSON.parse(raw.payload),rawId:raw.id,fetchedAt:raw.fetched_at};}
 const params=new URLSearchParams({timeframe:'1Day',start,end,limit:'1000',adjustment:'all',feed:'iex',sort:'asc'});
 let response:Response;try{response=await fetch('https://data.alpaca.markets/v2/stocks/'+encodeURIComponent(ticker)+'/bars?'+params,{headers:{'APCA-API-KEY-ID':c.ALPACA_DATA_KEY_ID,'APCA-API-SECRET-KEY':c.ALPACA_DATA_SECRET,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});}catch{throw new Error('The price source could not be reached.');}
 if(!response.ok)throw new Error(response.status===429?'The price source is rate-limiting; try again in a minute.':`The price source returned HTTP ${response.status}.`);
 const text=await response.text();if(text.length>300000)throw new Error('The price response was too large.');
 let payload:any;try{payload=JSON.parse(text)}catch{throw new Error('The price response could not be read.');}
 if(payload?.next_page_token)throw new Error('The price history exceeded one page.');
 const now=iso(),digest=await hash(text),id='daily-bars:'+await hash(source+':'+digest);
 await db.prepare('INSERT OR IGNORE INTO raw_event(id,source,fetched_at,published_at,known_from,content_hash,payload,http_status) VALUES(?,?,?,NULL,?,?,?,200)').bind(id,source,now,now,digest,text).run();
 const raw=await db.prepare('SELECT id,fetched_at FROM raw_event WHERE id=?').bind(id).first<{id:string;fetched_at:string}>();if(!raw)throw new Error('The price data could not be archived.');
 await db.prepare('INSERT INTO source_state(source,failures,checked_at,last_good_at,raw_event_id) VALUES(?,0,?,?,?) ON CONFLICT(source) DO UPDATE SET failures=0,checked_at=excluded.checked_at,last_good_at=excluded.last_good_at,raw_event_id=excluded.raw_event_id,retry_at=NULL,error=NULL').bind(source,now,now,raw.id).run();
 return {payload,rawId:raw.id,fetchedAt:raw.fetched_at};
}
