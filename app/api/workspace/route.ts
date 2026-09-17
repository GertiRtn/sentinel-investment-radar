import {database,iso} from '@/db/store';
import {Workspace,initialWorkspace,mergeLegacy} from '@/lib/sentinel/contracts';
import {identity,body,failure,json,ApiError} from '@/lib/sentinel/api';
import {z} from 'zod';
export const dynamic='force-dynamic';
async function latest(owner:string){return await database().prepare('SELECT revision,data,created_at FROM workspace_revision WHERE owner=? ORDER BY revision DESC LIMIT 1').bind(owner).first<{revision:number;data:string;created_at:string}>();}
export async function GET(){try{const owner=await identity();const row=await latest(owner);return json({data:row?JSON.parse(row.data):initialWorkspace,revision:row?.revision||0,savedAt:row?.created_at||null});}catch(e){return failure(e)}}
export async function POST(request:Request){try{
 const owner=await identity(request);const input=z.object({requestId:z.string().uuid(),expectedRevision:z.number().int().min(0),operation:z.enum(['save','import']),data:Workspace}).strict().safeParse(await body(request));if(!input.success)throw new ApiError(400,'Invalid workspace fields');
 const d=input.data,db=database();const already=await db.prepare('SELECT revision,created_at,data FROM workspace_revision WHERE id=? AND owner=?').bind(d.requestId,owner).first<{revision:number;created_at:string;data:string}>();if(already)return json({revision:already.revision,savedAt:already.created_at,data:JSON.parse(already.data)});
 const previous=await latest(owner);if((previous?.revision||0)!==d.expectedRevision)throw new ApiError(409,'Another device saved newer changes. Your draft has been kept; reload server state before saving again.');
 const data=d.operation==='import'?mergeLegacy(previous?JSON.parse(previous.data):initialWorkspace,d.data):d.data;
 const at=iso();const result=await db.batch([
 db.prepare('INSERT INTO workspace_revision(id,owner,revision,created_at,data) SELECT ?,?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM workspace_revision WHERE owner=?),0)=?').bind(d.requestId,owner,d.expectedRevision+1,at,JSON.stringify(data),owner,d.expectedRevision),
 db.prepare("INSERT INTO signal_log(id,owner,created_at,kind,body) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workspace_revision WHERE id=? AND owner=?)").bind(crypto.randomUUID(),owner,at,d.operation==='import'?'legacy_import':'workspace_revision',JSON.stringify({revision:d.expectedRevision+1,...(d.operation==='import'?{legacyState:d.data,notice:'Imported now; original creation times are unknown.'}:{})}),d.requestId,owner)
 ]);if(result[0].meta.changes!==1)throw new ApiError(409,'A concurrent save arrived first. Your draft is preserved.');
 return json({revision:d.expectedRevision+1,savedAt:at,data});
 }catch(e){return failure(e)}}
