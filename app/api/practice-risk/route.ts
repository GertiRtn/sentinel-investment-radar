import {env} from 'cloudflare:workers';
import {identity,json,failure} from '@/lib/sentinel/api';
import {practiceSnapshot} from '@/app/api/practice/route';
import {archivedDailyBars} from '@/lib/sentinel/daily-bars';
import {nyDate,closeInstant} from '@/lib/sentinel/case-context';
import {riskReport,type Closes} from '@/lib/sentinel/practice-risk';
export const dynamic='force-dynamic';

/**
 * Practice risk check: on demand only, read-only. It reads the owner's open virtual positions at
 * their live marks, archived daily bars for those symbols (fetched on request, reused for 6 hours),
 * and runs a seeded simulation. It stores nothing and never trades. Not part of the hourly run.
 */
export async function GET(request:Request){try{
 const owner=await identity(request),{state,now}=await practiceSnapshot(owner);
 const bySymbol=new Map<string,{symbol:string;valueCents:number|null}>();
 for(const p of state.open as any[]){const prev=bySymbol.get(p.symbol);bySymbol.set(p.symbol,{symbol:p.symbol,valueCents:prev?(prev.valueCents===null||p.valueCents===null?null:prev.valueCents+p.valueCents):p.valueCents});}
 const merged=[...bySymbol.values()],closes:Closes={},sources:any[]=[],problems:string[]=[];
 const creds=env as unknown as {ALPACA_DATA_KEY_ID?:string;ALPACA_DATA_SECRET?:string};
 if(merged.length){
  if(!creds.ALPACA_DATA_KEY_ID||!creds.ALPACA_DATA_SECRET)problems.push('Market data is not connected.');
  else{
   const end=now.slice(0,10),start=new Date(Date.parse(now)-400*86400000).toISOString().slice(0,10);
   await Promise.all(merged.map(async h=>{try{const b=await archivedDailyBars(h.symbol,start,end,creds as any);const m=new Map<string,number>();for(const bar of Array.isArray(b.payload?.bars)?b.payload.bars:[]){if(typeof bar?.t!=='string'||!(bar.c>0))continue;const d=nyDate(bar.t);if(closeInstant(d)>b.fetchedAt)continue;m.set(d,bar.c);}closes[h.symbol]=m;sources.push({symbol:h.symbol,rawId:b.rawId,fetchedAt:b.fetchedAt,closes:m.size});}catch(e){problems.push(`${h.symbol}: ${e instanceof Error?e.message:'price history unavailable'}`);}}));
  }
 }
 const report=riskReport(merged,state.cashCents,closes);
 return json({...report,preparedAt:now,source:'Alpaca IEX daily bars, adjustment "all"',sources,problems,positions:merged.length,note:'Simulated on virtual Practice positions only. A conditional scenario on past data, not a forecast, maximum loss, advice or evidence of an edge.'});
}catch(e){return failure(e)}}
