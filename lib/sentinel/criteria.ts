import {z} from 'zod';
import {database,iso} from '@/db/store';
import {ApiError} from './api';
import {companyFile} from './edgar';
import type {Figure} from './financial';
const comparison=z.object({metric:z.string().min(1).max(80),op:z.enum(['>','>=','<','<=','==','!=']),value:z.number().finite(),consecutive_periods:z.number().int().min(1).max(10).default(1)}).strict();
const event=z.object({event:z.enum(['auditor_change','late_filing','material_weakness_disclosed'])}).strict();
export const Predicate=z.union([z.object({all:z.array(z.union([comparison,event])).min(1).max(20)}).strict(),z.object({any:z.array(z.union([comparison,event])).min(1).max(20)}).strict()]);
export type PredicateType=z.infer<typeof Predicate>;
export type Check={result:'pass'|'trip'|'unknown';reason:string;inputs:string[];values:Figure[];filing:any|null;predicate:any;streak:number};
const compare=(a:number,op:string,b:number)=>op==='>'?a>b:op==='>='?a>=b:op==='<'?a<b:op==='<='?a<=b:op==='=='?a===b:a!==b;
export function evaluate(predicate:PredicateType,figures:Figure[],filings:any[],asOf:string){
 const rules='all' in predicate?predicate.all:predicate.any;
 const checks:Check[]=rules.map(p=>{
 const unknown=(reason:string,values:Figure[]=[]):Check=>({result:'unknown',reason,inputs:values.flatMap(f=>f.inputs.map(i=>i.id)),values,filing:null,predicate:p,streak:0});
 if('event' in p){if(p.event==='material_weakness_disclosed')return unknown('Material weakness cannot be established from 8-K item codes alone; structured disclosure evidence is unavailable.');
 const found=filings.filter(f=>f.known_from<=asOf).find(f=>p.event==='auditor_change'?/^8-K/.test(f.form)&&String(f.items||'').split(/[,;\s]+/).includes('4.01'):/^NT (10-K|10-Q)/.test(f.form));
 return found?{result:'trip',reason:p.event==='auditor_change'?'Captured 8-K Item 4.01 reports an accountant change.':'Captured NT 10-K / NT 10-Q reports a late-filing notice; legal timeliness is not inferred.',inputs:[found.id],values:[],filing:found,predicate:p,streak:1}:unknown('No matching captured filing metadata. Completeness of event coverage is not established.');}
 const periods=[...new Set(figures.map(f=>f.period_end))].sort().reverse();if(!periods.length)return unknown('No annual financial periods available.');
 const values:Figure[]=[];for(let i=0;i<p.consecutive_periods;i++){const end=periods[i];if(!end)return unknown('Required consecutive annual period is missing.',values);if(i&&((Date.parse(periods[i-1])-Date.parse(end))/86400000>400||(Date.parse(periods[i-1])-Date.parse(end))/86400000<330))return unknown('A missing or irregular annual fiscal period breaks the streak.',values);const f=figures.find(f=>f.metric===p.metric&&f.period_end===end);if(!f||f.value===null||!f.known_from||f.known_from>asOf)return unknown(`${p.metric} unavailable for ${end}. ${f?.reason||'Unsupported metric'}`,values);values.push(f);}
 const breached=values.map(f=>compare(f.value!,p.op,p.value));let streak=0;for(const b of breached){if(!b)break;streak++;}const result=breached.every(Boolean)?'trip':'pass';const inputs=[...new Set(values.flatMap(f=>f.inputs.map(i=>i.id)))];const sourceFacts=values.flatMap(f=>f.inputs).sort((a,b)=>b.known_from.localeCompare(a.known_from)||b.accession.localeCompare(a.accession));const filing=filings.find(f=>f.accession===sourceFacts[0]?.accession)||null;
 return {result,reason:`${p.metric}: ${values[0].value} ${p.op} ${p.value}; ${streak} of ${p.consecutive_periods} consecutive annual fiscal periods breach the threshold.`,inputs,values,filing,predicate:p,streak};
 });
 // Conservative: any unevaluable child stays visible and prevents an overall pass.
 const result=checks.some(c=>c.result==='unknown')?'unknown':'all' in predicate?(checks.every(c=>c.result==='trip')?'trip':'pass'):(checks.some(c=>c.result==='trip')?'trip':'pass');
 return {result,reason:checks.map(c=>c.reason).join('\n'),checks,inputs:[...new Set(checks.flatMap(c=>c.inputs))],triggeringFiling:checks.map(c=>c.filing).filter(Boolean).sort((a,b)=>b.known_from.localeCompare(a.known_from))[0]||null};
}
export async function evaluateCriterion(criterion:any,memo:any,asOf:string){
 const db=database(),now=iso();const prior=await db.prepare('SELECT * FROM criterion_evaluation WHERE kill_criterion_id=? ORDER BY evaluated_at DESC,id DESC LIMIT 1').bind(criterion.id).first<any>();
 const replay=await db.prepare('SELECT * FROM criterion_evaluation WHERE kill_criterion_id=? AND as_of=? ORDER BY evaluated_at,id LIMIT 1').bind(criterion.id,asOf).first<any>();
 const company=await companyFile(memo.entity_id,asOf,'public',memo.owner);const result=replay?JSON.parse(replay.snapshot_json):evaluate(JSON.parse(criterion.predicate_json),company.figures,company.filings,asOf);
 const id=crypto.randomUUID();await db.prepare('INSERT INTO criterion_evaluation(id,kill_criterion_id,evaluated_at,as_of,result,reason,inputs_json,triggering_filing_id,supersedes_id,snapshot_json) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,criterion.id,now,asOf,result.result,result.reason,JSON.stringify(result.inputs),result.triggeringFiling?.id||null,prior?.result==='trip'&&result.result==='pass'&&asOf>=prior.as_of?prior.id:null,JSON.stringify(result)).run();
 if(result.result==='trip'||result.result==='unknown'&&prior?.result==='unknown'){
 const title=result.result==='trip'?'KILL CRITERION TRIPPED':'OPERATIONAL ALERT — CONDITION UNKNOWN TWICE';
 const evidence=result.checks.map((c:Check)=>({condition:c.predicate,current:c.values[0]?.value??null,periodEnd:c.values[0]?.period_end||null,streak:c.streak,source:c.filing,inputs:c.values.flatMap(f=>f.inputs)}));
 const alert={title,company:company.entity.name,criterionCreatedAt:criterion.known_from,condition:JSON.parse(criterion.predicate_json),reason:result.reason,thesis:memo.thesis,evidence,asOf,note:'This is a research record, not a trade instruction. Acting on it requires a decision session and the cooling-off interval. These gates are not yet enforced by Sentinel.'};
 await db.prepare('INSERT INTO criterion_alert(id,owner,evaluation_id,known_from,tier,body) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),memo.owner,id,now,result.result==='trip'?'Immediate':'Operational',JSON.stringify(alert)).run();}
 return {id,...result,evaluatedAt:now,asOf};
}
export async function evaluateEntity(entityId:string){
 const db=database();const criteria=(await db.prepare('SELECT c.*,m.owner,m.entity_id,m.thesis FROM kill_criterion c JOIN research_memo m ON m.id=c.memo_id WHERE m.entity_id=? AND NOT EXISTS(SELECT 1 FROM kill_criterion n WHERE n.supersedes_id=c.id)').bind(entityId).all()).results;
 // Evaluate each newly known filing in chronological order, not just the final backfill state.
 for(const c of criteria){const previous=await db.prepare('SELECT MAX(as_of) cutoff FROM criterion_evaluation WHERE kill_criterion_id=?').bind(c.id).first<any>();const filings=(await db.prepare('SELECT DISTINCT known_from FROM filing WHERE entity_id=? AND known_from>? AND known_from<=? ORDER BY known_from').bind(entityId,previous?.cutoff||String(c.known_from),iso()).all()).results;for(const f of filings)await evaluateCriterion(c,c,String(f.known_from));if(!filings.length)await evaluateCriterion(c,c,iso());}
}
export async function appendCriterion(owner:string,input:any){
 const d=z.object({requestId:z.string().uuid(),memo_id:z.string().uuid(),predicate:Predicate,supersedes_id:z.string().uuid().nullable().default(null),supersede_reason:z.string().trim().max(6000).default('')}).strict().safeParse(input);if(!d.success)throw new ApiError(400,'Use one all/any group with supported comparison or event predicates.');const p=d.data,db=database();
 const memo=await db.prepare('SELECT * FROM research_memo WHERE id=? AND owner=?').bind(p.memo_id,owner).first<any>();if(!memo)throw new ApiError(404,'Memo not found');
 if(p.supersedes_id){if(p.supersede_reason.length<10)throw new ApiError(400,'A dated written justification of at least 10 characters is required for every criterion change.');const old=await db.prepare('SELECT id FROM kill_criterion WHERE id=? AND memo_id=?').bind(p.supersedes_id,p.memo_id).first();if(!old)throw new ApiError(400,'The superseded criterion must belong to this memo');}
 const existing=await db.prepare('SELECT * FROM kill_criterion WHERE id=?').bind(p.requestId).first<any>();if(existing){if(existing.memo_id!==p.memo_id||existing.predicate_json!==JSON.stringify(p.predicate))throw new ApiError(409,'Identifier already used');return {id:p.requestId};}
 try{await db.prepare('INSERT INTO kill_criterion(id,memo_id,predicate_json,known_from,supersedes_id,supersede_reason) VALUES(?,?,?,?,?,?)').bind(p.requestId,p.memo_id,JSON.stringify(p.predicate),iso(),p.supersedes_id,p.supersede_reason).run();}catch{throw new ApiError(409,'Criterion already superseded. Reload its history.');}
 const c=await db.prepare('SELECT * FROM kill_criterion WHERE id=?').bind(p.requestId).first();return {id:p.requestId,evaluation:await evaluateCriterion(c,memo,iso())};
}
