import {identity,body,json,failure,ApiError} from '@/lib/sentinel/api';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {database,iso} from '@/db/store';
import {resolveIdentifier,ingest} from '@/lib/sentinel/edgar';
import {evaluateEntity} from '@/lib/sentinel/criteria';
export async function GET(){try{const owner=await identity();const rows=await database().prepare('SELECT e.*,w.known_from watched_at FROM entity_watch w JOIN entity e ON e.id=w.entity_id WHERE w.owner=? ORDER BY w.known_from DESC').bind(owner).all();return json({entities:rows.results});}catch(e){return failure(e)}}
export async function POST(request:Request){try{const owner=await identity(request),d=await body(request);if(typeof d.identifier!=='string'||d.identifier.length>80)throw new ApiError(400,'Enter a ticker or CIK');const resolved=await resolveIdentifier(d.identifier,(await getChatGPTUser())!.email);if(!resolved.cik)return json(resolved);const result=await ingest(resolved.cik,(await getChatGPTUser())!.email);await database().prepare('INSERT OR IGNORE INTO entity_watch(id,owner,entity_id,known_from) VALUES(?,?,?,?)').bind(crypto.randomUUID(),owner,result.entity_id,iso()).run();await evaluateEntity(result.entity_id);return json(result);}catch(e){return failure(e)}}
