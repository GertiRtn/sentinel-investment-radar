import {database} from '@/db/store';
import {identity,json,failure} from '@/lib/sentinel/api';
import {compareRow,summarise,toCsv} from '@/lib/sentinel/shadow-reader';
export const dynamic='force-dynamic';

/** Evaluation only: rules vs Nemotron shadow readings, side by side. `?format=csv` downloads a labelling sheet. */
export async function GET(request:Request){
 try{
  const owner=await identity(request),db=database();
  const readings=(await db.prepare("SELECT body FROM signal_log WHERE owner=? AND kind='shadow_reading' ORDER BY created_at DESC,id DESC LIMIT 300").bind(owner).all<{body:string}>()).results.map(r=>JSON.parse(r.body));
  const cases=(await db.prepare("SELECT id,body FROM signal_log WHERE owner=? AND kind='discovery_case' AND id IN (SELECT json_extract(body,'$.caseId') FROM signal_log WHERE owner=? AND kind='shadow_reading' ORDER BY created_at DESC,id DESC LIMIT 300)").bind(owner,owner).all<{id:string;body:string}>()).results;
  const byId=new Map(cases.map(c=>[c.id,JSON.parse(c.body)]));
  const rows=readings.map(r=>compareRow(r,byId.get(r.caseId)));
  if(new URL(request.url).searchParams.get('format')==='csv')return new Response(toCsv(rows),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="sentinel-shadow-labelling.csv"','Cache-Control':'private, no-store'}});
  return json({note:'Evaluation only. Shadow readings do not affect any conclusion, rule, queue order or label.',summary:summarise(rows),rows});
 }catch(e){return failure(e)}
}
