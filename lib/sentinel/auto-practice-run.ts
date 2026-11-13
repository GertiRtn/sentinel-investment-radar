import {database,hash,iso} from '@/db/store';
import {collectStockQuote} from '@/app/api/stock-quote/route';
import {eventMatch,EVENT_MATCH_VERSION} from './event-match';
import {AUTO_POLICY,AUTO_VERSION,AUTO_RULES_TEXT,planAuto,autoState,currentExperiment,type Candidate,type Control,type DecisionRecord,type CloseRecord,type Quote} from './auto-practice';

/**
 * Runner for the automated Practice experiment (virtual money only; see auto-practice.ts for the rules).
 *
 * Records are append-only signal_log rows: auto_practice_control (start/stop), auto_practice_decision
 * (one per considered case: an open or a final skip), auto_practice_close and auto_practice_run (a summary of
 * every check, so the last check and its result are always known). Every ledger write is one conditional insert on the ledger
 * row count, so two overlapping runs cannot both spend the same cash or slot: the loser writes nothing and
 * the next run plans again from the stored ledger. Ids are derived from the case, so a retry cannot open
 * the same case twice. Prices are recorded IEX quotes fetched by the server; nothing is typed or estimated.
 * No broker, no orders, no model.
 */
const MAX_QUOTES=8,MAX_LIVE=6,LEDGER_COUNT="(SELECT COUNT(*) FROM signal_log WHERE owner=? AND kind IN ('auto_practice_decision','auto_practice_close'))";

async function ledger(owner:string){
 // One pass over the owner's rows for all four record kinds (it was four passes; see scripts/db-workload.mjs).
 const rows=await database().prepare("SELECT kind,body FROM signal_log WHERE owner=? AND kind IN ('auto_practice_control','auto_practice_decision','auto_practice_close','auto_practice_run') ORDER BY created_at,id").bind(owner).all<{kind:string;body:string}>();
 const controls:Control[]=[],decisions:DecisionRecord[]=[],closes:CloseRecord[]=[];let lastRun:any=null;
 for(const r of rows.results){const b=JSON.parse(r.body);if(r.kind==='auto_practice_control')controls.push(b);else if(r.kind==='auto_practice_decision')decisions.push(b);else if(r.kind==='auto_practice_close')closes.push(b);else lastRun=b;}
 return {controls,decisions,closes,lastRun};
}

/** Cases assessed since the experiment started and still young enough to act on. Only the fields the rules need. */
async function candidates(owner:string,startedAt:string,now:string):Promise<Candidate[]>{
 const windowStart=new Date(Date.parse(now)-(AUTO_POLICY.maxCaseAgeHours+48)*3600000).toISOString(),since=startedAt>windowStart?startedAt:windowStart;
 const rows=await database().prepare(`SELECT id,created_at,json_extract(body,'$.symbol') symbol,json_extract(body,'$.status') status,json_extract(body,'$.conclusion') conclusion,json_extract(body,'$.decision.version') screen,json_extract(body,'$.security.status') sec,json_extract(body,'$.security.version') secv,json_extract(body,'$.event.headline') headline,json_extract(body,'$.event.providerSummary') summary,json_extract(body,'$.event.publishedAt') published,json_extract(body,'$.event.firstObservedAt') seen,json_extract(body,'$.identity.name') name,json_extract(body,'$.eventMatch.version') mv,json_extract(body,'$.eventMatch.level') ml,json_extract(body,'$.evidenceScore.score') score FROM signal_log WHERE owner=? AND kind='discovery_case' AND created_at>? ORDER BY created_at ASC,id ASC LIMIT 800`).bind(owner,since).all<any>();
 return rows.results.map(r=>({caseId:r.id,symbol:String(r.symbol??''),status:String(r.status??''),assessedAt:r.created_at,publishedAt:r.published??null,firstObservedAt:r.seen??null,screenVersion:r.screen??null,conclusion:String(r.conclusion??''),securityStatus:r.sec??null,securityVersion:r.secv??null,
  matchLevel:r.mv===EVENT_MATCH_VERSION&&r.ml?String(r.ml):eventMatch({headline:r.headline,summary:r.summary,companyName:r.name,symbol:r.symbol}).level,score:typeof r.score==='number'?r.score:null,headline:String(r.headline??'')}));
}

async function quote(symbol:string):Promise<Quote|null>{
 try{const q:any=await collectStockQuote(symbol);if(!Number.isFinite(q?.bid)||!Number.isFinite(q?.ask)||q.bid<=0||q.ask<q.bid||!q.rawEventId)return null;const mid=(q.bid+q.ask)/2;return {priceCents:Math.round(mid*100),at:q.sourceTime,rawEventId:q.rawEventId,source:'IEX midpoint',spreadPct:(q.ask-q.bid)/mid*100};}catch{return null}
}
async function quotes(symbols:string[]){const out:Record<string,Quote|null>={};const list=[...new Set(symbols)];const got=await Promise.all(list.map(quote));list.forEach((s,i)=>out[s]=got[i]);return out;}

function snapshotInputs(l:Awaited<ReturnType<typeof ledger>>,experimentId:string){
 const mine=l.decisions.filter(d=>d.experimentId===experimentId),closed=new Set(l.closes.filter(c=>c.experimentId===experimentId).map(c=>c.positionId));
 const base=autoState({experimentId,decisions:l.decisions,closes:l.closes,live:{},now:iso()});
 const open=mine.filter(d=>d.kind==='open'&&!closed.has(d.positionId!)).map((d:any)=>({positionId:d.positionId as string,symbol:d.symbol as string,openedAt:d.at as string,quantityMicros:d.quantityMicros as number,spyQuantityMicros:d.spyQuantityMicros as number}));
 return {cashCents:base.cashCents,open,decidedCaseIds:mine.map(d=>d.caseId)};
}

/** One check: plan from the stored ledger, fetch only the quotes the plan needs, append what was decided. */
export async function runAutoPractice(owner:string,trigger:'hourly'|'manual'){
 const db=database(),now=iso(),l=await ledger(owner),exp=currentExperiment(l.controls);
 if(!exp)return {status:'not_started' as const};
 const snap=snapshotInputs(l,exp.experimentId);
 if(!exp.active&&!snap.open.length)return {status:'stopped' as const,experimentId:exp.experimentId};
 const cands=await candidates(owner,exp.startedAt,now);
 const base={now,startedAt:exp.startedAt,active:exp.active,...snap,candidates:cands};
 const dry=planAuto({...base,prices:{}});
 // Positions due to close are priced first; then candidates in plan order, within the quote budget.
 const wanted=dry.needsQuote.filter(s=>s!=='SPY').slice(0,MAX_QUOTES-1),prices=wanted.length?await quotes([...wanted,'SPY']):{};
 const plan=planAuto({...base,prices});
 let count=l.decisions.length+l.closes.length,conflict=false;const opened:string[]=[],closedNow:string[]=[],skipped:string[]=[];
 const append=async(id:string,kind:string,entity:string,body:unknown)=>{
  if(conflict)return false;
  const r=await db.prepare("INSERT OR IGNORE INTO signal_log(id,owner,created_at,kind,entity,body) SELECT ?,?,?,?,?,? WHERE "+LEDGER_COUNT+"=?").bind(id,owner,now,kind,entity,JSON.stringify(body),owner,count).run();
  if(r.meta.changes!==1){conflict=true;return false;}count++;return true;
 };
 for(const c of plan.closes){const id='auto-close:'+await hash(JSON.stringify([owner,exp.experimentId,c.positionId]));if(await append(id,'auto_practice_close',c.symbol,{...c,version:AUTO_VERSION,experimentId:exp.experimentId,at:now}))closedNow.push(c.symbol);}
 for(const d of [...plan.opens,...plan.skips]){const id='auto-decision:'+await hash(JSON.stringify([owner,exp.experimentId,d.caseId]));if(await append(id,'auto_practice_decision',d.symbol,{...d,version:AUTO_VERSION,experimentId:exp.experimentId,...(d.kind==='open'?{positionId:id}:{}),at:now}))(d.kind==='open'?opened:skipped).push(d.symbol);}
 const summary={version:AUTO_VERSION,experimentId:exp.experimentId,at:now,trigger,opened,closed:closedNow,skipped,waiting:plan.waiting.slice(0,20),counts:plan.counts,quotesFetched:Object.keys(prices).length,conflict,
  note:conflict?'Another check changed the ledger at the same time; the rest was left for the next check.':null};
 await db.prepare("INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'auto_practice_run',NULL,?)").bind(crypto.randomUUID(),owner,now,JSON.stringify(summary)).run();
 return {status:conflict?'partial' as const:'complete' as const,...summary};
}

/** Hourly step: does nothing (one light read) unless an experiment exists and is active or still holds positions. */
export async function autoPracticeStep(owner:string){
 const started=await database().prepare("SELECT 1 AS x FROM signal_log WHERE owner=? AND kind='auto_practice_control' LIMIT 1").bind(owner).first();
 if(!started)return {status:'not_started' as const};
 return runAutoPractice(owner,'hourly');
}

/** Current experiment for display: ledger, live marks for open positions, and what is waiting. Read-only. */
export async function autoSnapshot(owner:string){
 const now=iso(),l=await ledger(owner),exp=currentExperiment(l.controls);
 const rules={version:AUTO_VERSION,policy:AUTO_POLICY,text:AUTO_RULES_TEXT,disclaimer:'Virtual money only. No broker, no real orders. The rules are an untested hypothesis fixed before any results; this is not advice, a forecast or evidence of an edge.'};
 if(!exp)return {status:'not_started' as const,now,rules,experiment:null,state:null,waiting:[],lastRun:null};
 const snap=snapshotInputs(l,exp.experimentId),symbols=[...new Set(snap.open.map(p=>p.symbol))].slice(0,MAX_LIVE);
 const live=symbols.length?await quotes([...symbols,'SPY']):{};
 const state=autoState({experimentId:exp.experimentId,decisions:l.decisions,closes:l.closes,live,now});
 const dry=planAuto({now,startedAt:exp.startedAt,active:exp.active,...snap,candidates:await candidates(owner,exp.startedAt,now),prices:{}});
 return {status:exp.active?'active' as const:'stopped' as const,now,rules,experiment:{id:exp.experimentId,startedAt:exp.startedAt,stoppedAt:exp.stoppedAt,earlierExperiments:exp.earlier},state,
  waiting:dry.waiting.map(w=>({...w,reason:/No fresh/.test(w.reason)?'Eligible; waiting for the next check with a fresh quote (US market hours).':w.reason})),considered:dry.counts,lastRun:l.lastRun?.experimentId===exp.experimentId?l.lastRun:null};
}

export async function controlAutoPractice(owner:string,action:'start'|'stop',requestId:string){
 const db=database(),now=iso(),existing=await db.prepare('SELECT owner FROM signal_log WHERE id=?').bind(requestId).first<{owner:string}>();
 if(existing)return existing.owner===owner?'ok' as const:'conflict' as const;
 const exp=currentExperiment((await ledger(owner)).controls);
 if(action==='start'){if(exp?.active)return 'already_active' as const;const body:Control={version:AUTO_VERSION,action:'start',experimentId:requestId,at:now,policy:AUTO_POLICY};await db.prepare("INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'auto_practice_control',NULL,?)").bind(requestId,owner,now,JSON.stringify(body)).run();return 'ok' as const;}
 if(!exp?.active)return 'not_active' as const;
 const body:Control={version:AUTO_VERSION,action:'stop',experimentId:exp.experimentId,at:now};await db.prepare("INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'auto_practice_control',NULL,?)").bind(requestId,owner,now,JSON.stringify(body)).run();return 'ok' as const;
}
