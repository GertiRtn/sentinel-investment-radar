import {database} from '@/db/store';
import {identity,json,failure,ApiError} from '@/lib/sentinel/api';
import {caseIdea,casePrice,holdings,parseCase,type CaseRow} from '@/lib/sentinel/case-idea';
import {selectIdeas,ideaBrief,IDEA_WINDOW_DAYS,type LightCase} from '@/lib/sentinel/idea-select';
import {eventMatch,EVENT_MATCH_VERSION} from '@/lib/sentinel/event-match';
import {caseEvidenceScore} from '@/lib/sentinel/evidence-score';
export const dynamic='force-dynamic';

/**
 * Ideas to look at first, for Brief and Discover. Read-only; built from stored cases and SEC figures.
 *   GET /api/ideas              → selection, why (or why nothing qualified) and up to five compact cards
 *   GET /api/ideas?price=<id>   → price move around that case's event vs SPY (fetched on request, archived)
 *   GET /api/ideas?case=<id>    → the stored case, for opening the full case sheet
 */
const one=(owner:string,id:string)=>database().prepare("SELECT id,created_at,body FROM signal_log WHERE id=? AND owner=? AND kind='discovery_case'").bind(id,owner).first<CaseRow>();
export async function GET(request:Request){try{
 const owner=await identity(request),url=new URL(request.url),db=database(),priceId=url.searchParams.get('price'),caseId=url.searchParams.get('case');
 if(priceId||caseId){const row=await one(owner,(priceId||caseId)!);if(!row)throw new ApiError(404,'Case not found.');const kase=parseCase(row);
  return priceId?json(await casePrice(kase)):json({case:{...kase,evidence:kase.brief?.evidence??[],evidenceScore:caseEvidenceScore(kase)}});}
 const now=new Date().toISOString(),since=new Date(Date.parse(now)-IDEA_WINDOW_DAYS*86400000).toISOString();
 // Only the fields the selection needs; full bodies are read for the few picked cases.
 const rows=await db.prepare(`SELECT id,created_at,json_extract(body,'$.symbol') symbol,json_extract(body,'$.status') status,json_extract(body,'$.conclusion') conclusion,json_extract(body,'$.decision.version') screen,json_extract(body,'$.decision.reason') reason,json_extract(body,'$.evidenceScore.score') score,json_extract(body,'$.eventMatch.version') mv,json_extract(body,'$.eventMatch.level') ml,json_extract(body,'$.event.headline') headline,json_extract(body,'$.event.providerSummary') summary,json_extract(body,'$.identity.name') name,json_extract(body,'$.event.analysis.topics') topics,json_extract(body,'$.price.status') price,json_extract(body,'$.security.status') sec FROM signal_log WHERE owner=? AND created_at>? AND kind='discovery_case' ORDER BY created_at DESC LIMIT 1500`).bind(owner,since).all<any>();
 const light:LightCase[]=rows.results.map(r=>{let topics:unknown=[];try{topics=JSON.parse(r.topics||'[]')}catch{}return {id:r.id,symbol:String(r.symbol??''),createdAt:r.created_at,status:String(r.status??''),conclusion:String(r.conclusion??''),screenVersion:r.screen??null,reason:r.reason??null,score:typeof r.score==='number'?r.score:null,
  matchLevel:r.mv===EVENT_MATCH_VERSION&&r.ml?String(r.ml):eventMatch({headline:r.headline,summary:r.summary,companyName:r.name,symbol:r.symbol}).level,topics:Array.isArray(topics)?topics.filter((t):t is string=>typeof t==='string'):[],priceStatus:r.price??null,securityStatus:r.sec??null};});
 const selection=selectIdeas(light,now),held=selection.picked.length?await holdings(owner):null,ideas=[];
 for(const p of selection.picked){const row=await one(owner,p.caseId);if(!row)continue;const kase=parseCase(row);try{const {context,idea,score}=await caseIdea(owner,kase,held);ideas.push(ideaBrief(kase,context,idea,score,p.tier));}catch{/* a case that cannot be read is left out, never guessed */}}
 return json({...selection,generatedAt:now,ideas});
}catch(e){return failure(e)}}
