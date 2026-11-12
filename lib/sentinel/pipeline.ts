import {database,hash} from '@/db/store';
import {ingest} from './edgar';
import {collectCompanyNews} from '@/app/api/company-news/route';
import {assessNews,assessCompanyRelevance} from './news-assessment';
import {buildBrief} from './brief-builder';

/**
 * Pipeline stages shared by the MCP endpoint (ChatGPT scheduled task on Sites)
 * and the Cron Trigger handler (own Cloudflare). Moved here verbatim from
 * app/mcp/route.ts on 2026-11-12; behaviour is unchanged.
 */

export async function checkWatchlistNews(ownerId:string){
  const db=database(),rows=await db.prepare("SELECT e.id,e.name,e.tickers FROM entity_watch w JOIN entity e ON e.id=w.entity_id WHERE w.owner=? ORDER BY e.id LIMIT 20").bind(ownerId).all<{id:string;name:string;tickers:string}>();const results=[];
  for(const company of rows.results){try{const capture=await collectCompanyNews(ownerId,company.id);const items=[];let reviewCount=0;for(const item of capture.items){const relevance=assessCompanyRelevance(item.headline,company.name);const analysis=assessNews(item),id='news:'+await hash(JSON.stringify([ownerId,company.id,item.id,item.updatedAt||item.publishedAt]));if(await db.prepare('SELECT id FROM signal_log WHERE id=? AND owner=?').bind(id,ownerId).first())continue;if(relevance.level==='review'){const event={headline:item.headline,url:item.url,source:item.source,publishedAt:item.publishedAt,updatedAt:item.updatedAt,rawEventId:capture.rawEventId,analysis,relevance};const inserted=await db.prepare("INSERT OR IGNORE INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'news_observation',?,?)").bind(id,ownerId,new Date().toISOString(),company.id,JSON.stringify(event)).run();if(inserted.meta.changes)reviewCount++;continue;}const brief=await buildBrief(ownerId,company.id);const event={headline:item.headline,url:item.url,source:item.source,publishedAt:item.publishedAt,updatedAt:item.updatedAt,rawEventId:capture.rawEventId,analysis,relevance,researchCase:{version:'event-case-v1',createdAt:brief.asOf,conclusion:'INVESTIGATE',reason:'A newly observed report warrants review; the claim, its impact and market expectations are not verified.',company:brief.company,quote:brief.quote,reportedResults:brief.evidence,recentFilings:brief.recentFilings,filingsStale:brief.stale,missing:brief.missing,risks:brief.risks}};const inserted=await db.prepare("INSERT OR IGNORE INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'news_observation',?,?)").bind(id,ownerId,new Date().toISOString(),company.id,JSON.stringify(event)).run();if(inserted.meta.changes)items.push(event);}results.push({company:company.name,status:'success',capturedAt:capture.capturedAt,rawEventId:capture.rawEventId,items,reviewCount});}catch(e){results.push({company:company.name,status:'failed',message:e instanceof Error?e.message:'News check failed'});}}
  return {checked:results.length,results,note:'Headlines are unverified; topics are keyword-based and do not constitute a buy recommendation. Limited to 20 saved companies.'};
 }

export async function refreshWatchlistFilings(owner:string,email:string){
 const db=database();
 const rows=await db.prepare("SELECT e.id,e.name,e.cik,MAX(r.known_from) AS last_check FROM entity_watch w JOIN entity e ON e.id=w.entity_id LEFT JOIN sec_run r ON r.entity_id=e.id WHERE w.owner=? GROUP BY e.id,e.name,e.cik ORDER BY COALESCE(MAX(r.known_from),'') ASC,e.id LIMIT 5").bind(owner).all<{id:string;name:string;cik:string;last_check:string|null}>();
 const results=[];
 for(const entity of rows.results){
  try{const result=await ingest(entity.cik,email);results.push({company:entity.name,status:'success',checked_at:new Date().toISOString(),observations_processed:result.observations,new_filings:result.newFilings});}
  catch(e){results.push({company:entity.name,status:'failed',checked_at:new Date().toISOString(),message:e instanceof Error?e.message:'Update failed'});}
 }
 return results;
}
