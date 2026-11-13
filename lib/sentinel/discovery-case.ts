import {database,hash,iso} from '@/db/store';
import {resolveIdentifier,ingest,companyFile} from './edgar';
import {classifySecurity,collectSecurityAsset} from './security-asset';
import {priceAssessment,researchDecisionV2} from './price-assessment';
import {cashflowScenarios} from './cashflow-scenarios';
import {investmentBrief} from './investment-brief';
import {assessCompanyRelevance} from './news-assessment';
import {collectStockQuote} from '@/app/api/stock-quote/route';
import {shadowReadCases} from './shadow-store';
import {evidenceScore,quarterlyRevenueYoY} from './evidence-score';
import {eventMatch} from './event-match';
import {closeFromBars} from './last-close';
import {archivedDailyBars} from './daily-bars';
import {env} from 'cloudflare:workers';
/** Last completed daily close, fetched only when no eligible live quote exists. Any failure means no fallback (never a guess). */
async function lastCloseFor(symbol:string,at:string){
 try{const c=env as unknown as {ALPACA_DATA_KEY_ID?:string;ALPACA_DATA_SECRET?:string};if(!c.ALPACA_DATA_KEY_ID||!c.ALPACA_DATA_SECRET)return null;const day=86400000,bars=await archivedDailyBars(symbol,new Date(Date.parse(at)-10*day).toISOString().slice(0,10),at.slice(0,10),c as any);return closeFromBars(bars.payload,symbol,at,bars.rawId);}catch{return null}
}
export const QUEUE_WINDOW_HOURS=96;
export type QueueItem={id:string;createdAt:string;symbol:string;key:number;topics:string};
const MATERIAL=['Earnings or financial results','Regulation or legal matter','Acquisition or transaction'];
const queueClass=(q:QueueItem)=>{let t:unknown;try{t=JSON.parse(q.topics||'[]')}catch{t=[]}const topics=Array.isArray(t)?t:[];return topics.length===1&&topics[0]==='Analyst opinion'?2:MATERIAL.some(m=>topics.includes(m))?0:1;};
/** Same order the single SQL query used: event class, then newest first (or oldest first for the reserved slot), then id and tag position. */
export function orderQueue(items:QueueItem[],oldestFirst:boolean){
 return [...items].sort((a,b)=>(oldestFirst?0:queueClass(a)-queueClass(b))||(oldestFirst?a.createdAt.localeCompare(b.createdAt):b.createdAt.localeCompare(a.createdAt))||a.id.localeCompare(b.id)||a.key-b.key);
}
/**
 * The assessment queue: topic-matched (report, symbol) pairs from the last QUEUE_WINDOW_HOURS with no case yet.
 *
 * Until 2026-11-13 one SQL statement did this with two correlated NOT EXISTS subqueries, six times per run. Measured
 * on representative data (scripts/db-workload.mjs) each call read about (queued pairs) x (all cases + every row of
 * the last six hours): 805,000 rows per call after ONE day of data, growing with the square of the backlog. That was
 * the main database load. Now: three plain range reads over the window in one batch, matched in memory, once per run.
 * Reports older than the window are no longer assessed; for event-driven research they are stale.
 * `coolingDown` pairs failed in the last six hours and are retried later, as before.
 */
export async function discoveryQueue(owner:string,nowMs=Date.now()){
 const db=database(),since=new Date(nowMs-QUEUE_WINDOW_HOURS*3600000).toISOString(),cooldown=new Date(nowMs-6*3600000).toISOString();
 const [cands,cases,attempts]=await db.batch([
  db.prepare("SELECT s.id,s.created_at,j.value AS symbol,j.key AS k,json_extract(s.body,'$.analysis.topics') AS topics FROM signal_log s, json_each(s.body,'$.symbols') j WHERE s.owner=? AND s.created_at>? AND s.kind='discovery_candidate' AND json_extract(s.body,'$.priority')='topic match'").bind(owner,since),
  db.prepare("SELECT json_extract(body,'$.candidateId') AS c,json_extract(body,'$.symbol') AS s FROM signal_log WHERE owner=? AND created_at>? AND kind='discovery_case'").bind(owner,since),
  db.prepare("SELECT json_extract(body,'$.candidateId') AS c,json_extract(body,'$.symbol') AS s FROM signal_log WHERE owner=? AND created_at>? AND kind='discovery_attempt'").bind(owner,cooldown),
 ]);
 const key=(c:unknown,s:unknown)=>String(c)+'|'+String(s),done=new Set((cases.results as any[]).map(r=>key(r.c,r.s))),cooling=new Set((attempts.results as any[]).map(r=>key(r.c,r.s)));
 const pending:QueueItem[]=[];let coolingDown=0;
 for(const r of cands.results as any[]){const k=key(r.id,r.symbol);if(done.has(k))continue;if(cooling.has(k)){coolingDown++;continue;}pending.push({id:r.id,createdAt:r.created_at,symbol:String(r.symbol),key:Number(r.k)||0,topics:typeof r.topics==='string'?r.topics:'[]'});}
 return {pending,coolingDown,windowHours:QUEUE_WINDOW_HOURS};
}
/** Assess one queued (report, symbol) pair; prioritisation is research routing, not return prediction. `queue` lets a batch load the queue once. */
export async function assessDiscoveryQueue(owner:string,email:string,oldestFirst=false,queue?:QueueItem[]){
 const db=database(),list=queue??(await discoveryQueue(owner)).pending,pick=orderQueue(list,oldestFirst)[0];
 if(!pick)return {status:'idle',message:'No unassessed topic-matched symbols in the queue.'};
 if(queue)queue.splice(queue.indexOf(pick),1);
 const stored=await db.prepare("SELECT body FROM signal_log WHERE id=? AND owner=? AND kind='discovery_candidate'").bind(pick.id,owner).first<{body:string}>();
 if(!stored)return {status:'idle',message:'No unassessed topic-matched symbols in the queue.'};
 const row={id:pick.id,body:stored.body,symbol:pick.symbol};
 const event=JSON.parse(row.body),symbol=row.symbol,at=iso();let identity:any=null,brief:any=null,quote:any=null,security:any={status:'unverified',reason:'Security details unavailable.'},price:any={status:'unavailable',reason:'Price assessment unavailable.'},valuation:any={status:'unavailable',reason:'Company financial evidence is unavailable.'};const missing:string[]=[];let status='complete',quarterlyRevenue:any=null;
 try{
  const resolved=await resolveIdentifier(symbol,email);
  if(!resolved.cik){status='unresolved';missing.push(resolved.message||'The symbol could not be uniquely resolved to an SEC company.');}
  else{
   const ingestSource='sentinel:discovery-ingest:v1:'+resolved.cik;const prior=await db.prepare('SELECT last_good_at FROM source_state WHERE source=?').bind(ingestSource).first<{last_good_at:string|null}>();const latest=await db.prepare('SELECT status FROM sec_run WHERE entity_id=? ORDER BY known_from DESC LIMIT 1').bind('sec:'+resolved.cik).first<{status:string}>();if(!prior?.last_good_at||Date.now()-Date.parse(prior.last_good_at)>=86400000||latest?.status!=='success'){await ingest(resolved.cik,email);const refreshed=iso();await db.prepare('INSERT INTO source_state(source,failures,checked_at,last_good_at) VALUES(?,0,?,?) ON CONFLICT(source) DO UPDATE SET failures=0,checked_at=excluded.checked_at,last_good_at=excluded.last_good_at,error=NULL,retry_at=NULL').bind(ingestSource,refreshed,refreshed).run();}const file=await companyFile('sec:'+resolved.cik,iso(),'recorded',owner);
   const tickers=JSON.parse(file.entity.tickers);if(!Array.isArray(tickers)||!tickers.some((t:unknown)=>typeof t==='string'&&t.toUpperCase()===symbol)){status='unresolved';missing.push('SEC company record does not list this exact ticker; identity requires review.');}
   else{
    identity={name:file.entity.name,cik:resolved.cik,symbol,source:'SEC company ticker list and submissions',relevance:assessCompanyRelevance(event.headline,file.entity.name)};
    const [quoteResult,assetResult]=await Promise.allSettled([collectStockQuote(symbol),collectSecurityAsset(symbol)]);
    if(quoteResult.status==='fulfilled'){const q=quoteResult.value;const spreadPercent=(q.ask-q.bid)/((q.ask+q.bid)/2)*100;quote={...q,capturedAt:q.capturedAt||q.sourceTime,spreadPercent,wideSpread:spreadPercent>1,stale:Date.now()-Date.parse(q.sourceTime)>300000};}else missing.push('An eligible IEX quote was unavailable; price and valuation are unknown.');
    if(assetResult.status==='fulfilled'){const asset=assetResult.value;security={...classifySecurity(asset.data,symbol,tickers),rawEventId:asset.rawEventId,capturedAt:asset.capturedAt};}else missing.push('The security reference source was unavailable.');
    quarterlyRevenue=quarterlyRevenueYoY((file as any).quarterlyFigures,iso());valuation=cashflowScenarios(file.figures,iso());
    const liveUsable=!!quote&&!quote.stale&&!quote.wideSpread;const lastClose=!liveUsable&&security.status==='candidate_common'?await lastCloseFor(symbol,iso()):null;if(!liveUsable&&security.status==='candidate_common'&&!lastClose)missing.push('No recent completed daily close could be recorded either.');
    price=priceAssessment({figures:file.figures,quote,security,asOf:iso(),filingsStale:file.stale,lastClose});brief=investmentBrief({name:file.entity.name,cik:resolved.cik,figures:file.figures,asOf:iso(),stale:file.stale,lastGoodAt:file.lastGoodAt?String(file.lastGoodAt):null,filings:file.filings,quote});const evidenceCutoff=Date.parse(brief.asOf)-550*86400000;const old=brief.evidence.filter((e:any)=>e.periodEnd&&Date.parse(e.periodEnd+'T23:59:59.999Z')<evidenceCutoff);if(old.length){(brief as any).historicalEvidence=old;brief.evidence=brief.evidence.map((e:any)=>old.includes(e)?{...e,value:null,changePercent:null,confidence:'stale historical'}:e);brief.assessment=brief.assessment.filter((a:any)=>!old.some((e:any)=>e.label===a.label));brief.missing.push('Recent financial figures: older figures are retained only as historical evidence.');}
   }
  }
 }catch(e){const message=e instanceof Error?e.message:'Company assessment failed';await db.prepare("INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'discovery_attempt',NULL,?)").bind(crypto.randomUUID(),owner,iso(),JSON.stringify({candidateId:row.id,symbol,message})).run();return {status:'failed',candidateId:row.id,symbol,message:'Assessment failed; the candidate will be retried after a six-hour cooldown.',detail:message};}
 const createdAt=iso(),decision=researchDecisionV2({identity,price,brief,asOf:createdAt,topics:event.analysis?.topics}),result={version:'discovery-case-v2',candidateId:row.id,symbol,createdAt,status,conclusion:decision.conclusion,reason:decision.reason,decision,eventMatch:eventMatch({headline:event.headline,summary:event.providerSummary,companyName:identity?.name,symbol}),evidenceScore:evidenceScore({topics:event.analysis?.topics??null,relevance:identity?.relevance??null,price,brief,quarterlyRevenue,asOf:createdAt}),quarterlyRevenue,readiness:decision.readiness,rules:decision.rules,event:{headline:event.headline,url:event.url,source:event.source,publishedAt:event.publishedAt,firstObservedAt:event.firstObservedAt,rawEventId:event.rawEventId,analysis:event.analysis,providerSummary:event.providerSummary||null},identity,security,brief,valuation,price,missing:[...missing,'Verify the event and whether the company is directly affected.','Verify security class and share basis; compare price and valuation with market expectations.','Test the investment thesis and likely costs.'],limitations:'Ticker-to-company mapping is not proof that the news affects this company. A headline and IEX quote do not establish fair value or a buy signal.'};
 const id='discovery-case:'+await hash(JSON.stringify([owner,row.id,symbol]));const saved=await db.prepare("INSERT OR IGNORE INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'discovery_case',?,?)").bind(id,owner,createdAt,identity?'sec:'+identity.cik:null,JSON.stringify(result)).run();
 return {status,created:!!saved.meta.changes,caseId:id,case:saved.meta.changes?result:null};
}

/** Process a bounded batch, reserving one slot for old work to limit starvation. */
export async function assessDiscoveryBatch(owner:string,email:string){
 const started=Date.now(),items=[];
 const queue=await discoveryQueue(owner),list=queue.pending;
 for(let i=0;i<6;i++){if(i>0&&Date.now()-started>=35000)break;const result=await assessDiscoveryQueue(owner,email,i%3===2,list);if(result.status==='idle')break;items.push(result);}
 // Evaluation only: runs after every case in this batch has been created, so it cannot change what was assessed.
 let shadow:any;try{shadow=await shadowReadCases(owner,items)}catch{shadow={status:'failed',attempted:0}}
 return {status:items.some(x=>x.status==='failed')?'partial':items.length?'complete':'idle',items,shadow,remaining:list.length,coolingDown:queue.coolingDown,queueWindowHours:queue.windowHours,limit:6,timeBudgetMs:35000,notice:`Queue covers the last ${queue.windowHours} hours; older reports are not assessed. Triage uses headline topics and age, not estimated investment returns.`};
}
