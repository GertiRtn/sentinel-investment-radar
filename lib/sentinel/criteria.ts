import {z} from 'zod';
import {database,iso} from '@/db/store';
import {ApiError} from './api';
import {companyFile} from './edgar';
import type {Figure} from './financial';
// period: 'year' (default, the original meaning) or 'quarter' (opt-in, 2026-11-12). basis: 'level' compares the reported value;
// 'yoy_pct' compares the % change against the same quarter a year earlier (quarterly only), which removes seasonality.
const comparison=z.object({metric:z.string().min(1).max(80),op:z.enum(['>','>=','<','<=','==','!=']),value:z.number().finite(),consecutive_periods:z.number().int().min(1).max(10).default(1),period:z.enum(['year','quarter']).optional(),basis:z.enum(['level','yoy_pct']).optional()}).strict();
/** Three-month flows reported directly in 10-Qs. Balance-sheet items and derived ratios need a trailing-year build and stay unknown. */
export const QUARTERLY_METRICS=['revenue','net_income','operating_income','cfo','capex','eps_diluted'];
const DAY=86400000,days=(a:string,b:string)=>(Date.parse(a)-Date.parse(b))/DAY;
const event=z.object({event:z.enum(['auditor_change','late_filing','material_weakness_disclosed'])}).strict();
export const Predicate=z.union([z.object({all:z.array(z.union([comparison,event])).min(1).max(20)}).strict(),z.object({any:z.array(z.union([comparison,event])).min(1).max(20)}).strict()]);
export type PredicateType=z.infer<typeof Predicate>;
export type Check={result:'pass'|'trip'|'unknown';reason:string;inputs:string[];values:Figure[];filing:any|null;predicate:any;streak:number;measured?:number[];period?:'year'|'quarter'};
const compare=(a:number,op:string,b:number)=>op==='>'?a>b:op==='>='?a>=b:op==='<'?a<b:op==='<='?a<=b:op==='=='?a===b:a!==b;
export function evaluate(predicate:PredicateType,figures:Figure[],filings:any[],asOf:string,quarterly:Figure[]=[]){
 const rules='all' in predicate?predicate.all:predicate.any;
 const checks:Check[]=rules.map(p=>{
 const unknown=(reason:string,values:Figure[]=[]):Check=>({result:'unknown',reason,inputs:values.flatMap(f=>f.inputs.map(i=>i.id)),values,filing:null,predicate:p,streak:0});
 if('event' in p){if(p.event==='material_weakness_disclosed')return unknown('Material weakness cannot be established from 8-K item codes alone; structured disclosure evidence is unavailable.');
 const found=filings.filter(f=>f.known_from<=asOf).find(f=>p.event==='auditor_change'?/^8-K/.test(f.form)&&String(f.items||'').split(/[,;\s]+/).includes('4.01'):/^NT (10-K|10-Q)/.test(f.form));
 return found?{result:'trip',reason:p.event==='auditor_change'?'Captured 8-K Item 4.01 reports an accountant change.':'Captured NT 10-K / NT 10-Q reports a late-filing notice; legal timeliness is not inferred.',inputs:[found.id],values:[],filing:found,predicate:p,streak:1}:unknown('No matching captured filing metadata. Completeness of event coverage is not established.');}
 if(p.period==='quarter')return quarterCheck(p,quarterly,figures,filings,asOf,unknown);
 if(p.basis==='yoy_pct')return unknown('Year-on-year % change is supported for quarterly criteria only (period "quarter").');
 const periods=[...new Set(figures.map(f=>f.period_end))].sort().reverse();if(!periods.length)return unknown('No annual financial periods available.');
 const values:Figure[]=[];for(let i=0;i<p.consecutive_periods;i++){const end=periods[i];if(!end)return unknown('Required consecutive annual period is missing.',values);if(i&&((Date.parse(periods[i-1])-Date.parse(end))/86400000>400||(Date.parse(periods[i-1])-Date.parse(end))/86400000<330))return unknown('A missing or irregular annual fiscal period breaks the streak.',values);const f=figures.find(f=>f.metric===p.metric&&f.period_end===end);if(!f||f.value===null||!f.known_from||f.known_from>asOf)return unknown(`${p.metric} unavailable for ${end}. ${f?.reason||'Unsupported metric'}`,values);values.push(f);}
 const breached=values.map(f=>compare(f.value!,p.op,p.value));let streak=0;for(const b of breached){if(!b)break;streak++;}const result=breached.every(Boolean)?'trip':'pass';const inputs=[...new Set(values.flatMap(f=>f.inputs.map(i=>i.id)))];const sourceFacts=values.flatMap(f=>f.inputs).sort((a,b)=>b.known_from.localeCompare(a.known_from)||b.accession.localeCompare(a.accession));const filing=filings.find(f=>f.accession===sourceFacts[0]?.accession)||null;
 return {result,reason:`${p.metric}: ${values[0].value} ${p.op} ${p.value}; ${streak} of ${p.consecutive_periods} consecutive annual fiscal periods breach the threshold.`,inputs,values,filing,predicate:p,streak};
 });
 // Conservative: any unevaluable child stays visible and prevents an overall pass.
 const result=checks.some(c=>c.result==='unknown')?'unknown':'all' in predicate?(checks.every(c=>c.result==='trip')?'trip':'pass'):(checks.some(c=>c.result==='trip')?'trip':'pass');
 return {result,reason:checks.map(c=>c.reason).join('\n'),checks,inputs:[...new Set(checks.flatMap(c=>c.inputs))],triggeringFiling:checks.map(c=>c.filing).filter(Boolean).sort((a,b)=>b.known_from.localeCompare(a.known_from))[0]||null};
}
/**
 * Quarterly condition: consecutive reported quarters, newest first. 10-Qs do not report the fiscal fourth quarter
 * separately and Sentinel never derives it from annual minus year-to-date, so a skipped quarter that ends on the
 * company's fiscal year end does not break the streak; any other gap makes the condition unknown.
 */
function quarterCheck(p:any,quarterly:Figure[],annual:Figure[],filings:any[],asOf:string,unknown:(r:string,v?:Figure[])=>Check):Check{
 if(!QUARTERLY_METRICS.includes(p.metric))return unknown(`${p.metric} is not reported as a three-month figure; quarterly checks support ${QUARTERLY_METRICS.join(', ')}.`);
 const rows=quarterly.filter(f=>f.metric===p.metric&&f.value!==null&&f.known_from&&f.known_from<=asOf).sort((a,b)=>b.period_end.localeCompare(a.period_end));
 if(!rows.length)return unknown(`No reported quarterly ${p.metric} available.`);
 const yearEnds=annual.map(f=>f.period_end.slice(5));
 const isFiscalQ4=(end:string)=>yearEnds.some(md=>{const d=Math.abs(days(end.slice(0,4)+'-'+md,end));return d<=10;});
 const values:Figure[]=[],measured:number[]=[],inputs:Figure[]=[];
 for(let i=0;i<p.consecutive_periods;i++){
  const cur=rows[i];if(!cur)return unknown(`Only ${i} reported quarter(s) of ${p.metric} available; ${p.consecutive_periods} needed.`,values);
  if(i){const gap=days(rows[i-1].period_end,cur.period_end),skipped=new Date(Date.parse(cur.period_end)+91*DAY).toISOString().slice(0,10);
   if(!(gap>=80&&gap<=100)&&!(gap>=170&&gap<=195&&isFiscalQ4(skipped)))return unknown(`A missing quarter between ${cur.period_end} and ${rows[i-1].period_end} breaks the streak.`,values);}
  if(p.basis==='yoy_pct'){
   const tag=cur.inputs[0]?.source_tag,prior=quarterly.find(f=>f.metric===p.metric&&f.value!==null&&f.known_from&&f.known_from<=asOf&&f.inputs[0]?.source_tag===tag&&days(cur.period_end,f.period_end)>=350&&days(cur.period_end,f.period_end)<=380);
   if(!prior)return unknown(`No comparable quarter a year before ${cur.period_end} for ${p.metric}.`,values);
   if(!(prior.value!>0))return unknown(`The year-earlier ${p.metric} is zero or negative; a % change is not meaningful.`,values);
   measured.push((cur.value!-prior.value!)/prior.value!*100);inputs.push(cur,prior);
  }else{measured.push(cur.value!);inputs.push(cur);}
  values.push(cur);
 }
 const breached=measured.map(v=>compare(v,p.op,p.value));let streak=0;for(const b of breached){if(!b)break;streak++;}
 const sourceFacts=inputs.flatMap(f=>f.inputs).sort((a,b)=>b.known_from.localeCompare(a.known_from)||b.accession.localeCompare(a.accession));
 const shown=p.basis==='yoy_pct'?measured[0].toFixed(1)+'% vs same quarter a year earlier':String(measured[0]);
 return {result:breached.every(Boolean)?'trip':'pass',reason:`${p.metric} (quarter to ${values[0].period_end}): ${shown} ${p.op} ${p.value}; ${streak} of ${p.consecutive_periods} consecutive reported quarters breach the threshold.`,
  inputs:[...new Set(inputs.flatMap(f=>f.inputs.map(i=>i.id)))],values,filing:filings.find(f=>f.accession===sourceFacts[0]?.accession)||null,predicate:p,streak,measured,period:'quarter'};
}
/** Compares an earlier evaluation of the same moment with a fresh one. Pure; exported for tests. */
export function compareReplay(earlier:any,fresh:any,earlierId:string){
 const view=(r:any)=>({result:r?.result,checks:(r?.checks||[]).map((c:any)=>({result:c.result,reason:c.reason,streak:c.streak,inputs:[...(c.inputs||[])].sort(),filing:c.filing?.accession??null}))});
 const a=view(earlier),b=view(fresh),differences:string[]=[];
 if(a.result!==b.result)differences.push(`Overall result changed from ${a.result} to ${b.result}.`);
 const n=Math.max(a.checks.length,b.checks.length);
 for(let i=0;i<n;i++){const x=a.checks[i],y=b.checks[i];if(JSON.stringify(x)!==JSON.stringify(y))differences.push(`Condition ${i+1}: ${x?.reason??'absent'} → ${y?.reason??'absent'}`);}
 return {evaluationId:earlierId,matches:differences.length===0,earlierResult:a.result,differences};
}
export async function evaluateCriterion(criterion:any,memo:any,asOf:string){
 const db=database(),now=iso();const prior=await db.prepare('SELECT * FROM criterion_evaluation WHERE kill_criterion_id=? ORDER BY evaluated_at DESC,id DESC LIMIT 1').bind(criterion.id).first<any>();
 const replay=await db.prepare('SELECT * FROM criterion_evaluation WHERE kill_criterion_id=? AND as_of=? ORDER BY evaluated_at,id LIMIT 1').bind(criterion.id,asOf).first<any>();
 const company=await companyFile(memo.entity_id,asOf,'public',memo.owner);
 // Always recompute. An earlier evaluation of the same moment is compared, never served: a snapshot taken
 // before a backfill completed rests on incomplete data, and serving it would hide the divergence.
 const fresh=evaluate(JSON.parse(criterion.predicate_json),company.figures,company.filings,asOf,company.quarterlyFigures);
 const replayOf=replay?compareReplay(JSON.parse(replay.snapshot_json),fresh,replay.id):null;
 const result=replayOf?{...fresh,replayOf}:fresh;
 const id=crypto.randomUUID();await db.prepare('INSERT INTO criterion_evaluation(id,kill_criterion_id,evaluated_at,as_of,result,reason,inputs_json,triggering_filing_id,supersedes_id,snapshot_json) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,criterion.id,now,asOf,result.result,result.reason,JSON.stringify(result.inputs),result.triggeringFiling?.id||null,prior?.result==='trip'&&result.result==='pass'&&asOf>=prior.as_of?prior.id:null,JSON.stringify(result)).run();
 if(replayOf&&!replayOf.matches){const alert={title:'OPERATIONAL ALERT — REPLAY DIFFERS FROM AN EARLIER EVALUATION',company:company.entity.name,criterionCreatedAt:criterion.known_from,condition:JSON.parse(criterion.predicate_json),asOf,earlierEvaluationId:replay.id,earlierResult:replayOf.earlierResult,currentResult:fresh.result,differences:replayOf.differences,note:'The same moment now evaluates differently, usually because data with a filing date on or before this moment was captured later (for example after a backfill). Both evaluations are kept. This is a research record, not a trade instruction.'};await db.prepare('INSERT INTO criterion_alert(id,owner,evaluation_id,known_from,tier,body) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),memo.owner,id,now,'Operational',JSON.stringify(alert)).run();}
 if(result.result==='trip'||result.result==='unknown'&&prior?.result==='unknown'){
 const title=result.result==='trip'?'KILL CRITERION TRIPPED':'OPERATIONAL ALERT — CONDITION UNKNOWN TWICE';
 const evidence=result.checks.map((c:Check)=>({condition:c.predicate,current:c.measured?.[0]??c.values[0]?.value??null,period:c.period??'year',confidence:c.values[0]?.confidence??null,method:c.values[0]?.method??null,estimated:c.values.some(f=>f.confidence==='estimated'),periodEnd:c.values[0]?.period_end||null,streak:c.streak,source:c.filing,inputs:c.values.flatMap(f=>f.inputs)}));
 const estimatedNote=evidence.some(e=>e.estimated)?' Some values in this check are estimates (for example EBITDA approximated as operating income plus depreciation), not directly reported figures.':'';
 const alert={title,company:company.entity.name,criterionCreatedAt:criterion.known_from,condition:JSON.parse(criterion.predicate_json),reason:result.reason,thesis:memo.thesis,evidence,asOf,note:'This is a research record, not a trade instruction. Acting on it requires a decision session and the cooling-off interval. These gates are not yet enforced by Sentinel.'+estimatedNote};
 await db.prepare('INSERT INTO criterion_alert(id,owner,evaluation_id,known_from,tier,body) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),memo.owner,id,now,result.result==='trip'?'Immediate':'Operational',JSON.stringify(alert)).run();}
 return {id,...result,evaluatedAt:now,asOf};
}
export async function evaluateEntity(entityId:string){
 const db=database();const criteria=(await db.prepare('SELECT c.*,m.owner,m.entity_id,m.thesis FROM kill_criterion c JOIN research_memo m ON m.id=c.memo_id WHERE m.entity_id=? AND NOT EXISTS(SELECT 1 FROM kill_criterion n WHERE n.supersedes_id=c.id)').bind(entityId).all()).results;
 // Evaluate each newly known filing in chronological order, not just the final backfill state.
 for(const c of criteria){const previous=await db.prepare('SELECT MAX(as_of) cutoff FROM criterion_evaluation WHERE kill_criterion_id=?').bind(c.id).first<any>();const filings=(await db.prepare('SELECT DISTINCT known_from FROM filing WHERE entity_id=? AND known_from>? AND known_from<=? ORDER BY known_from').bind(entityId,previous?.cutoff||String(c.known_from),iso()).all()).results;const memo={id:c.memo_id,owner:c.owner,entity_id:c.entity_id,thesis:c.thesis};for(const f of filings)await evaluateCriterion(c,memo,String(f.known_from));if(!filings.length)await evaluateCriterion(c,memo,iso());}
}
export async function appendCriterion(owner:string,input:any){
 const d=z.object({requestId:z.string().uuid(),memo_id:z.string().uuid(),predicate:Predicate,supersedes_id:z.string().uuid().nullable().default(null),supersede_reason:z.string().trim().max(6000).default('')}).strict().safeParse(input);if(!d.success)throw new ApiError(400,'Use one all/any group with supported comparison or event predicates.');const p=d.data,db=database();
 const memo=await db.prepare('SELECT * FROM research_memo WHERE id=? AND owner=?').bind(p.memo_id,owner).first<any>();if(!memo)throw new ApiError(404,'Memo not found');
 if(p.supersedes_id){if(p.supersede_reason.length<10)throw new ApiError(400,'A dated written justification of at least 10 characters is required for every criterion change.');const old=await db.prepare('SELECT id FROM kill_criterion WHERE id=? AND memo_id=?').bind(p.supersedes_id,p.memo_id).first();if(!old)throw new ApiError(400,'The superseded criterion must belong to this memo');}
 const existing=await db.prepare('SELECT * FROM kill_criterion WHERE id=?').bind(p.requestId).first<any>();if(existing){if(existing.memo_id!==p.memo_id||existing.predicate_json!==JSON.stringify(p.predicate))throw new ApiError(409,'Identifier already used');return {id:p.requestId};}
 try{await db.prepare('INSERT INTO kill_criterion(id,memo_id,predicate_json,known_from,supersedes_id,supersede_reason) VALUES(?,?,?,?,?,?)').bind(p.requestId,p.memo_id,JSON.stringify(p.predicate),iso(),p.supersedes_id,p.supersede_reason).run();}catch{throw new ApiError(409,'Criterion already superseded. Reload its history.');}
 const c=await db.prepare('SELECT * FROM kill_criterion WHERE id=?').bind(p.requestId).first();return {id:p.requestId,evaluation:await evaluateCriterion(c,memo,iso())};
}
