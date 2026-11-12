import {database,iso} from '@/db/store';
import {identity,body,json,failure,ApiError} from '@/lib/sentinel/api';
import {collectStockQuote} from '@/app/api/stock-quote/route';
import {caseEvidenceScore} from '@/lib/sentinel/evidence-score';
import {practiceState,priceFromQuote,validateOpen,dailyMark,PRACTICE_VERSION,type PracticeTrade,type PracticeReview,type PracticeMark,type LivePrice,type PriceRef} from '@/lib/sentinel/practice';
import {z} from 'zod';
export const dynamic='force-dynamic';

const SYMBOL=/^[A-Z][A-Z0-9.\-]{0,9}$/;
const MAX_LIVE=12;

async function records(owner:string){
 const rows=await database().prepare("SELECT kind,body FROM signal_log WHERE owner=? AND kind IN ('practice_trade','practice_review','practice_mark') ORDER BY created_at,id").bind(owner).all<{kind:string;body:string}>();
 const trades:PracticeTrade[]=[],reviews:PracticeReview[]=[],marks:PracticeMark[]=[];
 for(const r of rows.results){const b=JSON.parse(r.body);if(r.kind==='practice_trade')trades.push(b);else if(r.kind==='practice_review')reviews.push(b);else marks.push(b);}
 return {trades,reviews,marks};
}

/** Live price for a symbol, or null when it cannot be fetched. Never guessed. */
async function live(symbol:string,now:string):Promise<LivePrice|null>{
 try{const q=await collectStockQuote(symbol);const p=priceFromQuote(q,now);if(typeof p==='string')return null;return {...p,stale:Date.parse(now)-Date.parse(p.at)>15*60000};}catch{return null}
}

/** Load records and mark every open position at its latest IEX price. Shared with the hourly run. */
export async function practiceSnapshot(owner:string){
 const now=iso(),rec=await records(owner);
 const closed=new Set(rec.trades.filter(t=>t.action==='close').map(t=>t.positionId));
 const symbols=[...new Set(rec.trades.filter(t=>t.action==='open'&&!closed.has(t.positionId)).map(t=>t.symbol))].slice(0,MAX_LIVE);
 const prices:Record<string,LivePrice|null>={};
 if(symbols.length){const all=[...symbols,'SPY'];const got=await Promise.all(all.map(s=>live(s,now)));all.forEach((s,i)=>prices[s]=got[i]);}
 return {now,rec,state:practiceState({...rec,live:prices,now})};
}

/** Hourly run: append at most one mark per UTC day. */
export async function markPractice(owner:string){
 const {now,rec,state}=await practiceSnapshot(owner);if(!rec.trades.length)return {status:'idle'};
 if(rec.marks.some(m=>m.date===now.slice(0,10)))return {status:'already-marked'};
 const mark=dailyMark(state,now);if(!mark)return {status:'unpriced',message:'An open position could not be priced; no mark recorded.'};
 await database().prepare("INSERT OR IGNORE INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'practice_mark',NULL,?)").bind('practice-mark:'+owner+':'+mark.date,owner,now,JSON.stringify(mark)).run();
 return {status:'marked',date:mark.date};
}

export async function GET(){try{const owner=await identity();const {state}=await practiceSnapshot(owner);return json(state)}catch(e){return failure(e)}}

const text=(min:number,max:number)=>z.string().trim().min(min).max(max);
const Input=z.discriminatedUnion('action',[
 z.object({action:z.literal('open'),requestId:z.string().uuid(),expectedSequence:z.number().int().nonnegative().max(5000),symbol:z.string().trim().toUpperCase().regex(SYMBOL),amountCents:z.number().int().positive().max(100_000_000),conviction:z.number().int().min(0).max(100),thesis:text(10,1000),exitPlan:text(2,500),killCondition:text(3,500),caseId:z.string().max(200).nullable().optional()}).strict(),
 z.object({action:z.literal('close'),requestId:z.string().uuid(),expectedSequence:z.number().int().nonnegative().max(5000),positionId:z.string().min(1).max(100),reason:text(5,500)}).strict(),
 z.object({action:z.literal('review'),requestId:z.string().uuid(),positionId:z.string().min(1).max(100),milestone:z.union([z.literal(7),z.literal(30),z.literal(90)]),decision:z.enum(['keep','close','pass']),note:text(3,500)}).strict(),
]);

export async function POST(request:Request){try{
 const owner=await identity(request),parsed=Input.safeParse(await body(request));
 if(!parsed.success)throw new ApiError(400,'Check the amount, conviction (0–100), thesis, exit plan and what would prove you wrong.');
 const d=parsed.data,db=database(),now=iso();
 const existing=await db.prepare('SELECT owner FROM signal_log WHERE id=?').bind(d.requestId).first<{owner:string}>();
 if(existing){if(existing.owner!==owner)throw new ApiError(409,'Request identifier unavailable.');const {state}=await practiceSnapshot(owner);return json(state);}
 const rec=await records(owner),state=practiceState({...rec,live:{},now});

 if(d.action==='review'){
  if(!rec.trades.some(t=>t.action==='open'&&t.positionId===d.positionId))throw new ApiError(404,'Position not found.');
  const review:PracticeReview={positionId:d.positionId,milestone:d.milestone,decision:d.decision,note:d.note,createdAt:now};
  await db.prepare("INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'practice_review',NULL,?)").bind(d.requestId,owner,now,JSON.stringify(review)).run();
 }else{
  if(state.sequence!==d.expectedSequence)throw new ApiError(409,'The practice portfolio changed. Refresh it before trying again.');
  let trade:PracticeTrade;
  if(d.action==='open'){
   const problem=validateOpen(d,state.cashCents);if(problem)throw new ApiError(400,problem);
   let caseScore:number|null=null,caseId:string|null=null;
   if(d.caseId){const c=await db.prepare("SELECT body,created_at FROM signal_log WHERE id=? AND owner=? AND kind='discovery_case'").bind(d.caseId,owner).first<{body:string;created_at:string}>();if(!c)throw new ApiError(404,'Case not found.');const b=JSON.parse(c.body);if(b.symbol!==d.symbol)throw new ApiError(400,'The case is about a different symbol.');caseId=d.caseId;caseScore=caseEvidenceScore({...b,createdAt:b.createdAt??c.created_at}).score;}
   const [p,s]=await Promise.all([quotePrice(d.symbol,now),quotePrice('SPY',now)]);
   const quantityMicros=Math.floor(d.amountCents*1_000_000/p.priceCents);if(quantityMicros<1)throw new ApiError(400,'Amount is too small for this price.');
   trade={version:PRACTICE_VERSION,action:'open',sequence:state.sequence+1,positionId:d.requestId,symbol:d.symbol,amountCents:d.amountCents,quantityMicros,price:p,spy:s,thesis:d.thesis,exitPlan:d.exitPlan,killCondition:d.killCondition,conviction:d.conviction,caseId,evidenceScore:caseScore,createdAt:now};
  }else{
   const pos=state.open.find((x:any)=>x.positionId===d.positionId);if(!pos)throw new ApiError(404,'Open position not found.');
   const [p,s]=await Promise.all([quotePrice(pos.symbol,now),quotePrice('SPY',now)]);
   trade={version:PRACTICE_VERSION,action:'close',sequence:state.sequence+1,positionId:d.positionId,symbol:pos.symbol,price:p,spy:s,reason:d.reason,createdAt:now};
  }
  // One conditional append: concurrent requests fail closed, nothing is overwritten.
  const r=await db.prepare("INSERT INTO signal_log(id,owner,created_at,kind,entity,body) SELECT ?,?,?,'practice_trade',?,? WHERE (SELECT COUNT(*) FROM signal_log WHERE owner=? AND kind='practice_trade')=?").bind(d.requestId,owner,now,trade.symbol,JSON.stringify(trade),owner,d.expectedSequence).run();
  if(r.meta.changes!==1)throw new ApiError(409,'The practice portfolio changed. Refresh it before trying again.');
 }
 const {state:after}=await practiceSnapshot(owner);return json(after);
 }catch(e){return failure(e)}}

async function quotePrice(symbol:string,now:string):Promise<PriceRef>{
 let q:any;try{q=await collectStockQuote(symbol)}catch(e){throw new ApiError(503,`No live IEX price for ${symbol} right now`+(e instanceof Error?`: ${e.message}`:'.'))}
 const p=priceFromQuote(q,now);if(typeof p==='string')throw new ApiError(400,`${symbol}: ${p}`);return p;
}
