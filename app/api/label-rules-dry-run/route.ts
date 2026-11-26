import {identity,json,failure} from '@/lib/sentinel/api';
import {database,iso} from '@/db/store';
import {labelDryRun} from '@/lib/sentinel/label-dry-run';
export const dynamic='force-dynamic';
const CASE_LIMIT=20000;

/**
 * Label rules v2 dry run (label-dry-run-v1). Read-only and on request only, like /api/selection-comparison: one read
 * of the owner's stored cases; nothing fetched, written or changed. Returns counts only: no headlines, ids, symbols
 * or company names. Newest cases first, so a row limit can only leave out the oldest (and says so).
 *   GET /api/label-rules-dry-run
 */
export async function GET(request:Request){try{
 const owner=await identity(request),now=iso();
 const rows=(await database().prepare(`SELECT json_extract(body,'$.event.headline') headline,json_extract(body,'$.event.providerSummary') summary,json_extract(body,'$.identity.name') name,json_extract(body,'$.symbol') symbol,json_extract(body,'$.eventMatch.version') mv,json_extract(body,'$.eventMatch.level') ml,json_extract(body,'$.newsDirection.version') dv,json_extract(body,'$.newsDirection.direction') dd,json_extract(body,'$.identity.relevance.version') rv,json_extract(body,'$.identity.relevance.level') rl,json_extract(body,'$.identity.relevance.role') rr,json_extract(body,'$.event.analysis.topics') topics FROM signal_log WHERE owner=? AND kind='discovery_case' ORDER BY created_at DESC,id DESC LIMIT ${CASE_LIMIT}`).bind(owner).all<any>()).results;
 const list=(v:unknown)=>{try{const a=JSON.parse(String(v??'null'));return Array.isArray(a)?a.filter((t):t is string=>typeof t==='string'):null}catch{return null}};
 const s=(v:unknown)=>typeof v==='string'&&v?v:null;
 return json(labelDryRun(rows.map(r=>({headline:s(r.headline),summary:s(r.summary),companyName:s(r.name),symbol:s(r.symbol),
  storedMatch:r.ml?{version:s(r.mv),level:s(r.ml)}:null,storedDirection:r.dd?{version:s(r.dv),direction:s(r.dd)}:null,
  storedRelevance:r.rl?{version:s(r.rv),level:s(r.rl),role:s(r.rr)}:null,topics:list(r.topics)})),now,rows.length>=CASE_LIMIT));
}catch(e){return failure(e)}}
