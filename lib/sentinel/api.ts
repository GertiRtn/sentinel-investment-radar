import {getChatGPTUser} from '@/app/chatgpt-auth';
export async function identity(request?:Request){if(request&&request.method!=='GET'){const origin=request.headers.get('origin');if(!origin||origin!==new URL(request.url).origin)throw new ApiError(403,'Request origin rejected');}const u=await getChatGPTUser();if(!u)throw new ApiError(401,'Sign in to access your research');return u.userId;}
export class ApiError extends Error{constructor(public status:number,message:string){super(message)}}
export function failure(e:unknown){if(e instanceof ApiError)return Response.json({error:e.message},{status:e.status});console.error('Sentinel request failed',e instanceof Error?e.message:'Unknown error');return Response.json({error:'The server could not complete this request. Your unsaved input is still on screen.'},{status:503});}
export async function body(request:Request){const text=await request.text();if(text.length>180000)throw new ApiError(413,'Input too large');try{return JSON.parse(text)}catch{throw new ApiError(400,'Invalid request')}}
export const json=(data:unknown)=>Response.json(data,{headers:{'Cache-Control':'private, no-store'}});
