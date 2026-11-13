import {identity,json,failure} from '@/lib/sentinel/api';
import {database} from '@/db/store';
export const dynamic='force-dynamic';

/**
 * Read-only: the last refresh runs and what each stage did (status, elapsed time, message).
 * It shows how the system ran; it says nothing about whether any investment idea is good.
 */
export async function GET(){try{
 const owner=await identity();
 const rows=await database().prepare("SELECT created_at,body FROM signal_log WHERE owner=? AND kind='pipeline_run' ORDER BY created_at DESC,id DESC LIMIT 12").bind(owner).all<{created_at:string;body:string}>();
 const runs=rows.results.map(r=>{try{return JSON.parse(r.body)}catch{return null}}).filter(Boolean);
 return json({version:'pipeline-v1',runs,note:'Runs recorded since this record was introduced; earlier runs left no stage record. Elapsed times are measured inside the Worker, not the platform request limit.'});
}catch(e){return failure(e)}}
