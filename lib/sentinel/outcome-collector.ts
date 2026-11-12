import {env} from 'cloudflare:workers';
import {database,hash,iso} from '@/db/store';
import {compareForwardBars,OUTCOME_HORIZONS,horizonWaitDays} from './outcome-observation';
type Pair={caseId:string;caseAt:string;symbol:string;cik:string|null;horizon:number};
type Bars={symbol:string;text:string;payload:any;rawId:string;digest:string};
const MAX_CASES_SCANNED=400;

/**
 * Due (case, horizon) pairs, oldest case first, then shortest horizon.
 * Three light reads instead of one correlated query per pair: case ids with only the fields needed (not whole
 * bodies), the recorded outcome keys, and attempts still cooling down. Matching happens in memory.
 * Records written before horizons existed carry horizonIntervals 5; attempts without a horizon count as 5.
 */
export async function dueOutcomePairs(owner:string,limit:number,nowMs=Date.now()):Promise<Pair[]>{
 const db=database(),firstCutoff=new Date(nowMs-horizonWaitDays(OUTCOME_HORIZONS[0])*86400000).toISOString(),cooldown=new Date(nowMs-6*3600000).toISOString();
 const [cases,done,attempts]=await db.batch([
  db.prepare("SELECT id,created_at,json_extract(body,'$.symbol') AS symbol,json_extract(body,'$.identity.cik') AS cik FROM signal_log WHERE owner=? AND kind='discovery_case' AND created_at<=? AND json_extract(body,'$.status')='complete' ORDER BY created_at ASC,id ASC LIMIT ?").bind(owner,firstCutoff,MAX_CASES_SCANNED),
  db.prepare("SELECT json_extract(body,'$.caseId') AS c,COALESCE(json_extract(body,'$.horizonIntervals'),5) AS h FROM signal_log WHERE owner=? AND kind='discovery_outcome'").bind(owner),
  db.prepare("SELECT json_extract(body,'$.caseId') AS c,COALESCE(json_extract(body,'$.horizonIntervals'),5) AS h FROM signal_log WHERE owner=? AND kind='outcome_attempt' AND created_at>?").bind(owner,cooldown),
 ]);
 const key=(c:unknown,h:unknown)=>String(c)+'|'+Number(h);
 const skip=new Set([...(done.results as any[]),...(attempts.results as any[])].map(r=>key(r.c,r.h)));
 const pairs:Pair[]=[];
 for(const c of cases.results as any[])for(const h of OUTCOME_HORIZONS){
  if(pairs.length>=limit)return pairs;
  if(Date.parse(c.created_at)>nowMs-horizonWaitDays(h)*86400000||skip.has(key(c.id,h)))continue;
  pairs.push({caseId:c.id,caseAt:c.created_at,symbol:String(c.symbol??''),cik:c.cik??null,horizon:h});
 }
 return pairs;
}

/** One bar request per symbol per run, from the earliest needed date; SPY is fetched once and shared. */
async function fetchBars(ticker:string,start:string,now:string,credentials:{ALPACA_DATA_KEY_ID:string;ALPACA_DATA_SECRET:string}):Promise<Bars>{
 const params=new URLSearchParams({timeframe:'1Day',start:start.slice(0,10),end:now.slice(0,10),limit:'1000',adjustment:'all',feed:'iex',sort:'asc'});
 const response=await fetch('https://data.alpaca.markets/v2/stocks/'+encodeURIComponent(ticker)+'/bars?'+params,{headers:{'APCA-API-KEY-ID':credentials.ALPACA_DATA_KEY_ID,'APCA-API-SECRET-KEY':credentials.ALPACA_DATA_SECRET,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('Historical bar source unavailable (HTTP '+response.status+').');
 const text=await response.text();if(text.length>300000)throw new Error('Historical response too large.');const payload=JSON.parse(text);if(payload.next_page_token)throw new Error('Historical observations exceeded one page; no result recorded.');
 const digest=await hash(text);return {symbol:ticker,text,payload,digest,rawId:'outcome-raw:'+await hash(ticker+':'+digest)};
}

async function observePair(owner:string,pair:Pair,cache:Map<string,Promise<Bars>>,spyStart:string,now:string){
 const db=database(),{caseId,symbol,horizon}=pair;
 try{
  if(!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol))throw new Error('Unusable symbol.');
  const credentials=env as unknown as {ALPACA_DATA_KEY_ID?:string;ALPACA_DATA_SECRET?:string};if(!credentials.ALPACA_DATA_KEY_ID||!credentials.ALPACA_DATA_SECRET)throw new Error('Historical data is not connected.');
  const creds=credentials as {ALPACA_DATA_KEY_ID:string;ALPACA_DATA_SECRET:string};
  const get=(t:string,start:string)=>{if(!cache.has(t)){const p=fetchBars(t,start,now,creds);p.catch(()=>{});cache.set(t,p);}return cache.get(t)!;};
  const results=[await get(symbol,pair.caseAt),await get('SPY',spyStart)];
  const comparison=compareForwardBars(results[0].payload,results[1].payload,pair.caseAt,now,horizon);if(!comparison)throw new Error(`Fewer than ${horizon+1} matching completed IEX daily bars are available.`);
  // Raw bars are archived (dedup by content hash), so each payload is written once however many horizons use it.
  const statements:D1PreparedStatement[]=results.map(r=>db.prepare('INSERT OR IGNORE INTO raw_event(id,source,fetched_at,published_at,known_from,content_hash,payload,http_status) VALUES(?,?,?,NULL,?,?,?,200)').bind(r.rawId,'alpaca:iex:adjusted-bars:'+r.symbol,now,now,r.digest,r.text));
  const outcome={version:'forward-observation-v1',horizonLabel:`${horizon} trading-day intervals`,caseId,symbol,caseAt:pair.caseAt,observedAt:now,benchmark:'SPY',feed:'IEX',adjustment:'all',...comparison,rawIds:results.map(r=>r.rawId),limitations:'Gross adjusted daily close observations, not executable fills or a paper trade. Fees, spreads, slippage and taxes are excluded. IEX is a single exchange, and corporate-action adjustments depend on the provider. This observation includes WAIT cases and does not establish recommendation performance.'};
  const id='outcome:'+await hash(JSON.stringify([owner,caseId,horizon===5?'five-matched-daily-intervals-v1':`matched-daily-intervals-${horizon}-v1`]));statements.push(db.prepare("INSERT OR IGNORE INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'discovery_outcome',?,?)").bind(id,owner,now,pair.cik?'sec:'+pair.cik:null,JSON.stringify(outcome)));
  const saved=await db.batch(statements);return {status:'observed',created:!!saved.at(-1)?.meta.changes,outcome};
 }catch(e){const message=e instanceof Error?e.message:'Historical observation unavailable.';await db.prepare("INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'outcome_attempt',NULL,?)").bind(crypto.randomUUID(),owner,iso(),JSON.stringify({caseId,horizonIntervals:horizon,message})).run();return {status:'pending',caseId,horizonIntervals:horizon,message:'Observation unavailable; retry after six hours.',detail:message};}
}

/** Observational follow-up for the single oldest due pair (kept for callers and tests). */
export async function observeOneOutcome(owner:string){
 const [pair]=await dueOutcomePairs(owner,1);if(!pair)return {status:'idle',message:'No eligible cases awaiting observation.'};
 return observePair(owner,pair,new Map(),pair.caseAt,iso());
}

/** Observe several due (case, horizon) pairs in one run, within a count and time budget. */
export async function observeOutcomes(owner:string,limit=8,budgetMs=20000){
 const started=Date.now(),now=iso(),items:any[]=[],pairs=await dueOutcomePairs(owner,limit);
 const cache=new Map<string,Promise<Bars>>(),spyStart=pairs.reduce((m,p)=>p.caseAt<m?p.caseAt:m,pairs[0]?.caseAt??now);
 for(const pair of pairs){if(Date.now()-started>=budgetMs)break;items.push(await observePair(owner,pair,cache,spyStart,now));}
 const counts:Record<string,number>={};for(const r of items)counts[r.status]=(counts[r.status]??0)+1;
 return {status:items.length?'complete':'idle',attempted:items.length,counts,limit,timeBudgetMs:budgetMs,requests:{bars:cache.size,dbReads:1},items:items.map((r:any)=>r.status==='observed'?{status:r.status,caseId:r.outcome.caseId,symbol:r.outcome.symbol,horizonIntervals:r.outcome.horizonIntervals,created:r.created}:r)};
}
