import {env} from 'cloudflare:workers';
import {database,hash,iso} from '@/db/store';
import {compareForwardBars,OUTCOME_HORIZONS,horizonWaitDays} from './outcome-observation';
/** Observational follow-up, not a simulated order or a tested buy recommendation. */
export async function observeOneOutcome(owner:string){
 const db=database(),now=iso(),nowMs=Date.now(),cooldown=new Date(nowMs-6*3600000).toISOString();
 // One (case, horizon) pair at a time: the oldest case that has a due horizon without a recorded outcome.
 // Records written before horizons existed carry horizonIntervals 5; attempts without a horizon count as 5.
 const horizons=OUTCOME_HORIZONS.map(n=>[n,new Date(nowMs-horizonWaitDays(n)*86400000).toISOString()] as const);
 const row=await db.prepare(`WITH h(n,cutoff) AS (VALUES ${horizons.map(()=>'(?,?)').join(',')}) SELECT s.id,s.body,s.created_at,h.n AS horizon FROM signal_log s, h WHERE s.owner=? AND s.kind='discovery_case' AND s.created_at<=h.cutoff AND json_extract(s.body,'$.status')='complete' AND NOT EXISTS(SELECT 1 FROM signal_log o WHERE o.owner=s.owner AND o.kind='discovery_outcome' AND json_extract(o.body,'$.caseId')=s.id AND COALESCE(json_extract(o.body,'$.horizonIntervals'),5)=h.n) AND NOT EXISTS(SELECT 1 FROM signal_log a WHERE a.owner=s.owner AND a.kind='outcome_attempt' AND json_extract(a.body,'$.caseId')=s.id AND COALESCE(json_extract(a.body,'$.horizonIntervals'),5)=h.n AND a.created_at>?) ORDER BY s.created_at ASC,h.n ASC,s.id ASC LIMIT 1`).bind(...horizons.flat(),owner,cooldown).first<{id:string;body:string;created_at:string;horizon:number}>();
 if(!row)return {status:'idle',message:'No eligible cases awaiting observation.'};const c=JSON.parse(row.body),symbol=c.symbol,horizon=Number(row.horizon);
 try{
  if(typeof symbol!=='string'||!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol))throw new Error('Unusable symbol.');
  const credentials=env as unknown as {ALPACA_DATA_KEY_ID?:string;ALPACA_DATA_SECRET?:string};if(!credentials.ALPACA_DATA_KEY_ID||!credentials.ALPACA_DATA_SECRET)throw new Error('Historical data is not connected.');
  const results:{symbol:string;text:string;payload:any}[]=[];
  for(const ticker of [symbol,'SPY']){const params=new URLSearchParams({timeframe:'1Day',start:row.created_at.slice(0,10),end:now.slice(0,10),limit:'1000',adjustment:'all',feed:'iex',sort:'asc'});const response=await fetch('https://data.alpaca.markets/v2/stocks/'+encodeURIComponent(ticker)+'/bars?'+params,{headers:{'APCA-API-KEY-ID':credentials.ALPACA_DATA_KEY_ID,'APCA-API-SECRET-KEY':credentials.ALPACA_DATA_SECRET,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Historical bar source unavailable (HTTP '+response.status+').');const text=await response.text();if(text.length>300000)throw new Error('Historical response too large.');const payload=JSON.parse(text);if(payload.next_page_token)throw new Error('Historical observations exceeded one page; no result recorded.');results.push({symbol:ticker,text,payload});}
  const comparison=compareForwardBars(results[0].payload,results[1].payload,row.created_at,now,horizon);if(!comparison)throw new Error(`Fewer than ${horizon+1} matching completed IEX daily bars are available.`);
  const statements:D1PreparedStatement[]=[],rawIds:string[]=[];for(const r of results){const digest=await hash(r.text),rawId='outcome-raw:'+await hash(r.symbol+':'+digest),source='alpaca:iex:adjusted-bars:'+r.symbol;rawIds.push(rawId);statements.push(db.prepare('INSERT OR IGNORE INTO raw_event(id,source,fetched_at,published_at,known_from,content_hash,payload,http_status) VALUES(?,?,?,NULL,?,?,?,200)').bind(rawId,source,now,now,digest,r.text));}
  const outcome={version:'forward-observation-v1',horizonLabel:`${horizon} trading-day intervals`,caseId:row.id,symbol,caseAt:row.created_at,observedAt:now,benchmark:'SPY',feed:'IEX',adjustment:'all',...comparison,rawIds,limitations:'Gross adjusted daily close observations, not executable fills or a paper trade. Fees, spreads, slippage and taxes are excluded. IEX is a single exchange, and corporate-action adjustments depend on the provider. This observation includes WAIT cases and does not establish recommendation performance.'};
  const id='outcome:'+await hash(JSON.stringify([owner,row.id,horizon===5?'five-matched-daily-intervals-v1':`matched-daily-intervals-${horizon}-v1`]));statements.push(db.prepare("INSERT OR IGNORE INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'discovery_outcome',?,?)").bind(id,owner,now,c.identity?.cik?'sec:'+c.identity.cik:null,JSON.stringify(outcome)));const saved=await db.batch(statements);return {status:'observed',created:!!saved.at(-1)?.meta.changes,outcome};
 }catch(e){const message=e instanceof Error?e.message:'Historical observation unavailable.';await db.prepare("INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'outcome_attempt',NULL,?)").bind(crypto.randomUUID(),owner,iso(),JSON.stringify({caseId:row.id,horizonIntervals:horizon,message})).run();return {status:'pending',caseId:row.id,horizonIntervals:horizon,message:'Observation unavailable; retry after six hours.',detail:message};}
}

/** Observe several due (case, horizon) pairs in one run, within a count and time budget. */
export async function observeOutcomes(owner:string,limit=8,budgetMs=20000){
 const started=Date.now(),items:any[]=[];
 while(items.length<limit&&Date.now()-started<budgetMs){const r:any=await observeOneOutcome(owner);if(r.status==='idle')break;items.push(r);}
 const counts:Record<string,number>={};for(const r of items)counts[r.status]=(counts[r.status]??0)+1;
 return {status:items.length?'complete':'idle',attempted:items.length,counts,limit,timeBudgetMs:budgetMs,items:items.map((r:any)=>r.status==='observed'?{status:r.status,caseId:r.outcome.caseId,symbol:r.outcome.symbol,horizonIntervals:r.outcome.horizonIntervals,created:r.created}:r)};
}
