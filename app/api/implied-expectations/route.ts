import {identity,json,failure,ApiError} from '@/lib/sentinel/api';
import {impliedFor} from '@/lib/sentinel/decision-run';
export const dynamic='force-dynamic';

/** What the price assumes (implied-expectations-v1). Read-only apart from the shared price archive. Not a forecast and not advice. */
export async function GET(request:Request){try{
 const owner=await identity(request),symbol=(new URL(request.url).searchParams.get('symbol')||'').toUpperCase();
 if(!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol))throw new ApiError(400,'A valid ticker is required.');
 const r=await impliedFor(owner,symbol);if(!r)throw new ApiError(404,'Sentinel has no research case or saved company for this ticker.');
 return json(r);
}catch(e){return failure(e)}}
