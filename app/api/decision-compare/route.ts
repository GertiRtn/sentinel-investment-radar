import {identity,body,json,failure,ApiError} from '@/lib/sentinel/api';
import {compareFor,DEFAULT_BUDGET_CENTS} from '@/lib/sentinel/decision-run';
import {z} from 'zod';
export const dynamic='force-dynamic';

/** Keep / add the stock / add SPY (decision-compare-v1). Computes only: nothing is traded and nothing is stored except the shared price archive. */
const Input=z.object({symbol:z.string().regex(/^[A-Z][A-Z0-9.\-]{0,9}$/),budgetCents:z.number().int().min(100).max(100_000_000).optional()}).strict();
export async function POST(request:Request){try{
 const owner=await identity(request),parsed=Input.safeParse(await body(request));
 if(!parsed.success)throw new ApiError(400,'A valid ticker and budget are required.');
 return json(await compareFor(owner,parsed.data.symbol,parsed.data.budgetCents??DEFAULT_BUDGET_CENTS));
}catch(e){return failure(e)}}
