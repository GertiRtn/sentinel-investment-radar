import {database} from '@/db/store';
import {identity,json,failure,ApiError} from '@/lib/sentinel/api';
import {caseIdea,casePrice,holdings,parseCase} from '@/lib/sentinel/case-idea';
export const dynamic='force-dynamic';

/**
 * "What changed?" and the idea card for one of the owner's cases. Read-only except for archiving fetched bars.
 * Financial part: stored case + SEC facts filed AND recorded by the case time (same pack as the Research team).
 * Price part (only with ?prices=1, i.e. when the user asks): Alpaca IEX daily bars for the stock and SPY around
 * the event, archived append-only in raw_event (deduplicated by content) and reused for 6 hours.
 */
export async function GET(request:Request){try{
 const owner=await identity(request),url=new URL(request.url),caseId=url.searchParams.get('case')||'';
 const row=await database().prepare("SELECT id,created_at,body FROM signal_log WHERE id=? AND owner=? AND kind='discovery_case'").bind(caseId,owner).first<{id:string;created_at:string;body:string}>();
 if(!row)throw new ApiError(404,'Case not found.');
 const kase=parseCase(row),{context,idea}=await caseIdea(owner,kase,await holdings(owner));
 if(url.searchParams.get('prices')!=='1')return json({...context,idea,price:{status:'not_loaded',reason:'Price context loads only when you ask for it.'}});
 return json({...context,idea,price:await casePrice(kase)});
}catch(e){return failure(e)}}
