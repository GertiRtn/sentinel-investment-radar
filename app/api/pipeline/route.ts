import {identity,json,failure} from '@/lib/sentinel/api';
import {database} from '@/db/store';
import {lastPerStage,SUCCESS,type StageRow} from '@/lib/sentinel/pipeline';
export const dynamic='force-dynamic';
const STAGE_ROWS=500;

/**
 * Read-only: the last refresh runs and what each stage did (status, elapsed time, message), plus, per step, the last
 * run, last success and last failure. It shows how the system ran; it says nothing about whether any investment idea
 * is good. Steps come from the per-stage rows (pipeline-stage-v1, one per stage as it finishes, so an assessment-only
 * call or a run cut off mid-way still counts) and, for runs before those rows existed, from the run records.
 */
export async function GET(){try{
 const owner=await identity(),db=database();
 const [runRows,stageRows]=await db.batch([
  db.prepare("SELECT created_at,body FROM signal_log WHERE owner=? AND kind='pipeline_run' ORDER BY created_at DESC,id DESC LIMIT 12").bind(owner),
  db.prepare(`SELECT created_at,body FROM signal_log WHERE owner=? AND kind='pipeline_stage' ORDER BY created_at DESC LIMIT ${STAGE_ROWS}`).bind(owner),
 ]);
 const parse=(r:any)=>{try{return JSON.parse(r.body)}catch{return null}};
 const runs=(runRows.results as any[]).map(parse).filter(Boolean);
 const fromStages:StageRow[]=(stageRows.results as any[]).map(r=>{const b=parse(r);return b?{stage:b.stage,status:b.status,at:r.created_at,elapsedMs:b.elapsedMs,message:b.message,runId:b.runId}:null}).filter(Boolean) as StageRow[];
 const seen=new Set(fromStages.map(r=>r.runId));
 const fromRuns:StageRow[]=runs.filter((r:any)=>!seen.has(r.runId)).flatMap((r:any)=>(r.stages??[]).filter((s:any)=>s.status!=='skipped').map((s:any)=>({stage:s.stage,status:s.status,at:r.startedAt,elapsedMs:s.elapsedMs,message:s.message??null,runId:r.runId??null})));
 return json({version:'pipeline-v1',steps:lastPerStage([...fromStages,...fromRuns]),success:`A step succeeded when it ran and nothing in it failed (${SUCCESS.join(' or ')}). "busy" means another assessment batch held the lease.`,
  rowsRead:{stageRecords:stageRows.results.length,runRecords:runRows.results.length,limit:STAGE_ROWS},runs,
  note:'Runs recorded since this record was introduced; earlier runs left no stage record. Elapsed times are measured inside the Worker, not the platform request limit.'});
}catch(e){return failure(e)}}
