import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {identity,body,json,failure,ApiError} from '@/lib/sentinel/api';
import {verifyCase,latestVerification} from '@/lib/sentinel/event-verify-run';
import {notChecked} from '@/lib/sentinel/event-verify';
export const dynamic='force-dynamic';

/**
 * Event verification for one case (event-verify-v1). GET returns the latest stored check, or "headline only"
 * when none exists. POST runs a check now: it reads a few of the company's own 8-K filings from SEC EDGAR and
 * appends the result. It never changes the case, its screen, score, ranking, outcomes or any Practice record.
 */
export async function GET(request:Request){try{
 const owner=await identity(request),caseId=new URL(request.url).searchParams.get('case')||'';
 if(!caseId)throw new ApiError(400,'A case is required.');
 return json({verification:(await latestVerification(owner,caseId))??notChecked()});
}catch(e){return failure(e)}}

export async function POST(request:Request){try{
 const owner=await identity(request),d=await body(request);
 if(typeof d.caseId!=='string'||!d.caseId.startsWith('discovery-case:')||d.caseId.length>120)throw new ApiError(400,'A discovery case is required.');
 const user=await getChatGPTUser(),contact=(env as unknown as {SEC_CONTACT_EMAIL?:string}).SEC_CONTACT_EMAIL||user?.email||'';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact))throw new ApiError(503,'A valid SEC contact email is required to read SEC filings.');
 const v=await verifyCase(owner,d.caseId,contact);if(!v)throw new ApiError(404,'Case not found.');
 return json({verification:v});
}catch(e){return failure(e)}}
