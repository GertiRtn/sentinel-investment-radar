import {env} from 'cloudflare:workers';
import {database} from '@/db/store';
import {identity,json,failure,ApiError} from '@/lib/sentinel/api';
import {companyFile} from '@/lib/sentinel/edgar';
import {buildEvidencePack} from '@/lib/sentinel/evidence-pack';
import {whatChanged,priceContext} from '@/lib/sentinel/case-context';
import {archivedDailyBars as bars} from '@/lib/sentinel/daily-bars';
export const dynamic='force-dynamic';


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

