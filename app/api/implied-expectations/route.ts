import {identity,body,json,failure,ApiError} from '@/lib/sentinel/api';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {impliedFor,backfillShareCounts} from '@/lib/sentinel/decision-run';
import {z} from 'zod';
export const dynamic='force-dynamic';

/** What the price assumes (implied-expectations-v2). Read-only apart from the shared price archive. Not a forecast and not advice. */
export async function GET(request:Request){try{
 const owner=await identity(request),symbol=(new URL(request.url).searchParams.get('symbol')||'').toUpperCase();
 if(!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol))throw new ApiError(400,'A valid ticker is required.');
 const r=await impliedFor(owner,symbol);if(!r)throw new ApiError(404,'Sentinel has no research case or saved company for this ticker.');
 return json(r);
}catch(e){return failure(e)}}

/**
 * POST {action:'backfill', symbol?}: re-read SEC data through the normal ingest path for the owner's saved companies
 * (the requested company first) whose stored data predates the current fact parser, so cover-page share counts and the
 * xbrl-tags-v2 figures are stored. Up to 3 companies per request. Appends facts only.
 */
const Input=z.object({action:z.literal('backfill'),symbol:z.string().regex(/^[A-Z][A-Z0-9.\-]{0,9}$/).optional()}).strict();
export async function POST(request:Request){try{
 const owner=await identity(request),parsed=Input.safeParse(await body(request));
 if(!parsed.success)throw new ApiError(400,'Invalid request.');
 const email=(await getChatGPTUser())?.email;if(!email)throw new ApiError(401,'Sign in to load SEC data.');
 return json(await backfillShareCounts(owner,email,{symbol:parsed.data.symbol}));
}catch(e){return failure(e)}}
