// Server side of the decision workflow (2026-11-16): implied expectations, the three-way comparison, decision
// snapshots and their reviews. On demand only; never part of the hourly run; never reads or writes the screen, the
// evidence score, rankings, alerts, Practice trades or either automated experiment. Writes: the shared price archive
// (as the company page does) and two append-only record kinds, `decision_snapshot` and `decision_review`.
import {env} from 'cloudflare:workers';
import {database,hash,iso} from '@/db/store';
import {companyFile,ingest,parserSource,FACTS_PARSER_VERSION} from './edgar';
import {archivedDailyBars} from './daily-bars';
import {closesOf} from './market-model';
import {closeFromBars} from './last-close';
import {closeInstant} from './case-context';
import {latestShareCount,TAG_LIST_V4,type FinancialFact,type Figure} from './financial';
import {practiceState,type PracticeTrade} from './practice';
import {AUTO_POLICY} from './auto-practice';
import {impliedExpectations,splitCheck,otherListings,type PriceInput,type SecState,type SplitCheck} from './implied-expectations';
import {compareDecision,betaFromCloses,type Beta} from './decision-compare';
import {SNAPSHOT_VERSION,checkpointFor,reviewSnapshot,performance,evaluateCheckpoint,compareShownToSaved,type CheckpointId} from './decision-snapshot';

const SYMBOL=/^[A-Z][A-Z0-9.\-]{0,9}$/,DAY=86400000;
export const DEFAULT_BUDGET_CENTS=AUTO_POLICY.positionCents; // the standard position the idea card uses
/** Price requests per comparison (the candidate plus holdings, plus SPY). Holdings beyond it are shown as not priced, never valued. */
export const MAX_PRICED_SYMBOLS=20;
export const NO_PRICE=(symbol:string)=>`Not saved: no price is available for ${symbol}. A snapshot needs a recorded IEX daily close; nothing was stored.`;
export const OVER_LIMIT=`not priced: over the limit of ${MAX_PRICED_SYMBOLS} companies per comparison`;
const creds=()=>{const c=env as unknown as {ALPACA_DATA_KEY_ID?:string;ALPACA_DATA_SECRET?:string};return c.ALPACA_DATA_KEY_ID&&c.ALPACA_DATA_SECRET?c as {ALPACA_DATA_KEY_ID:string;ALPACA_DATA_SECRET:string}:null;};
const ymd=(t:number)=>new Date(t).toISOString().slice(0,10);

type Bars={closes:Map<string,number>;rawId:string;fetchedAt:string;last:ReturnType<typeof closeFromBars>};
/** Archived IEX daily bars (adjusted). Null with a reason when they cannot be read; never a guess. */
async function dailyBars(symbol:string,now:string,wantDays=400):Promise<Bars|{error:string}>{
 const startDays=Math.max(400,wantDays); // the company page's window, so the 6-hour archive is shared
 const c=creds();if(!c)return {error:'Market data is not connected.'};if(!SYMBOL.test(symbol))return {error:'No usable ticker.'};
 try{const b=await archivedDailyBars(symbol,ymd(Date.parse(now)-startDays*DAY),now.slice(0,10),c);return {closes:closesOf(b.payload,b.fetchedAt<now?b.fetchedAt:now),rawId:b.rawId,fetchedAt:b.fetchedAt,last:closeFromBars(b.payload,symbol,now,b.rawId)};}
 catch(e){return {error:e instanceof Error?e.message:'Daily prices could not be loaded.'};}
}
const record=(m:Map<string,number>)=>Object.fromEntries(m);

/** The SEC company behind a ticker, as the company page resolves it: from the owner's cases, else from the owner's saved companies. */
export async function companyFor(owner:string,symbol:string){
 const db=database();
 const row=await db.prepare("SELECT json_extract(body,'$.identity.cik') cik FROM signal_log WHERE owner=? AND kind='discovery_case' AND json_extract(body,'$.symbol')=? AND json_extract(body,'$.identity.cik') IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 1").bind(owner,symbol).first<{cik:string}>();
 if(row?.cik&&/^\d{10}$/.test(String(row.cik)))return db.prepare('SELECT id,cik,name,sic,tickers FROM entity WHERE id=?').bind('sec:'+row.cik).first<{id:string;cik:string;name:string;sic:string|null;tickers:string|null}>();
 return db.prepare("SELECT e.id,e.cik,e.name,e.sic,e.tickers FROM entity e JOIN entity_watch w ON w.entity_id=e.id WHERE w.owner=? AND EXISTS(SELECT 1 FROM json_each(e.tickers) WHERE upper(value)=?) LIMIT 1").bind(owner,symbol).first<{id:string;cik:string;name:string;sic:string|null;tickers:string|null}>();
}
/**
 * The company's SEC figures for the decision workflow, read with tag list xbrl-tags-v2. Three outcomes, never merged:
 * `not_loaded` (no successful SEC read stored), `failed` (the read threw; the message is kept, never swallowed as null)
 * and `loaded` (with whether the last read used the current fact parser).
 */
export type SecRead={state:'loaded';annual:Figure[];quarterly:Figure[];shareFact:FinancialFact|null;claimFacts:FinancialFact[];lastGoodAt:string|null;parserCurrent:boolean;tagList:string}|{state:'not_loaded'}|{state:'failed';error:string};
export async function secFor(owner:string,entityId:string,asOf:string):Promise<SecRead>{
 const db=database();
 try{
  const ok=await db.prepare("SELECT 1 x FROM sec_run WHERE entity_id=? AND status='success' LIMIT 1").bind(entityId).first();
  if(!ok)return {state:'not_loaded'};
  const file=await companyFile(entityId,asOf,'public',owner,TAG_LIST_V4);
  const shares=(await db.prepare("SELECT f.* FROM financial_fact f WHERE entity_id=? AND metric IN ('shares_outstanding','shares_outstanding_multiclass') AND known_from<=? AND EXISTS(SELECT 1 FROM sec_run s WHERE s.entity_id=f.entity_id AND s.status='success' AND s.raw_event_id=f.raw_event_id)").bind(entityId,asOf).all<FinancialFact>()).results;
  const claimFacts=(await db.prepare("SELECT f.* FROM financial_fact f WHERE entity_id=? AND metric IN ('nci','nci_redeemable','preferred','claim_unreadable') AND known_from<=? AND EXISTS(SELECT 1 FROM sec_run s WHERE s.entity_id=f.entity_id AND s.status='success' AND s.raw_event_id=f.raw_event_id)").bind(entityId,asOf).all<FinancialFact>()).results;
  const marker=await db.prepare('SELECT last_good_at FROM source_state WHERE source=?').bind(parserSource(entityId)).first<{last_good_at:string|null}>();
  return {state:'loaded',annual:file.figures as Figure[],quarterly:file.quarterlyFigures as Figure[],shareFact:latestShareCount(shares,asOf),claimFacts,lastGoodAt:file.lastGoodAt?String(file.lastGoodAt):null,parserCurrent:!!marker?.last_good_at,tagList:TAG_LIST_V4};
 }catch(e){return {state:'failed',error:(e instanceof Error?e.message:'The SEC records could not be read.').slice(0,200)};}
}
const secState=(r:SecRead):SecState=>r.state==='loaded'?{state:'loaded',parserCurrent:r.parserCurrent,tagList:r.tagList}:r;
const loaded=(r:SecRead|null)=>r&&r.state==='loaded'?r:null;

/**
 * Re-read SEC data with the current fact parser (cover-page share counts, xbrl-tags-v2) through the normal ingest path,
 * for the owner's saved companies (and the requested company first, if given) whose last read predates the parser.
 * At most `limit` companies per request; ingest appends facts only (INSERT OR IGNORE), so existing facts are untouched.
 */
export async function backfillShareCounts(owner:string,email:string,opts:{symbol?:string;limit?:number}={}){
 const db=database(),limit=Math.min(Math.max(opts.limit??3,1),5),first=opts.symbol?await companyFor(owner,opts.symbol):null;
 const watched=(await db.prepare('SELECT e.id,e.cik,e.name FROM entity_watch w JOIN entity e ON e.id=w.entity_id WHERE w.owner=? ORDER BY w.known_from,e.id').bind(owner).all<{id:string;cik:string;name:string}>()).results;
 const list=[...(first?[first]:[]),...watched.filter(w=>w.id!==first?.id)];
 const due:typeof list=[];for(const e of list){if(!(await db.prepare('SELECT last_good_at FROM source_state WHERE source=?').bind(parserSource(e.id)).first<{last_good_at:string|null}>())?.last_good_at)due.push(e);}
 const results:any[]=[];
 for(const e of due.slice(0,limit)){
  try{const r=await ingest(e.cik,email);const n=(await db.prepare("SELECT COUNT(*) n FROM financial_fact WHERE entity_id=? AND metric IN ('shares_outstanding','shares_outstanding_multiclass')").bind(e.id).first<{n:number}>())?.n??0;
   results.push({company:e.name,cik:e.cik,status:'loaded',shareCountFacts:n,observations:r.observations});}
  catch(err){results.push({company:e.name,cik:e.cik,status:'failed',message:'SEC read failed: '+(err instanceof Error?err.message:'unknown error')});}
 }
 return {parser:FACTS_PARSER_VERSION,checked:list.length,due:due.length,processed:results.length,remaining:Math.max(0,due.length-results.length),results,
  note:`Up to ${limit} companies per request through the normal SEC ingest. Facts are appended; nothing stored is changed.`};
}

/**
 * Split check for one ticker: unadjusted and split-only IEX daily closes from 10 days before the cover-page date to the
 * price date (two archived requests, reused for 6 hours). Any read failure is `not_run`, which holds the result back.
 */
async function splitFor(symbol:string,coverDate:string,b:Bars|{error:string},now:string):Promise<SplitCheck>{
 const c=creds();if(!c)return {state:'not_run',reason:'market data is not connected'};
 if('error' in b||!b.last)return {state:'not_run',reason:'no recent IEX close'};
 const start=ymd(Date.parse(coverDate+'T00:00:00Z')-10*DAY),end=now.slice(0,10),asMap=(p:any)=>{const m:Record<string,number>={};for(const x of closesOf(p,now))m[x[0]]=x[1];return m;};
 try{const [raw,split]=await Promise.all([archivedDailyBars(symbol,start,end,c,'raw'),archivedDailyBars(symbol,start,end,c,'split')]);
  return splitCheck(asMap(raw.payload),asMap(split.payload),coverDate,b.last.sessionDate,`Alpaca IEX daily closes, unadjusted and split-adjusted (raw ${raw.rawId}, split ${split.rawId})`);}
 catch(e){return {state:'not_run',reason:'unadjusted IEX prices could not be read ('+(e instanceof Error?e.message:'error')+')'};}
}

/** What the price assumes, for one ticker, as of now. Read-only apart from the price archive. */
export async function impliedFor(owner:string,symbol:string,now=iso()){
 const entity=await companyFor(owner,symbol);if(!entity)return null;
 const sec=await secFor(owner,entity.id,now),b=await dailyBars(symbol,now,400);
 const price:PriceInput='error' in b||!b.last?null:{value:b.last.close,at:b.last.closeAt,basis:'last_close',source:'IEX daily close '+b.last.sessionDate+' (one US exchange)',rawEventId:b.last.rawEventId};
 const ok=loaded(sec),split=ok?.shareFact&&price?await splitFor(symbol,ok.shareFact.period_end,b,now):undefined;
 let tickers:string[]=[];try{const t=JSON.parse(entity.tickers??'[]');if(Array.isArray(t))tickers=t.map(String);}catch{}
 const r=impliedExpectations({symbol,asOf:now,sic:entity.sic??null,figures:ok?.annual??[],shareFact:ok?.shareFact??null,price,sec:secState(sec),split,otherTickers:otherListings(symbol,tickers),claimFacts:ok?.claimFacts??[]});
 return {...r,company:{name:entity.name,cik:entity.cik,sic:entity.sic??null},sources:{secLastGoodAt:ok?.lastGoodAt??null,secRead:sec.state,secError:sec.state==='failed'?sec.error:null,tagList:ok?.tagList??null,priceError:'error' in b?b.error:b.last?null:'No completed IEX daily close in the last 5 days.',priceSessionDate:'error' in b?null:b.last?.sessionDate??null}};
}

async function practiceOpen(owner:string,now:string){
 const rows=await database().prepare("SELECT body FROM signal_log WHERE owner=? AND kind='practice_trade' ORDER BY created_at,id").bind(owner).all<{body:string}>();
 const st=practiceState({trades:rows.results.map(r=>JSON.parse(r.body) as PracticeTrade),reviews:[],marks:[],live:{},now});
 return {cashCents:st.cashCents,sequence:st.sequence,open:st.open.map(p=>({symbol:p.symbol,quantityMicros:p.quantityMicros,amountCents:p.amountCents}))};
}

/** Keep / add the stock / add SPY from the same Practice state. Holdings are valued at the last completed IEX close. Read-only. */
export async function compareFor(owner:string,symbol:string,budgetCents:number,now=iso()){
 const p=await practiceOpen(owner,now),all=[...new Set([symbol,...p.open.map(o=>o.symbol)])],symbols=all.slice(0,MAX_PRICED_SYMBOLS),over=new Set(all.slice(MAX_PRICED_SYMBOLS));
 const got=await Promise.all([...symbols,'SPY'].map(s=>dailyBars(s,now,400))),bars=new Map([...symbols,'SPY'].map((s,i)=>[s,got[i]]));
 const spy=bars.get('SPY')!,betas:Record<string,Beta|null>={},problems:string[]=[],marks:Record<string,{close:number;sessionDate:string;rawEventId:string}|null>={};
 if('error' in spy)problems.push('SPY: '+spy.error);
 for(const s of symbols){const b=bars.get(s)!;if('error' in b){problems.push(s+': '+b.error);betas[s]=null;marks[s]=null;continue;}
  betas[s]='error' in spy?null:betaFromCloses(b.closes,spy.closes);marks[s]=b.last?{close:b.last.close,sessionDate:b.last.sessionDate,rawEventId:b.last.rawEventId}:null;}
 const holdings=p.open.map(o=>over.has(o.symbol)?{symbol:o.symbol,valueCents:null,reason:OVER_LIMIT}:marks[o.symbol]?{symbol:o.symbol,valueCents:Math.round(o.quantityMicros*marks[o.symbol]!.close*100/1_000_000)}:{symbol:o.symbol,valueCents:null,reason:'not priced: no completed IEX close in the last 5 days'});
 const mandateRow=await database().prepare("SELECT body FROM signal_log WHERE owner=? AND kind='practice_mandate' ORDER BY created_at DESC,id DESC LIMIT 1").bind(owner).first<{body:string}>();
 let mandate=null;try{const m=mandateRow?JSON.parse(mandateRow.body):null;if(m&&Number.isFinite(m.reservePct)&&Number.isFinite(m.maxPositionPct))mandate={reservePct:m.reservePct,maxPositionPct:m.maxPositionPct};}catch{}
 const r=compareDecision({symbol,budgetCents,cashCents:p.cashCents,holdings,betas,mandate});
 const spyLast='error' in spy?null:spy.last;
 return {...r,preparedAt:now,practice:{sequence:p.sequence,cashCents:p.cashCents,open:p.open},marks,spyReference:spyLast?{close:spyLast.close,sessionDate:spyLast.sessionDate,rawEventId:spyLast.rawEventId}:null,
  valuation:'Holdings are valued at the last completed IEX daily close (one US exchange), not a live quote.',problems};
}

// ---- snapshots ---------------------------------------------------------------------------------
type Row={id:string;created_at:string;body:string};
const snapshotRow=(owner:string,id:string)=>database().prepare("SELECT id,created_at,body FROM signal_log WHERE id=? AND owner=? AND kind='decision_snapshot'").bind(id,owner).first<Row>();

/**
 * Save what is known and computed when Save is pressed. Everything is recalculated on the server; numbers sent by the
 * browser are never stored. `shown` (the comparison the browser displayed) is only compared with the saved values so the
 * response can say whether anything changed in between. Idempotent on (owner, case, request id): a retry returns the
 * stored record.
 */
export async function saveSnapshot(owner:string,input:{caseId:string;requestId:string;budgetCents:number;checkpoint:CheckpointId;shown?:unknown}){
 const db=database(),kase=await db.prepare("SELECT id,created_at,entity,body FROM signal_log WHERE id=? AND owner=? AND kind='discovery_case'").bind(input.caseId,owner).first<Row&{entity:string|null}>();
 if(!kase)return null;
 const id='decision-snapshot:'+await hash(JSON.stringify([owner,input.caseId,input.requestId]));
 const saved=(raw:string,appended:boolean)=>{const snapshot=JSON.parse(raw);return {id,raw,snapshot,appended,calculatedAt:snapshot.alternatives?.preparedAt??snapshot.savedAt,check:compareShownToSaved(input.shown,snapshot.alternatives)};};
 const prior=await snapshotRow(owner,id);if(prior)return saved(prior.body,false);
 const cb=JSON.parse(kase.body),symbol=String(cb.symbol??''),now=iso();
 if(!SYMBOL.test(symbol))return {error:'The case has no usable ticker.'} as const;
 const implied=await impliedFor(owner,symbol,now),compare=await compareFor(owner,symbol,input.budgetCents,now);
 const entity=await companyFor(owner,symbol),sec=entity?loaded(await secFor(owner,entity.id,now)):null;
 const ic=await db.prepare("SELECT id FROM signal_log WHERE owner=? AND kind='investment_case' AND json_extract(body,'$.caseId')=? ORDER BY created_at DESC,id DESC LIMIT 1").bind(owner,input.caseId).first<{id:string}>();
 const mark=compare.marks[symbol];
 if(!mark)return {error:NO_PRICE(symbol)} as const;
 const body={version:SNAPSHOT_VERSION,id,caseId:input.caseId,symbol,savedAt:now,budgetCents:input.budgetCents,
  price:mark?{value:mark.close,sessionDate:mark.sessionDate,basis:'last_close',source:'IEX daily close (one US exchange)',rawEventId:mark.rawEventId}:{value:null,sessionDate:null,basis:'unavailable',source:null,rawEventId:null},
  spy:compare.spyReference,
  evidence:{caseRecord:input.caseId,caseAssessedAt:cb.createdAt??kase.created_at,conclusion:cb.conclusion??null,screenVersion:cb.decision?.version??null,evidenceScore:cb.evidenceScore?.score??null,investmentCaseRecord:ic?.id??null},
  questions:{businessQuality:'See the investment case and the evidence score (unchanged by this snapshot).',marketExpectations:'impliedExpectations',investmentOpportunity:implied?.opportunity??{status:'not_established',text:'Not established.'},portfolioSuitability:'alternatives'},
  impliedExpectations:implied??{status:'unavailable',missing:['No SEC company is stored for this ticker.']},
  practiceBefore:compare.practice,alternatives:compare,
  checkpoint:checkpointFor(input.checkpoint,now,sec?.annual??[],sec?.quarterly??[]),
  note:'Stored once, never changed. Virtual; nothing was traded. Not advice.'};
 const raw=JSON.stringify(body);
 await db.prepare("INSERT OR IGNORE INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'decision_snapshot',?,?)").bind(id,owner,now,kase.entity,raw).run();
 const stored=await snapshotRow(owner,id);
 return saved(stored!.body,stored!.body===raw);
}

async function computeReview(owner:string,s:any,now:string){
 const entity=await companyFor(owner,s.symbol),read=entity?await secFor(owner,entity.id,now):null,sec=loaded(read);
 const days=Math.ceil((Date.parse(now)-Date.parse(s.savedAt))/DAY)+15;
 const [st,sp]=await Promise.all([dailyBars(s.symbol,now,days),dailyBars('SPY',now,days)]);
 return reviewSnapshot({snapshot:s,now,secError:read&&read.state!=='loaded'?(read.state==='failed'?'SEC read failed: '+read.error:'SEC data not loaded yet.'):null,annual:sec?.annual??null,quarterly:sec?.quarterly??null,stock:'error' in st?null:record(st.closes),spy:'error' in sp?null:record(sp.closes)});
}
const reviewsOf=async(owner:string,id:string)=>(await database().prepare("SELECT id,created_at,body FROM signal_log WHERE owner=? AND kind='decision_review' AND json_extract(body,'$.snapshotId')=? ORDER BY created_at,id").bind(owner,id).all<Row>()).results.map(r=>({id:r.id,recordedAt:r.created_at,...JSON.parse(r.body)}));

/** The stored snapshot exactly as saved (`raw` is the stored text), plus a review computed now and the reviews already recorded. */
export async function openSnapshot(owner:string,id:string){
 const row=await snapshotRow(owner,id);if(!row)return null;
 const s=JSON.parse(row.body),now=iso();
 return {id,recordedAt:row.created_at,raw:row.body,snapshot:s,review:await computeReview(owner,s,now),recordedReviews:await reviewsOf(owner,id)};
}
/** Append today's review as its own record (one per UTC day). The snapshot is never touched. */
export async function recordReview(owner:string,id:string){
 const row=await snapshotRow(owner,id);if(!row)return null;
 const now=iso(),review=await computeReview(owner,JSON.parse(row.body),now);
 const rid='decision-review:'+await hash(JSON.stringify([owner,id,now.slice(0,10)]));
 const saved=await database().prepare("INSERT OR IGNORE INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'decision_review',NULL,?)").bind(rid,owner,now,JSON.stringify(review)).run();
 return {reviewId:rid,appended:!!saved.meta.changes,review,recordedReviews:await reviewsOf(owner,id)};
}
export async function listSnapshots(owner:string,symbol:string){
 const rows=await database().prepare("SELECT id,created_at,json_extract(body,'$.caseId') caseId,json_extract(body,'$.budgetCents') budgetCents,json_extract(body,'$.checkpoint.condition') condition,json_extract(body,'$.checkpoint.dueBy') dueBy,json_extract(body,'$.price.value') price FROM signal_log WHERE owner=? AND kind='decision_snapshot' AND json_extract(body,'$.symbol')=? ORDER BY created_at DESC,id DESC LIMIT 20").bind(owner,symbol).all<any>();
 return rows.results.map(r=>({id:r.id,savedAt:r.created_at,caseId:r.caseId,budgetCents:r.budgetCents,condition:r.condition,dueBy:r.dueBy,price:r.price}));
}

/**
 * Historical replay over stored cases: as if a decision had been taken at each case's assessment time, with the
 * standard budget. Entry = the last IEX close completed by then; exit = the latest completed close. The thesis
 * checkpoint is measured only from filings known by the assessment time. Reports what it could and could not compute.
 */
export async function replayDecisions(owner:string,maxSymbols=10,budgetMs=20000){
 const t0=Date.now(),now=iso(),db=database();
 const rows=(await db.prepare("SELECT id,created_at,json_extract(body,'$.symbol') symbol,json_extract(body,'$.identity.cik') cik FROM signal_log WHERE owner=? AND kind='discovery_case' AND json_extract(body,'$.status')='complete' ORDER BY created_at ASC,id ASC LIMIT 2000").bind(owner).all<any>()).results;
 const bySymbol=new Map<string,any[]>();for(const r of rows){const s=String(r.symbol??'');if(SYMBOL.test(s))bySymbol.set(s,[...(bySymbol.get(s)??[]),r]);}
 const first=rows[0]?.created_at??now,days=Math.ceil((Date.parse(now)-Date.parse(first))/DAY)+15;
 const spy=bySymbol.size?await dailyBars('SPY',now,days):{error:'No cases.'};
 const out:any[]=[];let symbolsDone=0;
 for(const [symbol,list] of bySymbol){
  if(symbolsDone>=maxSymbols||Date.now()-t0>budgetMs)break;symbolsDone++;
  const b=await dailyBars(symbol,now,days),cik=list.find(r=>/^\d{10}$/.test(String(r.cik??'')))?.cik??null,read=cik?await secFor(owner,'sec:'+cik,now):null,sec=loaded(read);
  for(const k of list){
   const entry='error' in b?null:[...b.closes.keys()].filter(d=>closeInstant(d)<=k.created_at).sort().at(-1)??null;
   const perf=performance(entry,DEFAULT_BUDGET_CENTS,'error' in b?null:record(b.closes),'error' in spy?null:record(spy.closes));
   const thesis=sec?evaluateCheckpoint(checkpointFor('quarterly_revenue_yoy',k.created_at,sec.annual,sec.quarterly),k.created_at,now,sec.annual,sec.quarterly):{status:'unavailable' as const,text:read?.state==='failed'?'Unavailable: SEC read failed: '+read.error:'Unavailable: SEC data not loaded yet for this company.'};
   out.push({caseId:k.id,symbol,decisionAt:k.created_at,business:thesis,investment:perf.investment,alternatives:perf.alternatives});
  }
 }
 const count=(f:(r:any)=>string)=>out.reduce((m:Record<string,number>,r)=>{const key=f(r);m[key]=(m[key]??0)+1;return m;},{});
 return {version:'decision-replay-v1',asOf:now,budgetCents:DEFAULT_BUDGET_CENTS,cases:rows.length,symbols:bySymbol.size,symbolsReplayed:symbolsDone,replayed:out.length,
  business:count(r=>r.business.status),investment:count(r=>r.investment.status),rows:out.slice(-200),
  note:'Replay, not a track record: nothing was decided or traded at the time. Entry is the last close completed by the assessment; costs are 15 bp per side; checkpoint template: quarterly revenue against the same quarter a year earlier. Remaining symbols are not replayed in this request.'};
}
