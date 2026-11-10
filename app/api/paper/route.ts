import {database,iso} from '@/db/store';
import {identity,body,json,failure,ApiError} from '@/lib/sentinel/api';
import {paperState,makeOrder,type PaperOrder} from '@/lib/sentinel/paper';
import {z} from 'zod';
export const dynamic='force-dynamic';
async function read(owner:string){const rows=await database().prepare("SELECT id,body FROM signal_log WHERE owner=? AND kind='paper_trade' ORDER BY CAST(json_extract(body,'$.sequence') AS INTEGER),id").bind(owner).all<{id:string;body:string}>();return rows.results.map(r=>JSON.parse(r.body) as PaperOrder);}
export async function GET(){try{const owner=await identity();return json(paperState(await read(owner)))}catch(e){return failure(e)}}
export async function POST(request:Request){try{
 const owner=await identity(request),parsed=z.object({requestId:z.string().uuid(),expectedVersion:z.number().int().nonnegative().max(10000),symbol:z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9.\-]{0,9}$/),side:z.enum(['buy','sell']),quantityMicros:z.number().int().positive().max(100000000),priceCents:z.number().int().positive().max(10000000),reason:z.string().trim().min(5).max(500),priceSource:z.string().trim().min(5).max(200)}).strict().safeParse(await body(request));if(!parsed.success)throw new ApiError(400,'Check the symbol, quantity, price, reason and price source.');
 const d=parsed.data,db=database();const existing=await db.prepare('SELECT owner,kind,body FROM signal_log WHERE id=?').bind(d.requestId).first<{owner:string;kind:string;body:string}>();if(existing){if(existing.owner!==owner||existing.kind!=='paper_trade')throw new ApiError(409,'Request identifier unavailable.');const o=JSON.parse(existing.body);if(['symbol','side','quantityMicros','priceCents','reason','priceSource'].some(k=>o[k]!==d[k as keyof typeof d]))throw new ApiError(409,'This request identifier was used for a different trade.');return json(paperState(await read(owner)));}
 const state=paperState(await read(owner));if(state.version!==d.expectedVersion)throw new ApiError(409,'The practice portfolio changed. Refresh it before trying again.');if(state.version>=10000)throw new ApiError(400,'Practice portfolio record limit reached.');
 let order:PaperOrder;try{order=makeOrder(state,d,iso())}catch(e){throw new ApiError(400,e instanceof Error?e.message:'Invalid trade')}
 // A single conditional append makes concurrent requests fail closed; no balance is overwritten.
 const r=await db.prepare("INSERT INTO signal_log(id,owner,created_at,kind,entity,body) SELECT ?,?,?, 'paper_trade',?,? WHERE (SELECT COUNT(*) FROM signal_log WHERE owner=? AND kind='paper_trade')=?").bind(d.requestId,owner,order.createdAt,order.symbol,JSON.stringify(order),owner,d.expectedVersion).run();if(r.meta.changes!==1)throw new ApiError(409,'The practice portfolio changed. Refresh it before trying again.');return json(paperState(await read(owner)));
 }catch(e){return failure(e)}}
