import {identity,body,json,failure,ApiError} from '@/lib/sentinel/api';
import {assessCase,storedInvestmentCase} from '@/lib/sentinel/investment-case-run';
export const dynamic='force-dynamic';

/** Investment case research prototype (investment-case-v1). On demand only; never used for notifications, rankings or experiments. */
export async function GET(request:Request){try{
 const owner=await identity(request),caseId=new URL(request.url).searchParams.get('case')||'';
 if(!caseId)throw new ApiError(400,'A case is required.');
 return json({investmentCase:await storedInvestmentCase(owner,caseId)});
}catch(e){return failure(e)}}

export async function POST(request:Request){try{
 const owner=await identity(request),d=await body(request);
 if(typeof d.caseId!=='string'||!d.caseId.startsWith('discovery-case:')||d.caseId.length>120)throw new ApiError(400,'A discovery case is required.');
 const r=await assessCase(owner,d.caseId);if(!r)throw new ApiError(404,'Case not found.');
 return json({investmentCase:r});
}catch(e){return failure(e)}}
