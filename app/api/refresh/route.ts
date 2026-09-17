import {collectMarket,collectNews} from '@/lib/sentinel/collector';
import {identity,json,failure,body,ApiError} from '@/lib/sentinel/api';
export async function POST(request:Request){try{await identity(request);const d=await body(request);if(!['market','news'].includes(d.kind))throw new ApiError(400,'Unknown feed');return json(await (d.kind==='market'?collectMarket():collectNews()));}catch(e){return failure(e)}}
