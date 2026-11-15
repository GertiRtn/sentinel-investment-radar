import {identity,body,json,failure,ApiError} from '@/lib/sentinel/api';
import {v2Snapshot,controlV2,runV2,v2BackfillCount} from '@/lib/sentinel/auto-practice-v2-run';
import {z} from 'zod';
export const dynamic='force-dynamic';

/**
 * auto-practice-v2 (virtual money only; docs/specs/auto-practice-v2-spec-2026-11-15.md). Separate from auto-practice-v1.
 * GET: the experiment (signal ledger, portfolio, comparison groups, judging). GET ?view=count: how many past stored cases
 * would have met the entry rules, per month (read-only apart from the shared price archive).
 * POST: start, stop (no new signals or positions; open ones still close and follow-up jobs still run) or run one check now.
 * It never places an order and has no broker connection.
 */
export async function GET(request:Request){try{
 const owner=await identity(request),view=new URL(request.url).searchParams.get('view');
 if(view==='count')return json(await v2BackfillCount(owner));
 if(view!==null)throw new ApiError(400,'Unknown view.');
 return json(await v2Snapshot(owner));
}catch(e){return failure(e)}}

const Input=z.object({action:z.enum(['start','stop','run']),requestId:z.string().uuid()}).strict();
export async function POST(request:Request){try{
 const owner=await identity(request),parsed=Input.safeParse(await body(request));
 if(!parsed.success)throw new ApiError(400,'Invalid request.');
 const {action,requestId}=parsed.data;let run:unknown=null;
 if(action==='run'){run=await runV2(owner,'manual');}
 else{const r=await controlV2(owner,action,requestId);
  if(r==='conflict')throw new ApiError(409,'Request identifier unavailable.');
  if(r==='already_active')throw new ApiError(409,'An auto-practice-v2 experiment is already running. Stop it before starting a new one.');
  if(r==='not_active')throw new ApiError(409,'No auto-practice-v2 experiment is running.');}
 return json({...(await v2Snapshot(owner)),run});
}catch(e){return failure(e)}}
