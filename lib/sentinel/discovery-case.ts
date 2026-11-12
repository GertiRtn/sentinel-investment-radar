import {database,hash,iso} from '@/db/store';
import {resolveIdentifier,ingest,companyFile} from './edgar';
import {classifySecurity,collectSecurityAsset} from './security-asset';
import {priceAssessment,researchDecisionV2} from './price-assessment';
import {cashflowScenarios} from './cashflow-scenarios';
import {investmentBrief} from './investment-brief';
import {assessCompanyRelevance} from './news-assessment';
import {collectStockQuote} from '@/app/api/stock-quote/route';
import {shadowReadCases} from './shadow-store';
/** Select one unassessed provider-tagged symbol; prioritisation is research routing, not return prediction. */
export async function assessDiscoveryQueue(owner:string,email:string,oldestFirst=false){
 const db=database();
 const row=await db.prepare(`SELECT s.id,s.body,j.value symbol FROM signal_log s, json_each(s.body,'$.symbols') j WHERE s.owner=? AND s.kind='discovery_candidate' AND json_extract(s.body,'$.priority')='topic match' AND NOT EXISTS (SELECT 1 FROM signal_log a WHERE a.owner=s.owner AND a.kind='discovery_attempt' AND json_extract(a.body,'$.candidateId')=s.id AND json_extract(a.body,'$.symbol')=j.value AND a.created_at>?) AND NOT EXISTS (SELECT 1 FROM signal_log c WHERE c.owner=s.owner AND c.kind='discovery_case' AND json_extract(c.body,'$.candidateId')=s.id AND json_extract(c.body,'$.symbol')=j.value) ORDER BY CASE WHEN ?=1 THEN 0 WHEN json_array_length(s.body,'$.analysis.topics')=1 AND json_extract(s.body,'$.analysis.topics[0]')='Analyst opinion' THEN 2 WHEN json_extract(s.body,'$.analysis.topics') LIKE '%Earnings or financial results%' OR json_extract(s.body,'$.analysis.topics') LIKE '%Regulation or legal matter%' OR json_extract(s.body,'$.analysis.topics') LIKE '%Acquisition or transaction%' THEN 0 ELSE 1 END, CASE WHEN ?=1 THEN s.created_at END ASC, CASE WHEN ?=0 THEN s.created_at END DESC,s.id ASC,j.key ASC LIMIT 1`).bind(owner,new Date(Date.now()-6*3600000).toISOString(),oldestFirst?1:0,oldestFirst?1:0,oldestFirst?1:0).first<{id:string;body:string;symbol:string}>();
 if(!row)return {status:'idle',message:'No unassessed topic-matched symbols in the queue.'};
 const event=JSON.parse(row.body),symbol=row.symbol,at=iso();let identity:any=null,brief:any=null,quote:any=null,security:any={status:'unverified',reason:'Security details unavailable.'},price:any={status:'unavailable',reason:'Price assessment unavailable.'},valuation:any={status:'unavailable',reason:'Company financial evidence is unavailable.'};const missing:string[]=[];let status='complete';
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
    valuation=cashflowScenarios(file.figures,iso());price=priceAssessment({figures:file.figures,quote,security,asOf:iso(),filingsStale:file.stale});brief=investmentBrief({name:file.entity.name,cik:resolved.cik,figures:file.figures,asOf:iso(),stale:file.stale,lastGoodAt:file.lastGoodAt?String(file.lastGoodAt):null,filings:file.filings,quote});const evidenceCutoff=Date.parse(brief.asOf)-550*86400000;const old=brief.evidence.filter((e:any)=>e.periodEnd&&Date.parse(e.periodEnd+'T23:59:59.999Z')<evidenceCutoff);if(old.length){(brief as any).historicalEvidence=old;brief.evidence=brief.evidence.map((e:any)=>old.includes(e)?{...e,value:null,changePercent:null,confidence:'stale historical'}:e);brief.assessment=brief.assessment.filter((a:any)=>!old.some((e:any)=>e.label===a.label));brief.missing.push('Recent financial figures: older figures are retained only as historical evidence.');}
   }
  }
 }catch(e){const message=e instanceof Error?e.message:'Company assessment failed';await db.prepare("INSERT INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'discovery_attempt',NULL,?)").bind(crypto.randomUUID(),owner,iso(),JSON.stringify({candidateId:row.id,symbol,message})).run();return {status:'failed',candidateId:row.id,symbol,message:'Assessment failed; the candidate will be retried after a six-hour cooldown.',detail:message};}
 const createdAt=iso(),decision=researchDecisionV2({identity,price,brief,asOf:createdAt,topics:event.analysis?.topics}),result={version:'discovery-case-v2',candidateId:row.id,symbol,createdAt,status,conclusion:decision.conclusion,reason:decision.reason,decision,readiness:decision.readiness,rules:decision.rules,event:{headline:event.headline,url:event.url,source:event.source,publishedAt:event.publishedAt,firstObservedAt:event.firstObservedAt,rawEventId:event.rawEventId,analysis:event.analysis,providerSummary:event.providerSummary||null},identity,security,brief,valuation,price,missing:[...missing,'Verify the event and whether the company is directly affected.','Verify security class and share basis; compare price and valuation with market expectations.','Test the investment thesis and likely costs.'],limitations:'Ticker-to-company mapping is not proof that the news affects this company. A headline and IEX quote do not establish fair value or a buy signal.'};
 const id='discovery-case:'+await hash(JSON.stringify([owner,row.id,symbol]));const saved=await db.prepare("INSERT OR IGNORE INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'discovery_case',?,?)").bind(id,owner,createdAt,identity?'sec:'+identity.cik:null,JSON.stringify(result)).run();
 return {status,created:!!saved.meta.changes,caseId:id,case:saved.meta.changes?result:null};
}

/** Process a bounded batch, reserving one slot for old work to limit starvation. */
export async function assessDiscoveryBatch(owner:string,email:string){
 const started=Date.now(),items=[];
 for(let i=0;i<6;i++){if(i>0&&Date.now()-started>=35000)break;const result=await assessDiscoveryQueue(owner,email,i%3===2);if(result.status==='idle')break;items.push(result);}
 // Evaluation only: runs after every case in this batch has been created, so it cannot change what was assessed.
 let shadow:any;try{shadow=await shadowReadCases(owner,items)}catch{shadow={status:'failed',attempted:0}}
 return {status:items.some(x=>x.status==='failed')?'partial':items.length?'complete':'idle',items,shadow,remaining:null,coolingDown:null,limit:6,timeBudgetMs:35000,notice:'Queue totals temporarily unavailable to reduce database load. Triage uses headline topics and age, not estimated investment returns.'};
}
