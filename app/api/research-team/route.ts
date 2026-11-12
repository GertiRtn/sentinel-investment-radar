import {env} from 'cloudflare:workers';
import {database,hash,iso} from '@/db/store';
import {identity,body,json,failure,ApiError} from '@/lib/sentinel/api';
import {companyFile} from '@/lib/sentinel/edgar';
import {buildEvidencePack,modelPayload} from '@/lib/sentinel/evidence-pack';
import {runResearchTeam,RESEARCH_TEAM_VERSION,RESEARCH_DEFAULT_MODEL,RESEARCH_ALLOWED_MODELS} from '@/lib/sentinel/research-team';
import {z} from 'zod';
export const dynamic='force-dynamic';

type TeamEnv={RESEARCH_TEAM_ENABLED?:string;NVIDIA_API_KEY?:string;RESEARCH_MODEL?:string};
const COOLDOWN_MS=20000;

/**
 * On-demand research team for one of the owner's discovery cases.
 * Synchronous: one POST = at most one model call (20 s cap), then one append.
 * Idempotent on requestId: a retried request returns the stored run; a new run needs a new id.
 * Never called by the hourly pipeline. Never changes the case, screen, score, ranking, outcomes or trades.
 */
function config(){const e=env as unknown as TeamEnv;return {enabled:e.RESEARCH_TEAM_ENABLED,key:e.NVIDIA_API_KEY,model:e.RESEARCH_MODEL};}
function status(){const c=config(),model=c.model?.trim()||RESEARCH_DEFAULT_MODEL;return {enabled:c.enabled==='1',model,modelAllowed:(RESEARCH_ALLOWED_MODELS as readonly string[]).includes(model),keyConfigured:!!c.key};}
/** What the browser may see of a stored run: no raw model text, nothing private. */
function publicRun(id:string,createdAt:string,b:any){return {id,createdAt,version:b.version,caseId:b.caseId,asOf:b.asOf,recordedBy:b.recordedBy,packHash:b.packHash,pack:b.pack,mode:b.mode,status:b.status,failure:b.failure,model:b.model,promptVersion:b.promptVersion,httpStatus:b.httpStatus,latencyMs:b.latencyMs,output:b.output,dropped:b.dropped,allowedCitations:b.allowedCitations,rawSuppressed:b.rawSuppressed,sentFields:b.sentFields,label:b.label};}

async function loadCase(owner:string,caseId:string){
 const row=await database().prepare("SELECT id,created_at,body FROM signal_log WHERE id=? AND owner=? AND kind='discovery_case'").bind(caseId,owner).first<{id:string;created_at:string;body:string}>();
 if(!row)throw new ApiError(404,'Case not found.');return {...JSON.parse(row.body),id:row.id,createdAt:JSON.parse(row.body).createdAt??row.created_at};
}

export async function GET(request:Request){try{
 const owner=await identity(request),caseId=new URL(request.url).searchParams.get('case')||'';await loadCase(owner,caseId);
 const rows=(await database().prepare("SELECT id,created_at,body FROM signal_log WHERE owner=? AND kind='research_run' AND json_extract(body,'$.caseId')=? ORDER BY created_at DESC,id DESC LIMIT 10").bind(owner,caseId).all<{id:string;created_at:string;body:string}>()).results;
 return json({feature:status(),runs:rows.map(r=>publicRun(r.id,r.created_at,JSON.parse(r.body)))});
}catch(e){return failure(e)}}

export async function POST(request:Request){try{
 const owner=await identity(request),p=z.object({requestId:z.string().uuid(),caseId:z.string().min(1).max(200)}).strict().safeParse(await body(request));
 if(!p.success)throw new ApiError(400,'Choose a case to research.');
 const {requestId,caseId}=p.data,db=database();
 const existing=await db.prepare('SELECT owner,kind,created_at,body FROM signal_log WHERE id=?').bind(requestId).first<{owner:string;kind:string;created_at:string;body:string}>();
 if(existing){if(existing.owner!==owner||existing.kind!=='research_run'||JSON.parse(existing.body).caseId!==caseId)throw new ApiError(409,'This request identifier was already used.');return json({run:publicRun(requestId,existing.created_at,JSON.parse(existing.body)),repeated:true});}
 const kase=await loadCase(owner,caseId);
 const recent=await db.prepare("SELECT created_at FROM signal_log WHERE owner=? AND kind='research_run' AND json_extract(body,'$.caseId')=? ORDER BY created_at DESC LIMIT 1").bind(owner,caseId).first<{created_at:string}>();
 if(recent&&Date.now()-Date.parse(recent.created_at)<COOLDOWN_MS)throw new ApiError(429,'A research run for this case just finished. Wait a few seconds before starting another.');

 // Evidence as Sentinel held it when the case was assessed: filed AND recorded by then.
 const asOf=String(kase.createdAt);let figures:any[]=[],quarterly:any[]=[];const loadNotes:string[]=[];
 if(kase.identity?.cik){try{const file=await companyFile('sec:'+kase.identity.cik,asOf,'recorded',owner);figures=file.figures;quarterly=file.quarterlyFigures;}catch{loadNotes.push('SEC figures could not be loaded for this run.');}}
 const pack=buildEvidencePack({caseId,kase,figures,quarterlyFigures:quarterly,asOf,recordedBy:asOf});pack.missing.push(...loadNotes);
 const packHash=await hash(JSON.stringify(pack));
 const result=await runResearchTeam(pack,config());
 const now=iso();
 const record={version:RESEARCH_TEAM_VERSION,caseId,asOf,recordedBy:asOf,packHash,pack,sentFields:result.mode==='model'?Object.keys(modelPayload(pack)):[],
  mode:result.mode,status:result.status,failure:result.failure,model:result.model,promptVersion:result.promptVersion,httpStatus:result.httpStatus,latencyMs:result.latencyMs,
  output:result.output,dropped:result.dropped,allowedCitations:result.allowedCitations,rawResponse:result.rawResponse,rawSuppressed:result.rawSuppressed,
  label:result.mode==='model'?'Model-assisted research (unvalidated). Not a prediction or an investment recommendation.':'Rules template — no AI model ran. Not a prediction or an investment recommendation.',createdAt:now};
 let saved;try{saved=await db.prepare("INSERT OR IGNORE INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'research_run',?,?)").bind(requestId,owner,now,kase.identity?.cik?'sec:'+kase.identity.cik:null,JSON.stringify(record)).run();}
 catch{throw new ApiError(503,'The research run finished but could not be saved, so it is not shown. Try again.');}
 if(!saved.meta.changes){const again=await db.prepare('SELECT owner,created_at,body FROM signal_log WHERE id=?').bind(requestId).first<{owner:string;created_at:string;body:string}>();if(!again||again.owner!==owner)throw new ApiError(409,'This request identifier was already used.');return json({run:publicRun(requestId,again.created_at,JSON.parse(again.body)),repeated:true});}
 return json({run:publicRun(requestId,now,record),repeated:false});
}catch(e){return failure(e)}}
