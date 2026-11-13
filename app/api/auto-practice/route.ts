import {identity,body,json,failure,ApiError} from '@/lib/sentinel/api';
import {autoSnapshot,controlAutoPractice,runAutoPractice} from '@/lib/sentinel/auto-practice-run';
import {z} from 'zod';
export const dynamic='force-dynamic';

/**
 * Automated Practice experiment (virtual money only). GET shows the experiment; POST starts it, stops it
 * (no new positions; open ones still close under the exit rule) or runs one check now.
 * It never places an order and has no broker connection.
 */
export async function GET(){try{return json(await autoSnapshot(await identity()))}catch(e){return failure(e)}}

const Input=z.object({action:z.enum(['start','stop','run']),requestId:z.string().uuid()}).strict();
export async function POST(request:Request){try{
 const owner=await identity(request),parsed=Input.safeParse(await body(request));
 if(!parsed.success)throw new ApiError(400,'Invalid request.');
 const {action,requestId}=parsed.data;let run:unknown=null;
 if(action==='run'){run=await runAutoPractice(owner,'manual');}
 else{const r=await controlAutoPractice(owner,action,requestId);
  if(r==='conflict')throw new ApiError(409,'Request identifier unavailable.');
  if(r==='already_active')throw new ApiError(409,'An experiment is already running. Stop it before starting a new one.');
  if(r==='not_active')throw new ApiError(409,'No experiment is running.');}
 return json({...(await autoSnapshot(owner)),run});
}catch(e){return failure(e)}}
