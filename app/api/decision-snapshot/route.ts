import {identity,body,json,failure,ApiError} from '@/lib/sentinel/api';
import {saveSnapshot,openSnapshot,recordReview,listSnapshots,replayDecisions,DEFAULT_BUDGET_CENTS} from '@/lib/sentinel/decision-run';
import {CHECKPOINTS,isCheckpoint} from '@/lib/sentinel/decision-snapshot';
import {z} from 'zod';
export const dynamic='force-dynamic';

/**
 * Decision snapshots (decision-snapshot-v1). Append-only.
 * GET ?id=      the stored snapshot unchanged (`raw` is the stored text) plus a review computed now.
 * GET ?symbol=  the owner's snapshots for a ticker, and the checkpoint templates.
 * GET ?view=replay  historical replay over stored cases (read-only apart from the price archive).
 * POST {action:'save',caseId,requestId,budgetCents?,checkpoint}  save once (a retry returns the stored record).
 * POST {action:'review',id}  append today's review as its own record.
 */
export async function GET(request:Request){try{
 const owner=await identity(request),q=new URL(request.url).searchParams;
 if(q.get('view')==='replay')return json(await replayDecisions(owner));
 const id=q.get('id');
 if(id){const r=await openSnapshot(owner,id);if(!r)throw new ApiError(404,'Snapshot not found.');return json(r);}
 const symbol=(q.get('symbol')||'').toUpperCase();if(!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol))throw new ApiError(400,'A snapshot id or a valid ticker is required.');
 return json({symbol,snapshots:await listSnapshots(owner,symbol),checkpoints:CHECKPOINTS,defaultBudgetCents:DEFAULT_BUDGET_CENTS});
}catch(e){return failure(e)}}

const Save=z.object({action:z.literal('save'),caseId:z.string().min(1).max(200),requestId:z.string().uuid(),budgetCents:z.number().int().min(100).max(100_000_000).optional(),checkpoint:z.string()}).strict();
const Review=z.object({action:z.literal('review'),id:z.string().min(1).max(200)}).strict();
export async function POST(request:Request){try{
 const owner=await identity(request),input=await body(request);
 const review=Review.safeParse(input);
 if(review.success){const r=await recordReview(owner,review.data.id);if(!r)throw new ApiError(404,'Snapshot not found.');return json(r);}
 const save=Save.safeParse(input);if(!save.success||!isCheckpoint(save.data.checkpoint))throw new ApiError(400,'Invalid request.');
 const r=await saveSnapshot(owner,{caseId:save.data.caseId,requestId:save.data.requestId,budgetCents:save.data.budgetCents??DEFAULT_BUDGET_CENTS,checkpoint:save.data.checkpoint});
 if(!r)throw new ApiError(404,'Research case not found.');if('error' in r)throw new ApiError(422,String(r.error));
 return json(r);
}catch(e){return failure(e)}}
