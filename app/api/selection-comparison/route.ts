import {identity,json,failure,ApiError} from '@/lib/sentinel/api';
import {database,iso} from '@/db/store';
import {caseNewsDirection,NEWS_DIRECTION_VERSION} from '@/lib/sentinel/news-direction';
import {matchLevelOf} from '@/lib/sentinel/event-match';
import {OUTCOME_HORIZONS} from '@/lib/sentinel/outcome-observation';
import {selectionComparison,type CompareCase} from '@/lib/sentinel/selection-comparison';
export const dynamic='force-dynamic';
const CASE_LIMIT=20000;

/**
 * Selected vs assessed-not-selected vs SPY (selection-comparison-v1). Read-only and on request only: two reads of the
 * owner's stored cases and outcome records (plus one count); nothing fetched, written or changed. No page uses it yet.
 * Only screen-v2 cases are read, newest first, so a row limit can only leave out the oldest ones (and says so).
 *   GET /api/selection-comparison?horizon=5|20|60|120   (default 20)
 */
export async function GET(request:Request){try{
 const owner=await identity(request),horizon=Number(new URL(request.url).searchParams.get('horizon')??20);
 if(!(OUTCOME_HORIZONS as readonly number[]).includes(horizon))throw new ApiError(400,'horizon must be 5, 20, 60 or 120.');
 const db=database(),now=iso();
 const [cases,outcomes,older]=await db.batch([
  db.prepare(`SELECT id,created_at,json_extract(body,'$.symbol') s,json_extract(body,'$.status') status,json_extract(body,'$.conclusion') conclusion,json_extract(body,'$.decision.version') screen,json_extract(body,'$.eventMatch.version') mv,json_extract(body,'$.eventMatch.level') ml,json_extract(body,'$.event.headline') headline,json_extract(body,'$.event.providerSummary') summary,json_extract(body,'$.identity.name') name,json_extract(body,'$.newsDirection.version') dv,json_extract(body,'$.newsDirection.direction') dd FROM signal_log WHERE owner=? AND kind='discovery_case' AND json_extract(body,'$.decision.version')='research-screen-v2' ORDER BY created_at DESC,id DESC LIMIT ${CASE_LIMIT}`).bind(owner),
  db.prepare("SELECT json_extract(body,'$.caseId') c,json_extract(body,'$.symbol') s,COALESCE(json_extract(body,'$.horizonIntervals'),5) h,json_extract(body,'$.entryDate') entry,json_extract(body,'$.exitDate') exit,json_extract(body,'$.stockReturn') stock,json_extract(body,'$.benchmarkReturn') spy,json_extract(body,'$.matchedDates') dates,json_extract(body,'$.benchmark') benchmark FROM signal_log WHERE owner=? AND kind='discovery_outcome' AND COALESCE(json_extract(body,'$.horizonIntervals'),5)=?").bind(owner,horizon),
  db.prepare("SELECT COUNT(*) n FROM signal_log WHERE owner=? AND kind='discovery_case' AND COALESCE(json_extract(body,'$.decision.version'),'')<>'research-screen-v2'").bind(owner),
 ]);
 const list=(v:unknown)=>{try{const a=JSON.parse(String(v??'null'));return Array.isArray(a)?a:null}catch{return null}};
 const rows=cases.results as any[];
 const compare:CompareCase[]=rows.map(r=>{const stored=r.dv===NEWS_DIRECTION_VERSION&&r.dd;const d=caseNewsDirection({newsDirection:r.dv?{version:r.dv,direction:r.dd}:null,event:{headline:r.headline,providerSummary:r.summary}});
  return {id:String(r.id),symbol:String(r.s??''),createdAt:String(r.created_at),status:String(r.status??''),conclusion:String(r.conclusion??''),screenVersion:r.screen??null,
   matchLevel:matchLevelOf({...r,symbol:r.s}),
   direction:String(d.direction),label:{version:String(d.version),source:stored?'stored':'computed',storedVersion:r.dv??null}};});
 return json(selectionComparison({now,horizon,truncated:rows.length>=CASE_LIMIT,olderScreenCount:Number((older.results as any[])[0]?.n??0),cases:compare,
  outcomes:(outcomes.results as any[]).map(o=>({caseId:String(o.c),symbol:String(o.s??''),horizonIntervals:Number(o.h),entryDate:o.entry,exitDate:o.exit,stockReturn:o.stock,benchmarkReturn:o.spy,matchedDates:list(o.dates),benchmark:o.benchmark??null}))}));
}catch(e){return failure(e)}}
