import {env} from 'cloudflare:workers';
import {database,hash,iso} from '@/db/store';
import {identity,json,failure,ApiError} from '@/lib/sentinel/api';
import {companyFile} from '@/lib/sentinel/edgar';
import {buildEvidencePack} from '@/lib/sentinel/evidence-pack';
import {whatChanged,priceContext} from '@/lib/sentinel/case-context';
export const dynamic='force-dynamic';

const CACHE_MS=6*3600000;

/**
 * "What changed?" for one of the owner's cases. Read-only except for archiving fetched bars.
 * Financial part: stored case + SEC facts filed AND recorded by the case time (same pack as the Research team).
 * Price part (only with ?prices=1, i.e. when the user asks): Alpaca IEX daily bars for the stock and SPY around
 * the event, archived append-only in raw_event (deduplicated by content) and reused for 6 hours.
 * Never part of the hourly run.
 */
export async function GET(request:Request){try{
 const owner=await identity(request),url=new URL(request.url),caseId=url.searchParams.get('case')||'',db=database();
 const row=await db.prepare("SELECT id,created_at,body FROM signal_log WHERE id=? AND owner=? AND kind='discovery_case'").bind(caseId,owner).first<{id:string;created_at:string;body:string}>();
 if(!row)throw new ApiError(404,'Case not found.');
 const body=JSON.parse(row.body),kase={...body,id:row.id,createdAt:body.createdAt??row.created_at},asOf=String(kase.createdAt);
 let figures:any[]=[],quarterly:any[]=[];const notes:string[]=[];
 if(kase.identity?.cik){try{const file=await companyFile('sec:'+kase.identity.cik,asOf,'recorded',owner);figures=file.figures;quarterly=file.quarterlyFigures;}catch{notes.push('SEC figures could not be loaded.');}}
 const pack=buildEvidencePack({caseId,kase,figures,quarterlyFigures:quarterly,asOf,recordedBy:asOf});pack.missing.push(...notes);
 const context=whatChanged(pack,kase);
 if(url.searchParams.get('prices')!=='1')return json({...context,price:{status:'not_loaded',reason:'Price context loads only when you ask for it.'}});
 return json({...context,price:await loadPrice(kase)});
}catch(e){return failure(e)}}

async function loadPrice(kase:any){
 const symbol=String(kase.symbol||''),publishedAt=kase.event?.publishedAt??null;
 const fail=(reason:string)=>({status:'unavailable',reason,symbol,source:'Alpaca IEX daily bars'});
 if(!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol))return fail('The case has no usable ticker.');
 if(!publishedAt||!Number.isFinite(Date.parse(publishedAt)))return fail('The event has no valid publication time.');
 const creds=env as unknown as {ALPACA_DATA_KEY_ID?:string;ALPACA_DATA_SECRET?:string};
 if(!creds.ALPACA_DATA_KEY_ID||!creds.ALPACA_DATA_SECRET)return fail('Market data is not connected.');
 const day=86400000,start=new Date(Date.parse(publishedAt)-45*day).toISOString().slice(0,10),end=new Date(Math.min(Date.now(),Date.parse(publishedAt)+45*day)).toISOString().slice(0,10);
 try{
  const [stock,spy]=await Promise.all([bars(symbol,start,end,creds as any),bars('SPY',start,end,creds as any)]);
  return priceContext({stock:stock.payload,spy:spy.payload,symbol,publishedAt,caseAt:String(kase.createdAt),fetchedAt:stock.fetchedAt<spy.fetchedAt?stock.fetchedAt:spy.fetchedAt,source:'Alpaca IEX daily bars',adjustment:'all',rawIds:[stock.rawId,spy.rawId]});
 }catch(e){return fail(e instanceof Error?e.message:'The price source could not be used.');}
}

/** Archived, deduplicated daily bars; a capture younger than 6 hours is reused instead of refetched. */
async function bars(ticker:string,start:string,end:string,c:{ALPACA_DATA_KEY_ID:string;ALPACA_DATA_SECRET:string}){
 const db=database(),source=`alpaca:iex:case-bars:${ticker}:${start}:${end}`;
 const state=await db.prepare('SELECT last_good_at,raw_event_id FROM source_state WHERE source=?').bind(source).first<{last_good_at:string|null;raw_event_id:string|null}>();
 if(state?.last_good_at&&state.raw_event_id&&Date.now()-Date.parse(state.last_good_at)<CACHE_MS){const raw=await db.prepare('SELECT id,fetched_at,payload FROM raw_event WHERE id=?').bind(state.raw_event_id).first<{id:string;fetched_at:string;payload:string}>();if(raw)return {payload:JSON.parse(raw.payload),rawId:raw.id,fetchedAt:raw.fetched_at};}
 const params=new URLSearchParams({timeframe:'1Day',start,end,limit:'1000',adjustment:'all',feed:'iex',sort:'asc'});
 let response:Response;try{response=await fetch('https://data.alpaca.markets/v2/stocks/'+encodeURIComponent(ticker)+'/bars?'+params,{headers:{'APCA-API-KEY-ID':c.ALPACA_DATA_KEY_ID,'APCA-API-SECRET-KEY':c.ALPACA_DATA_SECRET,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});}catch{throw new Error('The price source could not be reached.');}
 if(!response.ok)throw new Error(response.status===429?'The price source is rate-limiting; try again in a minute.':`The price source returned HTTP ${response.status}.`);
 const text=await response.text();if(text.length>300000)throw new Error('The price response was too large.');
 let payload:any;try{payload=JSON.parse(text)}catch{throw new Error('The price response could not be read.');}
 if(payload?.next_page_token)throw new Error('The price history exceeded one page.');
 const now=iso(),digest=await hash(text),id='case-bars:'+await hash(source+':'+digest);
 await db.prepare('INSERT OR IGNORE INTO raw_event(id,source,fetched_at,published_at,known_from,content_hash,payload,http_status) VALUES(?,?,?,NULL,?,?,?,200)').bind(id,source,now,now,digest,text).run();
 const raw=await db.prepare('SELECT id,fetched_at FROM raw_event WHERE id=?').bind(id).first<{id:string;fetched_at:string}>();if(!raw)throw new Error('The price data could not be archived.');
 await db.prepare('INSERT INTO source_state(source,failures,checked_at,last_good_at,raw_event_id) VALUES(?,0,?,?,?) ON CONFLICT(source) DO UPDATE SET failures=0,checked_at=excluded.checked_at,last_good_at=excluded.last_good_at,raw_event_id=excluded.raw_event_id,retry_at=NULL,error=NULL').bind(source,now,now,raw.id).run();
 return {payload,rawId:raw.id,fetchedAt:raw.fetched_at};
}
