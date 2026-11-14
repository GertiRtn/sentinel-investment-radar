import {env} from 'cloudflare:workers';
import {identity,json,failure,ApiError} from '@/lib/sentinel/api';
import {database,iso} from '@/db/store';
import {companyFile} from '@/lib/sentinel/edgar';
import {archivedDailyBars} from '@/lib/sentinel/daily-bars';
import {caseIdea,holdings,parseCase} from '@/lib/sentinel/case-idea';
import {buildCompanyPage} from '@/lib/sentinel/company-page';
export const dynamic='force-dynamic';

/**
 * Company page (company-page-v1). Read-only and owner-scoped: the owner's research cases for one ticker, the
 * company's reported SEC figures, archived IEX daily prices and the owner's virtual positions. Writes nothing
 * except the shared price archive (raw_event), exactly as the case sheet already does.
 */
export async function GET(request:Request){try{
 const owner=await identity(request),symbol=(new URL(request.url).searchParams.get('symbol')||'').toUpperCase();
 if(!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol))throw new ApiError(400,'A valid ticker is required.');
 const db=database();
 const caseRows=(await db.prepare("SELECT id,created_at,body FROM signal_log WHERE owner=? AND kind='discovery_case' AND json_extract(body,'$.symbol')=? ORDER BY created_at DESC,id DESC LIMIT 20").bind(owner,symbol).all<{id:string;created_at:string;body:string}>()).results;
 const cases=caseRows.map(parseCase);
 const cikFromCase=cases.find(k=>/^\d{10}$/.test(String(k.identity?.cik??'')))?.identity?.cik??null;
 const entity=cikFromCase?await db.prepare('SELECT id,cik,name,sic FROM entity WHERE id=?').bind('sec:'+cikFromCase).first<any>()
  :await db.prepare("SELECT e.id,e.cik,e.name,e.sic FROM entity e JOIN entity_watch w ON w.entity_id=e.id WHERE w.owner=? AND EXISTS(SELECT 1 FROM json_each(e.tickers) WHERE upper(value)=?) LIMIT 1").bind(owner,symbol).first<any>();
 if(!cases.length&&!entity)throw new ApiError(404,'Sentinel has no research case or saved company for this ticker.');
 const followed=entity?!!(await db.prepare('SELECT 1 FROM entity_watch WHERE owner=? AND entity_id=? LIMIT 1').bind(owner,entity.id).first()):false;
 const held=await holdings(owner);
 const latest=cases[0]??null,idea=latest?await caseIdea(owner,latest,held):null;
 const verRows=cases.length?(await db.prepare(`SELECT created_at,body FROM signal_log WHERE owner=? AND kind='event_verification' AND json_extract(body,'$.caseId') IN (${cases.map(()=>'?').join(',')}) ORDER BY created_at,id`).bind(owner,...cases.map(k=>k.id)).all<{created_at:string;body:string}>()).results:[];
 const verifications:Record<string,any>={};for(const r of verRows){const b=JSON.parse(r.body);verifications[b.caseId]=b;}
 let figures:any[]=[],quarterly:any[]=[],figuresAsOf:string|null=null;
 if(entity){try{const file=await companyFile(entity.id,iso(),'public',owner);figures=file.figures;quarterly=file.quarterlyFigures;figuresAsOf=file.lastGoodAt?String(file.lastGoodAt):null;}catch{}}
 const creds=env as unknown as {ALPACA_DATA_KEY_ID?:string;ALPACA_DATA_SECRET?:string};let bars:any={stock:null,spy:null,fetchedAt:null,error:null};
 if(!creds.ALPACA_DATA_KEY_ID||!creds.ALPACA_DATA_SECRET)bars.error='Market data is not connected.';
 else{const day=86400000,start=new Date(Date.now()-400*day).toISOString().slice(0,10),end=new Date().toISOString().slice(0,10);
  try{const [s,y]=await Promise.all([archivedDailyBars(symbol,start,end,creds as any),archivedDailyBars('SPY',start,end,creds as any)]);bars={stock:s.payload,spy:y.payload,fetchedAt:s.fetchedAt<y.fetchedAt?s.fetchedAt:y.fetchedAt,error:null};}
  catch(e){bars.error=e instanceof Error?e.message:'Daily prices could not be loaded.';}}
 const manual=held?.manual?held.manual.open.filter(p=>p.symbol===symbol).reduce((n,p)=>n+p.amountCents,0):null;
 return json(buildCompanyPage({symbol,entity:entity?{name:entity.name,cik:entity.cik,sic:entity.sic??null}:null,followed,cases,
  latestIdea:idea?{view:idea.idea.view,score:idea.score,summary:idea.thesis().summary,match:idea.match}:null,verifications,figures,quarterly,figuresAsOf,bars,
  positions:{manualCents:manual,inExperiment:held?held.autoOpenSymbols.includes(symbol):null}}));
}catch(e){return failure(e)}}
