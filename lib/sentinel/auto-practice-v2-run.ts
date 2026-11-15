import {env} from 'cloudflare:workers';
import {database,hash,iso} from '@/db/store';
import {collectStockQuote} from '@/app/api/stock-quote/route';
import {archivedDailyBars} from './daily-bars';
import {eventMatch,EVENT_MATCH_VERSION} from './event-match';
import {caseNewsDirection} from './news-direction';
import {closeFromBars} from './last-close';
import {pointInTimeVerdict} from './investment-case-run';
import {
 V2_VERSION,V2_SPEC,V2_POLICY,V2_RULES_TEXT,V2_DISCLAIMER,meetsResearchRules,storedRuleFailure,decide,shadowFields,priceSignal,exitClosed,
 planPortfolio,portfolioState,judge,backfillCount,comparisonGroup,average,closesBy,sessionsOf,firstFullSession,nyDate,freshQuote,regularSession,
 type V2Case,type Close,type PriorSignal,type Quote,type FillRecord,type CloseRecord,type PricedSignal,
} from './auto-practice-v2';

/**
 * Runner for auto-practice-v2 (virtual money only; rules in auto-practice-v2.ts and docs/specs/auto-practice-v2-spec-2026-11-15.md).
 *
 * Append-only signal_log kinds, all separate from v1's `auto_practice_*` kinds (v1 never reads them):
 *  auto_practice_v2_control     start / stop
 *  auto_practice_v2_decision    one per considered case that met the research rules: a signal, or not entered with the rule that failed
 *  auto_practice_v2_fill        one per signal: the portfolio opened it, or did not take it (slots full, no price, ...)
 *  auto_practice_v2_close       one per closed portfolio position
 *  auto_practice_v2_result      one per signal once its exit session has closed: adjusted-close prices and returns (the signal ledger)
 *  auto_practice_v2_shadow      one per signal: the investment-case verdict as known at assessment time, or "not reconstructable"
 *  auto_practice_v2_comparison  one per research-rules case assessed during the experiment: the same 20-session pricing (section 6)
 *  auto_practice_v2_run         one per check
 * Decisions, fills and closes are written with one conditional insert on their combined row count, so two overlapping
 * checks cannot both decide (the loser writes nothing and the next check plans again). The other records have ids
 * derived from the case, so a retry appends nothing. Prices are recorded IEX data fetched by the server.
 */
const MAX_PRICE_LOOKUPS=6,MAX_QUOTES=8,MAX_RESULTS=4,MAX_COMPARISONS=4,MAX_SHADOW=2,BUDGET_MS=25000,MAX_BACKFILL_SYMBOLS=80;
const KINDS="('auto_practice_v2_control','auto_practice_v2_decision','auto_practice_v2_fill','auto_practice_v2_close','auto_practice_v2_result','auto_practice_v2_shadow','auto_practice_v2_comparison','auto_practice_v2_run')";
const GUARDED="(SELECT COUNT(*) FROM signal_log WHERE owner=? AND kind IN ('auto_practice_v2_decision','auto_practice_v2_fill','auto_practice_v2_close'))";
type Control={version:string;action:'start'|'stop';experimentId:string;at:string;policy?:unknown};
const creds=()=>{const c=env as unknown as {ALPACA_DATA_KEY_ID?:string;ALPACA_DATA_SECRET?:string};return c.ALPACA_DATA_KEY_ID&&c.ALPACA_DATA_SECRET?c as {ALPACA_DATA_KEY_ID:string;ALPACA_DATA_SECRET:string}:null;};
const day=(iso:string,offsetDays=0)=>new Date(Date.parse(iso)+offsetDays*86400000).toISOString().slice(0,10);
const SYMBOL=/^[A-Z][A-Z0-9.\-]{0,9}$/;

async function ledger(owner:string){
 const rows=await database().prepare(`SELECT id,kind,created_at,body FROM signal_log WHERE owner=? AND kind IN ${KINDS} ORDER BY created_at,id`).bind(owner).all<{id:string;kind:string;created_at:string;body:string}>();
 const out={controls:[] as Control[],decisions:[] as any[],fills:[] as FillRecord[],closes:[] as CloseRecord[],results:[] as any[],shadows:[] as any[],comparisons:[] as any[],lastRun:null as any,guarded:0};
 for(const r of rows.results){const b=JSON.parse(r.body);
  switch(r.kind){case 'auto_practice_v2_control':out.controls.push(b);break;case 'auto_practice_v2_decision':out.decisions.push(b);out.guarded++;break;case 'auto_practice_v2_fill':out.fills.push(b);out.guarded++;break;
   case 'auto_practice_v2_close':out.closes.push(b);out.guarded++;break;case 'auto_practice_v2_result':out.results.push(b);break;case 'auto_practice_v2_shadow':out.shadows.push(b);break;case 'auto_practice_v2_comparison':out.comparisons.push(b);break;default:out.lastRun=b;}}
 return out;
}
export function currentV2(controls:Control[]){
 const sorted=[...controls].sort((a,b)=>a.at.localeCompare(b.at)),start=sorted.filter(c=>c.action==='start').at(-1);if(!start)return null;
 const stop=sorted.find(c=>c.action==='stop'&&c.experimentId===start.experimentId);
 return {experimentId:start.experimentId,startedAt:start.at,stoppedAt:stop?.at??null,active:!stop,earlier:new Set(sorted.filter(c=>c.action==='start').map(c=>c.experimentId)).size-1};
}

const CASE_FIELDS=`id,created_at,json_extract(body,'$.symbol') symbol,json_extract(body,'$.status') status,json_extract(body,'$.conclusion') conclusion,json_extract(body,'$.decision.version') screen,
 json_extract(body,'$.security.status') sec,json_extract(body,'$.security.version') secv,json_extract(body,'$.event.headline') headline,json_extract(body,'$.event.providerSummary') summary,
 json_extract(body,'$.identity.name') name,json_extract(body,'$.identity.cik') cik,json_extract(body,'$.eventMatch.version') mv,json_extract(body,'$.eventMatch.level') ml,json_extract(body,'$.evidenceScore.score') score,
 json_extract(body,'$.newsDirection.version') ndv,json_extract(body,'$.newsDirection.direction') nd,json_extract(body,'$.newsDirection.label') ndl,json_extract(body,'$.price.basis') basis,json_extract(body,'$.price.status') pstatus,
 json_extract(body,'$.event.analysis.topics') topics`;
/** A stored case as the v2 rules read it. Match and news direction: the stored label for the current version, otherwise computed from the stored text (as v1 and the idea list do). */
function toCase(r:any):V2Case&{researchRules:boolean}{
 const nd=caseNewsDirection({newsDirection:r.ndv?{version:r.ndv,direction:r.nd,label:r.ndl}:null,event:{headline:r.headline,providerSummary:r.summary}});
 let topics:string[]=[];try{const t=JSON.parse(r.topics??'[]');if(Array.isArray(t))topics=t.map((x:any)=>String(typeof x==='string'?x:x?.topic??x?.label??x)).slice(0,5);}catch{}
 const c={caseId:String(r.id),symbol:String(r.symbol??''),status:String(r.status??''),assessedAt:String(r.created_at),screenVersion:r.screen??null,conclusion:String(r.conclusion??''),
  newsDirection:String(nd.direction),newsLabel:String(nd.label),securityStatus:r.sec??null,securityVersion:r.secv??null,
  matchLevel:r.mv===EVENT_MATCH_VERSION&&r.ml?String(r.ml):eventMatch({headline:r.headline,summary:r.summary,companyName:r.name,symbol:r.symbol}).level,
  score:typeof r.score==='number'?r.score:null,priceBasis:r.basis??(r.pstatus?String(r.pstatus):null),topics,headline:String(r.headline??''),cik:r.cik?String(r.cik):null};
 return {...c,researchRules:meetsResearchRules(c)};
}
const note=(c:V2Case)=>({assessedAt:c.assessedAt,headline:c.headline.slice(0,300),news:c.newsLabel,matchLevel:c.matchLevel,security:c.securityStatus,score:c.score});

async function researchRuleCases(owner:string,since:string){
 const rows=await database().prepare(`SELECT ${CASE_FIELDS} FROM signal_log WHERE owner=? AND kind='discovery_case' AND created_at>? AND json_extract(body,'$.decision.version')='research-screen-v2' AND json_extract(body,'$.conclusion')='INVESTIGATE' AND json_extract(body,'$.status')='complete' ORDER BY created_at ASC,id ASC LIMIT 5000`).bind(owner,since).all<any>();
 return rows.results.map(toCase);
}

/** SPY daily closes from a fixed date (so the 6-hour archive is reused) and the session calendar. Null when unavailable: nothing that needs the calendar is decided. */
async function spyCalendar(from:string,now:string){
 const c=creds();if(!c)return null;
 try{const b=await archivedDailyBars('SPY',day(from,-10),day(now),c);const closes=closesBy(b.payload,now);return {closes,sessions:sessionsOf(closes),rawId:b.rawId};}catch{return null}
}
async function closeAt(symbol:string,at:string):Promise<Close|'pending'>{
 const c=creds();if(!c||!SYMBOL.test(symbol))return SYMBOL.test(symbol)?'pending':null;
 try{const b=await archivedDailyBars(symbol,day(at,-10),day(at),c);const lc=closeFromBars(b.payload,symbol,at,b.rawId);return lc?{close:lc.close,sessionDate:lc.sessionDate,rawEventId:lc.rawEventId}:null;}catch{return 'pending'}
}
/** Adjusted closes for pricing. `permanent`: the source refused this symbol (bad ticker or HTTP 4xx other than 429), so retrying cannot help. */
async function stockCloses(symbol:string,from:string,now:string):Promise<{closes:Record<string,number>;rawId:string}|{permanent:string}|null>{
 if(!SYMBOL.test(symbol))return {permanent:'The case has no usable ticker.'};
 const c=creds();if(!c)return null;
 try{const b=await archivedDailyBars(symbol,day(from,-5),day(now),c);return {closes:closesBy(b.payload,now),rawId:b.rawId};}
 catch(e){const m=e instanceof Error?e.message:'';return /HTTP 4(?!29)\d\d/.test(m)?{permanent:'The price source refused this symbol ('+m+')'}:null;}
}
const unpriceable=(recordedAt:string,sessions:string[],reason:string)=>{const entry=firstFullSession(recordedAt,sessions)!;return {status:'no_price' as const,reason,entryDate:entry,exitDate:sessions[sessions.indexOf(entry)+V2_POLICY.holdSessions]};};
async function quote(symbol:string):Promise<Quote|null>{
 try{const q:any=await collectStockQuote(symbol);if(!Number.isFinite(q?.bid)||!Number.isFinite(q?.ask)||q.bid<=0||q.ask<q.bid||!q.rawEventId)return null;const mid=(q.bid+q.ask)/2;return {priceCents:Math.round(mid*100),at:q.sourceTime,rawEventId:q.rawEventId,source:'IEX midpoint',spreadPct:(q.ask-q.bid)/mid*100};}catch{return null}
}
async function quotes(symbols:string[]){const out:Record<string,Quote|null>={};const list=[...new Set(symbols)];const got=await Promise.all(list.map(quote));list.forEach((s,i)=>out[s]=got[i]);return out;}

function portfolioInputs(l:Awaited<ReturnType<typeof ledger>>,experimentId:string){
 const fills=l.fills.filter(f=>f.experimentId===experimentId),closed=new Set(l.closes.filter(c=>c.experimentId===experimentId).map(c=>c.positionId)),filled=new Set(fills.map(f=>f.caseId));
 const open=fills.filter(f=>f.kind==='open'&&!closed.has(f.positionId!)).map((f:any)=>({positionId:f.positionId,caseId:f.caseId,symbol:f.symbol,openedAt:f.at,quantityMicros:f.quantityMicros,spyQuantityMicros:f.spyQuantityMicros}));
 const signals=l.decisions.filter(d=>d.experimentId===experimentId&&d.outcome==='signal');
 const awaiting=signals.filter(s=>!filled.has(s.caseId)).map(s=>({caseId:s.caseId,symbol:s.symbol,assessedAt:s.case.assessedAt}));
 const state=portfolioState({experimentId,fills:l.fills,closes:l.closes,live:{}});
 return {open,awaiting,cashCents:state.cashCents,signals};
}

/** One check. Decides new cases, runs the portfolio, then the follow-up jobs (signal prices, comparison prices, shadow verdicts) within a time budget. */
export async function runV2(owner:string,trigger:'hourly'|'manual'){
 const t0=Date.now(),db=database(),now=iso(),l=await ledger(owner),exp=currentV2(l.controls);
 if(!exp)return {status:'not_started' as const};
 const id=exp.experimentId,mine=l.decisions.filter(d=>d.experimentId===id),decided=new Set(mine.map(d=>d.caseId));
 const spy=await spyCalendar(exp.startedAt,now),sessions=spy?.sessions??null;
 let count=l.guarded,conflict=false;
 const guarded=async(rowId:string,kind:string,entity:string,body:unknown)=>{
  if(conflict)return false;
  const r=await db.prepare(`INSERT OR IGNORE INTO signal_log(id,owner,created_at,kind,entity,body) SELECT ?,?,?,?,?,? WHERE ${GUARDED}=?`).bind(rowId,owner,now,kind,entity,JSON.stringify(body),owner,count).run();
  if(r.meta.changes!==1){conflict=true;return false;}count++;return true;
 };
 const once=async(rowId:string,kind:string,entity:string,body:unknown)=>!!(await db.prepare('INSERT OR IGNORE INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,?,?,?)').bind(rowId,owner,now,kind,entity,JSON.stringify(body)).run()).meta.changes;
 const rid=async(kind:string,caseId:string)=>kind+':'+await hash(JSON.stringify([owner,id,caseId]));
 const report={signals:[] as string[],notEntered:{} as Record<string,number>,waiting:[] as {caseId:string;symbol:string;reason:string}[],opened:[] as string[],notTaken:[] as string[],closed:[] as string[],priced:0,comparisons:0,shadows:0,budgetExhausted:false};

 // 1. Entry decisions (only while running). Prospective: cases recorded after the start.
 const all=await researchRuleCases(owner,exp.startedAt);
 if(exp.active){
  const prior:PriorSignal[]=mine.filter(d=>d.outcome==='signal').map(d=>({caseId:d.caseId,symbol:d.symbol,assessedAt:d.case.assessedAt}));
  let lookups=0;const held=new Set<string>(); // a company with an undecided earlier case: its later cases wait too, so rule 6 sees cases in order
  for(const c of all){
   if(decided.has(c.caseId)||Date.parse(c.assessedAt)>Date.parse(now))continue;
   let close:Close|'pending'=null;
   if(!storedRuleFailure(c)){
    if(held.has(c.symbol)){report.waiting.push({caseId:c.caseId,symbol:c.symbol,reason:'An earlier case for this company is still undecided.'});continue;}
    if(lookups>=MAX_PRICE_LOOKUPS){held.add(c.symbol);report.waiting.push({caseId:c.caseId,symbol:c.symbol,reason:'Price lookup limit for this check reached.'});continue;}
    lookups++;close=await closeAt(c.symbol,c.assessedAt);
    // A price source that stays unreachable past the first full session after the case counts as no price (unknown is never a pass).
    if(close==='pending'&&sessions&&firstFullSession(c.assessedAt,sessions))close=null;
   }
   const d=decide(c,close,prior,sessions);
   if(!d){held.add(c.symbol);report.waiting.push({caseId:c.caseId,symbol:c.symbol,reason:close==='pending'?'IEX daily closes could not be read yet.':'The SPY session calendar is unavailable.'});continue;}
   let shadow=null;
   if(d.outcome==='signal'){const sic=c.cik&&/^\d{10}$/.test(c.cik)?(await db.prepare('SELECT sic FROM entity WHERE id=?').bind('sec:'+c.cik).first<{sic:string|null}>())?.sic??null:null;shadow=shadowFields(c,sic);}
   const body={version:V2_VERSION,experimentId:id,caseId:c.caseId,symbol:c.symbol,outcome:d.outcome,code:d.code,reason:d.reason,close:d.close,case:note(c),...(shadow?{shadow}:{}),at:now};
   if(!await guarded(await rid('auto-v2-decision',c.caseId),'auto_practice_v2_decision',c.symbol,body))break;
   decided.add(c.caseId);
   if(d.outcome==='signal'){prior.push({caseId:c.caseId,symbol:c.symbol,assessedAt:c.assessedAt});mine.push(body);report.signals.push(c.symbol);}else report.notEntered[d.code]=(report.notEntered[d.code]??0)+1;
  }
 }

 // 2. Virtual portfolio: closes first, then fills for signals without a portfolio record.
 if(!conflict){
  const p=portfolioInputs({...l,decisions:mine.concat(l.decisions.filter(d=>d.experimentId!==id))},id);
  if(!exp.active){for(const s of p.awaiting){if(await guarded(await rid('auto-v2-fill',s.caseId),'auto_practice_v2_fill',s.symbol,{kind:'not_taken',caseId:s.caseId,symbol:s.symbol,code:'stopped',reason:'Not taken: the experiment was stopped before a fill.',version:V2_VERSION,experimentId:id,at:now}))report.notTaken.push(s.symbol);}p.awaiting=[];}
  const base={now,cashCents:p.cashCents,open:p.open,awaiting:p.awaiting,sessions};
  const dry=planPortfolio({...base,prices:{}}),wanted=regularSession(now)?dry.needsQuote.filter(s=>s!=='SPY').slice(0,MAX_QUOTES-1):[];
  const prices=wanted.length?await quotes([...wanted,'SPY']):{};
  const plan=planPortfolio({...base,prices});
  for(const c of plan.closes)if(await guarded(await rid('auto-v2-close',c.positionId),'auto_practice_v2_close',c.symbol,{...c,version:V2_VERSION,experimentId:id,at:now}))report.closed.push(c.symbol);
  for(const f of plan.fills){const fid=await rid('auto-v2-fill',f.caseId);if(await guarded(fid,'auto_practice_v2_fill',f.symbol,{...f,version:V2_VERSION,experimentId:id,...(f.kind==='open'?{positionId:fid}:{}),at:now}))(f.kind==='open'?report.opened:report.notTaken).push(f.symbol);}
  report.waiting.push(...plan.waiting.filter(w=>w.caseId).map(w=>({caseId:w.caseId!,symbol:w.symbol,reason:w.reason})));
 }

 // 3. Signal ledger prices, once the exit session (entry + 20) has closed.
 const over=()=>{if(Date.now()-t0>BUDGET_MS){report.budgetExhausted=true;return true;}return false;};
 if(sessions&&spy){
  const done=new Set(l.results.filter(r=>r.experimentId===id).map(r=>r.caseId));
  for(const s of mine.filter(d=>d.outcome==='signal'&&!done.has(d.caseId)&&exitClosed(d.case.assessedAt,sessions)).slice(0,MAX_RESULTS)){
   if(over())break;const bars=await stockCloses(s.symbol,s.case.assessedAt,now);if(!bars)continue;
   const price='permanent' in bars?unpriceable(s.case.assessedAt,sessions,bars.permanent):priceSignal(s.case.assessedAt,bars.closes,spy.closes);if(price.status==='pending')continue;
   if(await once(await rid('auto-v2-result',s.caseId),'auto_practice_v2_result',s.symbol,{version:V2_VERSION,experimentId:id,caseId:s.caseId,symbol:s.symbol,assessedAt:s.case.assessedAt,...price,basis:'Alpaca IEX daily closes, adjustment all (splits and dividends)',rawIds:'rawId' in bars?[bars.rawId,spy.rawId]:[spy.rawId],at:now}))report.priced++;
  }
  // 4. Comparison groups: every research-rules case assessed during the experiment, priced the same way.
  const compared=new Set(l.comparisons.filter(r=>r.experimentId===id).map(r=>r.caseId));
  for(const c of all.filter(c=>!compared.has(c.caseId)&&exitClosed(c.assessedAt,sessions)).slice(0,MAX_COMPARISONS)){
   if(over())break;const bars=await stockCloses(c.symbol,c.assessedAt,now);if(!bars)continue;
   const price='permanent' in bars?unpriceable(c.assessedAt,sessions,bars.permanent):priceSignal(c.assessedAt,bars.closes,spy.closes);if(price.status==='pending')continue;
   if(await once(await rid('auto-v2-comparison',c.caseId),'auto_practice_v2_comparison',c.symbol,{version:V2_VERSION,experimentId:id,caseId:c.caseId,symbol:c.symbol,assessedAt:c.assessedAt,group:comparisonGroup(c.newsDirection),news:c.newsLabel,...price,rawIds:'rawId' in bars?[bars.rawId,spy.rawId]:[spy.rawId],at:now}))report.comparisons++;
  }
 }
 // 5. Shadow verdicts for signals that have none (section 2a). Never read by any entry rule.
 const shadowed=new Set(l.shadows.filter(r=>r.experimentId===id).map(r=>r.caseId));
 for(const s of mine.filter(d=>d.outcome==='signal'&&!shadowed.has(d.caseId)).slice(0,MAX_SHADOW)){
  if(over())break;
  let v:any;try{v=await pointInTimeVerdict(owner,s.caseId);}catch{continue}
  if(await once(await rid('auto-v2-shadow',s.caseId),'auto_practice_v2_shadow',s.symbol,{version:V2_VERSION,experimentId:id,caseId:s.caseId,symbol:s.symbol,assessedAt:s.case.assessedAt,investmentCase:v,use:'Shadow field only. Never used to enter, size or exit.',at:now}))report.shadows++;
 }

 const summary={version:V2_VERSION,experimentId:id,at:now,trigger,active:exp.active,...report,calendar:sessions?{sessions:sessions.length,last:sessions.at(-1)??null}:null,conflict,elapsedMs:Date.now()-t0,
  note:conflict?'Another check changed the ledger at the same time; the rest was left for the next check.':null};
 await db.prepare("INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'auto_practice_v2_run',NULL,?)").bind(crypto.randomUUID(),owner,now,JSON.stringify(summary)).run();
 return {status:conflict||report.budgetExhausted?'partial' as const:'complete' as const,...summary};
}

/** Hourly step: one light read unless an auto-practice-v2 experiment exists. */
export async function autoPracticeV2Step(owner:string){
 const started=await database().prepare("SELECT 1 AS x FROM signal_log WHERE owner=? AND kind='auto_practice_v2_control' LIMIT 1").bind(owner).first();
 if(!started)return {status:'not_started' as const};
 return runV2(owner,'hourly');
}

export const v2Rules=()=>({version:V2_VERSION,spec:V2_SPEC,policy:V2_POLICY,text:V2_RULES_TEXT,disclaimer:V2_DISCLAIMER});

/** Read-only view: the signal ledger with its shadow fields, the portfolio, the comparison groups and where judging stands. */
export async function v2Snapshot(owner:string){
 const now=iso(),l=await ledger(owner),exp=currentV2(l.controls);
 if(!exp)return {status:'not_started' as const,now,rules:v2Rules(),experiment:null};
 const id=exp.experimentId,mine=l.decisions.filter(d=>d.experimentId===id),signals=mine.filter(d=>d.outcome==='signal');
 const results=new Map(l.results.filter(r=>r.experimentId===id).map(r=>[r.caseId,r])),shadows=new Map(l.shadows.filter(r=>r.experimentId===id).map(r=>[r.caseId,r]));
 const fills=new Map(l.fills.filter(f=>f.experimentId===id).map(f=>[f.caseId,f]));
 const ledgerRows=signals.map(s=>{const r=results.get(s.caseId),sh=shadows.get(s.caseId),f=fills.get(s.caseId);
  return {caseId:s.caseId,symbol:s.symbol,assessedAt:s.case.assessedAt,headline:s.case.headline,close:s.close,shadow:{...s.shadow,investmentCase:sh?(sh.investmentCase.status==='computed'?{verdict:sh.investmentCase.verdict.id,text:sh.investmentCase.verdict.text,version:sh.investmentCase.version,spec:sh.investmentCase.spec}:{verdict:'not_reconstructable',reason:sh.investmentCase.reason}):'not computed yet'},
   result:r?(r.status==='priced'?{status:'priced',entryDate:r.entryDate,exitDate:r.exitDate,grossReturn:r.grossReturn,afterCostReturn:r.afterCostReturn,spyReturn:r.spyReturn,excessReturn:r.excessReturn}:{status:r.status,reason:r.reason,entryDate:r.entryDate,exitDate:r.exitDate}):{status:'open'},
   portfolio:f?(f.kind==='open'?'taken':`not taken: ${f.code.replace('_',' ')}`):'awaiting a fill'};});
 const live:Record<string,Quote|null>={};const p=portfolioInputs(l,id),sym=[...new Set(p.open.map(x=>x.symbol))].slice(0,6);
 if(sym.length&&regularSession(now))Object.assign(live,await quotes([...sym,'SPY']));
 for(const k of Object.keys(live))if(!freshQuote(live[k],Date.parse(now)))live[k]=null;
 const portfolio=portfolioState({experimentId:id,fills:l.fills,closes:l.closes,live});
 const comps=l.comparisons.filter(c=>c.experimentId===id&&c.status==='priced');
 const priced:PricedSignal[]=ledgerRows.filter(r=>r.result.status==='priced').map(r=>({caseId:r.caseId,symbol:r.symbol,assessedAt:r.assessedAt,exitDate:(r.result as any).exitDate,excessReturn:(r.result as any).excessReturn}));
 const main=(by:string)=>average(comps.filter(c=>c.group==='research_rules_not_good_news'&&c.assessedAt<=by).map(c=>c.excessReturn));
 const seen=new Map<string,number>();for(const d of mine)seen.set(d.caseId,(seen.get(d.caseId)??0)+1);
 const notTaken:Record<string,number>={};for(const f of l.fills.filter(f=>f.experimentId===id&&f.kind==='not_taken'))notTaken[f.code]=(notTaken[f.code]??0)+1;
 const judging=judge({signals:signals.length,priced,noPrice:ledgerRows.filter(r=>r.result.status==='no_price').length,duplicates:[...seen.values()].filter(n=>n>1).length,
  fills:{opened:portfolio.open.length+portfolio.closed.length,notTaken},comparisonAverageAt:main});
 // Secondary figures (shown, never used for the success test).
 const v1=await database().prepare("SELECT body FROM signal_log WHERE owner=? AND kind='auto_practice_close' AND created_at>?").bind(owner,exp.startedAt).all<{body:string}>();
 const v1Rel=v1.results.map(r=>JSON.parse(r.body)).map(c=>(c.proceedsCents-c.spyProceedsCents)/100000);
 const outcomes=await database().prepare("SELECT json_extract(body,'$.excessReturn') x FROM signal_log WHERE owner=? AND kind='discovery_outcome' AND json_extract(body,'$.horizonIntervals')=20 AND json_extract(body,'$.caseAt')>?").bind(owner,exp.startedAt).all<{x:number}>();
 const notEntered:Record<string,number>={};for(const d of mine.filter(d=>d.outcome!=='signal'))notEntered[d.code]=(notEntered[d.code]??0)+1;
 const n=(xs:unknown[])=>xs.length;
 return {status:exp.active?'active' as const:'stopped' as const,now,rules:v2Rules(),experiment:{id,startedAt:exp.startedAt,stoppedAt:exp.stoppedAt,earlierExperiments:exp.earlier},
  signalLedger:ledgerRows.reverse(),notEntered,portfolio,judging,
  comparison:{
   main:{label:'Met research rules, not good news (main comparison)',cases:n(comps.filter(c=>c.group==='research_rules_not_good_news')),averageExcess:main('9999')},
   secondary:[
    {label:'SPY on the signals’ dates (average 20-session return)',cases:priced.length,average:average(ledgerRows.filter(r=>r.result.status==='priced').map(r=>(r.result as any).spyReturn))},
    {label:'Met research rules, all news directions (includes v2’s own signals; context only)',cases:comps.length,averageExcess:average(comps.map(c=>c.excessReturn))},
    {label:'auto-practice-v1 positions closed in the same period (30 calendar days, live quotes, SPY paying the same costs)',cases:v1Rel.length,averageExcess:average(v1Rel)},
    {label:'Every assessed case, outcome table at 20 intervals (gross; entry at the first close after the case date)',cases:outcomes.results.length,averageExcess:average(outcomes.results.map(r=>Number(r.x)).filter(Number.isFinite))},
   ],
   note:'Excess = 20-session return after 15 bp per side minus SPY on the same dates, except where a row says otherwise. Secondary rows are context, not part of the test.'},
  lastRun:l.lastRun?.experimentId===id?l.lastRun:null};
}

export async function controlV2(owner:string,action:'start'|'stop',requestId:string){
 const db=database(),now=iso(),existing=await db.prepare('SELECT owner FROM signal_log WHERE id=?').bind(requestId).first<{owner:string}>();
 if(existing)return existing.owner===owner?'ok' as const:'conflict' as const;
 const exp=currentV2((await ledger(owner)).controls);
 if(action==='start'){if(exp?.active)return 'already_active' as const;
  await db.prepare("INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'auto_practice_v2_control',NULL,?)").bind(requestId,owner,now,JSON.stringify({version:V2_VERSION,action:'start',experimentId:requestId,at:now,policy:V2_POLICY,spec:V2_SPEC})).run();return 'ok' as const;}
 if(!exp?.active)return 'not_active' as const;
 await db.prepare("INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'auto_practice_v2_control',NULL,?)").bind(requestId,owner,now,JSON.stringify({version:V2_VERSION,action:'stop',experimentId:exp.experimentId,at:now})).run();return 'ok' as const;
}

/**
 * Section 9 count: how many past stored cases would have met section 2, per month. Read-only apart from the shared
 * price archive. Rules 1–4 from the stored cases; rule 5 from IEX daily bars fetched now (adjusted for splits and
 * dividends as known today, so a later split can move a close across $5); rule 6 simulated oldest first.
 */
export async function v2BackfillCount(owner:string){
 const now=iso();
 const rows=await database().prepare(`SELECT ${CASE_FIELDS} FROM signal_log WHERE owner=? AND kind='discovery_case' ORDER BY created_at ASC,id ASC`).bind(owner).all<any>();
 const cases=rows.results.map(toCase),eligible=cases.filter(c=>c.researchRules&&!storedRuleFailure(c));
 const c=creds(),closes:Record<string,Close|undefined>={},bySymbol=new Map<string,typeof eligible>();
 for(const e of eligible){if(!SYMBOL.test(e.symbol)){closes[e.caseId]=null;continue;}bySymbol.set(e.symbol,[...(bySymbol.get(e.symbol)??[]),e]);}
 let fetched=0,failed=0;
 for(const [symbol,list] of [...bySymbol.entries()].slice(0,c?MAX_BACKFILL_SYMBOLS:0)){
  try{const b=await archivedDailyBars(symbol,day(list[0].assessedAt,-10),day(list.at(-1)!.assessedAt),c!);fetched++;
   for(const e of list){const lc=closeFromBars(b.payload,symbol,e.assessedAt,b.rawId);closes[e.caseId]=lc?{close:lc.close,sessionDate:lc.sessionDate,rawEventId:lc.rawEventId}:null;}}catch{failed++;}
 }
 const spy=cases.length?await spyCalendar(cases[0].assessedAt,now):null;
 const counted=backfillCount(cases,closes,spy?.sessions??null);
 return {...counted,asOf:now,owner:'you',symbolsNeeded:bySymbol.size,symbolsChecked:fetched,symbolsFailed:failed,calendar:spy?{from:spy.sessions[0]??null,to:spy.sessions.at(-1)??null}:null,
  columns:{assessed:'All stored discovery cases',researchRules:'Rule 1: research screen v2 says "Meets research rules"',goodNews:'+ rule 2: good news',ordinaryShare:'+ rule 3: ordinary share (identity v2)',namedInHeadline:'+ rule 4: named in the headline',
   noPrice:'Rule 5 failed: no IEX close at assessment',belowMinPrice:'Rule 5 failed: close below $5',priceNotChecked:'Price or calendar not checked in this request (not counted as passing)',companyBlocked:'Rule 6 failed: open or recent signal for the company',wouldSignal:'Would have been a signal'},
  limits:['Retrospective, not a track record: these cases were not traded or priced by v2.','Closes come from IEX bars fetched today with split and dividend adjustment; around a later split a close can fall on the other side of $5.','Cases from before security-identity-v2 or research-screen-v2 fail those rules by design, so early months count few.','Month = UTC month of assessment.']};
}
