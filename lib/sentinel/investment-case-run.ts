// On-demand runner for investment-case-v1. Never part of the hourly run; never feeds notifications, rankings or experiments.
// Uses only data known at the case's assessment time: SEC figures and filings recorded by then, and IEX closes completed before it.
// One append-only record per case and version: the first computation is kept, so the record cannot drift with later data.
//
// `pointInTimeVerdict` (2026-11-15, for auto-practice-v2's shadow field) builds the same inputs but also restricts the
// event-verification check to checks recorded by the assessment time, and stores nothing in `investment_case`.
// It never feeds an entry decision.
import {env} from 'cloudflare:workers';
import {database,hash,iso} from '@/db/store';
import {companyFile} from './edgar';
import {archivedDailyBars} from './daily-bars';
import {closesOf} from './market-model';
import {assessInvestmentCase,INVESTMENT_CASE_VERSION} from './investment-case';

export async function storedInvestmentCase(owner:string,caseId:string){
 const row=await database().prepare("SELECT id,created_at,body FROM signal_log WHERE owner=? AND kind='investment_case' AND json_extract(body,'$.caseId')=? ORDER BY created_at DESC,id DESC LIMIT 1").bind(owner,caseId).first<{id:string;created_at:string;body:string}>();
 return row?{id:row.id,recordedAt:row.created_at,...JSON.parse(row.body)}:null;
}

type CaseRow={id:string;created_at:string;entity:string|null;body:string};
/** The prototype's inputs for one case. `verificationBy`: only event checks recorded by then (null: the latest, as the prototype does). */
async function gatherInputs(owner:string,row:CaseRow,verificationBy:string|null){
 const db=database(),body=JSON.parse(row.body),kase={...body,id:row.id,createdAt:body.createdAt??row.created_at},asOf=String(kase.createdAt),cik=String(kase.identity?.cik??'');
 let sic:string|null=null,annual:any[]=[],quarterly:any[]=[],filings:any[]|null=null,secRead=false,pricesRead=false;
 if(/^\d{10}$/.test(cik)){
  sic=(await db.prepare('SELECT sic FROM entity WHERE id=?').bind('sec:'+cik).first<{sic:string|null}>())?.sic??null;
  try{const file=await companyFile('sec:'+cik,asOf,'recorded',owner);annual=file.figures;quarterly=file.quarterlyFigures;filings=(file.filings as any[]).map(f=>({form:String(f.form),items:f.items??null,filed_at:String(f.filed_at)}));secRead=true;}catch{}
 }
 let stock:any[]|null=null,spy:any[]|null=null;
 const creds=env as unknown as {ALPACA_DATA_KEY_ID?:string;ALPACA_DATA_SECRET?:string};
 if(creds.ALPACA_DATA_KEY_ID&&creds.ALPACA_DATA_SECRET&&kase.symbol){
  const start=new Date(Date.parse(asOf)-400*86400000).toISOString().slice(0,10),end=asOf.slice(0,10);
  try{const [s,y]=await Promise.all([archivedDailyBars(String(kase.symbol),start,end,creds as any),archivedDailyBars('SPY',start,end,creds as any)]);
   // Only sessions that had closed before the assessment.
   const arr=(m:Map<string,number>)=>[...m.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,close])=>({date,close}));
   stock=arr(closesOf(s.payload,asOf));spy=arr(closesOf(y.payload,asOf));pricesRead=true;}catch{}
 }
 const vrow=verificationBy
  ?await db.prepare("SELECT created_at,body FROM signal_log WHERE owner=? AND kind='event_verification' AND json_extract(body,'$.caseId')=? AND created_at<=? ORDER BY created_at DESC,id DESC LIMIT 1").bind(owner,row.id,verificationBy).first<{created_at:string;body:string}>()
  :await db.prepare("SELECT created_at,body FROM signal_log WHERE owner=? AND kind='event_verification' AND json_extract(body,'$.caseId')=? ORDER BY created_at DESC,id DESC LIMIT 1").bind(owner,row.id).first<{created_at:string;body:string}>();
 const verification=vrow?{state:String(JSON.parse(vrow.body).state),checkedAt:vrow.created_at}:null;
 return {kase,cik,asOf,secRead,pricesRead,input:{kase,sic,annual,quarterly,filings,stock,spy,verification,computedAt:iso()}};
}

export async function assessCase(owner:string,caseId:string){
 const db=database();
 const row=await db.prepare("SELECT id,created_at,entity,body FROM signal_log WHERE id=? AND owner=? AND kind='discovery_case'").bind(caseId,owner).first<CaseRow>();
 if(!row)return null;
 const prior=await storedInvestmentCase(owner,caseId);if(prior&&prior.version===INVESTMENT_CASE_VERSION)return {...prior,reused:true};
 const {input}=await gatherInputs(owner,row,null);
 const result=assessInvestmentCase(input);
 const id='investment-case:'+await hash(JSON.stringify([owner,caseId,INVESTMENT_CASE_VERSION]));
 const saved=await db.prepare("INSERT OR IGNORE INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'investment_case',?,?)").bind(id,owner,result.computedAt,row.entity,JSON.stringify(result)).run();
 const stored=await db.prepare('SELECT created_at,body FROM signal_log WHERE id=? AND owner=?').bind(id,owner).first<{created_at:string;body:string}>();
 return {id,recordedAt:stored?.created_at??result.computedAt,...JSON.parse(stored?.body??JSON.stringify(result)),appended:!!saved.meta.changes};
}

/**
 * The prototype's verdict as Sentinel could have computed it at the case's assessment time. Nothing is stored here.
 * `not_reconstructable` when the case has no SEC company or the SEC records held at that time cannot be read; a
 * verdict of "insufficient evidence" is a computed verdict, not a reconstruction failure.
 */
export async function pointInTimeVerdict(owner:string,caseId:string){
 const row=await database().prepare("SELECT id,created_at,entity,body FROM signal_log WHERE id=? AND owner=? AND kind='discovery_case'").bind(caseId,owner).first<CaseRow>();
 if(!row)return {status:'not_reconstructable' as const,reason:'The case record was not found.'};
 const g=await gatherInputs(owner,row,String(JSON.parse(row.body).createdAt??row.created_at));
 if(!/^\d{10}$/.test(g.cik))return {status:'not_reconstructable' as const,reason:'The case has no SEC company.'};
 if(!g.secRead)return {status:'not_reconstructable' as const,reason:'The SEC records held at the assessment time could not be read.'};
 const r=assessInvestmentCase(g.input);
 return {status:'computed' as const,version:r.version,spec:r.spec,verdict:{id:r.verdict.id,text:r.verdict.text,why:r.verdict.why},companyType:r.companyType,asOf:g.asOf,
  inputs:{secRecordedBy:g.asOf,pricesAvailable:g.pricesRead,eventCheck:g.input.verification?{state:g.input.verification.state,checkedAt:g.input.verification.checkedAt}:'none recorded by the assessment time'},gaps:r.gaps.slice(0,20)};
}
