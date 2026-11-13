// On-demand runner for event-verify-v1. Only when the owner asks, never in the hourly run.
// Reads at most a handful of SEC Archive documents for one case, through the shared SEC rate limiter,
// with an identifying User-Agent, a time budget and a size cap. Every document is archived (R2 + raw_event)
// with its fetch time, and each check appends one `event_verification` record. Nothing existing is changed:
// not the case, its screen, score, ranking, outcomes or the Practice experiment.

import {env} from 'cloudflare:workers';
import {database,hash,iso} from '@/db/store';
import {secFetch,secToken,rawText} from './edgar';
import {verifyEvent,precheck,inWindow,claimOf,htmlToText,LIMITS,type FilingInput,type Doc} from './event-verify';

const archive=()=>(env as unknown as {ARCHIVE:R2Bucket}).ARCHIVE;
const ARCHIVE_URL=/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d{1,10}\/\d{18}\/[-A-Za-z0-9_.]{1,120}$/;
const MAX_BYTES=5_000_000,BUDGET_MS=25_000,COOLDOWN_MS=60_000;

/** One SEC Archive document as text. Accession folders never change, so an archived copy is reused. Throws on any failure. */
async function archiveText(url:string,filedAt:string,contact:string):Promise<{text:string;capturedAt:string;rawId:string;hash:string}>{
 if(!ARCHIVE_URL.test(url))throw new Error('Rejected SEC address');
 const db=database(),source='sec:'+url;
 const prior=await db.prepare('SELECT * FROM raw_event WHERE source=? ORDER BY fetched_at LIMIT 1').bind(source).first<any>();
 if(prior)return {text:await rawText(prior),capturedAt:prior.fetched_at,rawId:prior.id,hash:prior.content_hash};
 await secToken();
 const r=await fetch(url,{headers:{'User-Agent':'Sentinel Research '+contact,Accept:'text/html,application/json,text/plain'},redirect:'manual',signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw new Error('HTTP '+r.status);
 const length=Number(r.headers.get('content-length'));if(Number.isFinite(length)&&length>MAX_BYTES)throw new Error('Document too large to inspect');
 const text=await r.text();const bytes=new TextEncoder().encode(text).length;if(bytes>MAX_BYTES)throw new Error('Document too large to inspect');
 const digest=await hash(text),at=iso(),id=crypto.randomUUID(),objectKey='sec/'+digest+(url.endsWith('.json')?'.json.gz':'.html.gz');
 const compressed=await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
 await archive().put(objectKey,compressed,{httpMetadata:{contentType:'application/gzip'}});
 await db.prepare('INSERT OR IGNORE INTO raw_event(id,source,fetched_at,published_at,known_from,content_hash,payload,http_status) VALUES(?,?,?,?,?,?,?,200)').bind(id,source,at,filedAt,at,digest,JSON.stringify({objectKey,encoding:'gzip',uncompressedBytes:bytes})).run();
 const stored=await db.prepare('SELECT id,fetched_at FROM raw_event WHERE source=? AND content_hash=?').bind(source,digest).first<any>();
 return {text,capturedAt:stored?.fetched_at??at,rawId:stored?.id??id,hash:digest};
}

/** 8-Ks to examine: in the window nearest publication first; plus later 8-Ks reporting a completion or termination (timeline only). */
export function pickFilings(recent:any,publishedAt:string,nowMs:number){
 const rows:{accession:string;form:string;filedAt:string;items:string|null;primary:string|null}[]=[];
 const n=Array.isArray(recent?.accessionNumber)?recent.accessionNumber.length:0;
 for(let i=0;i<n;i++){const form=String(recent.form?.[i]??''),acc=String(recent.accessionNumber[i]),filedAt=String(recent.filingDate?.[i]??'');
  if(!/^8-K(\/A)?$/.test(form)||!/^\d{10}-\d{2}-\d{6}$/.test(acc)||!/^\d{4}-\d{2}-\d{2}$/.test(filedAt))continue;
  rows.push({accession:acc,form,filedAt,items:recent.items?.[i]?String(recent.items[i]):null,primary:recent.primaryDocument?.[i]?String(recent.primaryDocument[i]):null});}
 const pub=Date.parse(publishedAt.slice(0,10)+'T00:00:00Z');
 const near=rows.filter(r=>inWindow(r.filedAt,publishedAt)).sort((a,b)=>Math.abs(Date.parse(a.filedAt)-pub)-Math.abs(Date.parse(b.filedAt)-pub)).slice(0,LIMITS.inWindow);
 const later=rows.filter(r=>!inWindow(r.filedAt,publishedAt)&&Date.parse(r.filedAt)>pub&&Date.parse(r.filedAt)<=nowMs&&/\b(1\.02|2\.01)\b/.test(r.items??'')).sort((a,b)=>a.filedAt.localeCompare(b.filedAt)).slice(0,LIMITS.later);
 return [...near.map(r=>({...r,later:false})),...later.map(r=>({...r,later:true}))];
}

export async function latestVerification(owner:string,caseId:string){
 const row=await database().prepare("SELECT id,created_at,body FROM signal_log WHERE owner=? AND kind='event_verification' AND json_extract(body,'$.caseId')=? ORDER BY created_at DESC,id DESC LIMIT 1").bind(owner,caseId).first<{id:string;created_at:string;body:string}>();
 return row?{id:row.id,recordedAt:row.created_at,...JSON.parse(row.body)}:null;
}

export async function verifyCase(owner:string,caseId:string,contact:string,nowMs=Date.now()){
 const db=database();
 const row=await db.prepare("SELECT id,created_at,entity,body FROM signal_log WHERE id=? AND owner=? AND kind='discovery_case'").bind(caseId,owner).first<{id:string;created_at:string;entity:string|null;body:string}>();
 if(!row)return null;
 const prior=await latestVerification(owner,caseId);
 if(prior&&nowMs-Date.parse(prior.recordedAt)<COOLDOWN_MS)return {...prior,reused:true};
 const body=JSON.parse(row.body),kase={...body,id:row.id,createdAt:body.createdAt??row.created_at},checkedAt=new Date(nowMs).toISOString();
 let result:any;
 if(precheck(kase)){result=verifyEvent({kase,checkedAt});}
 else{
  const cik=String(kase.identity.cik),claim=claimOf(kase.event.headline,kase.identity?.name);
  let recent:any=null,sourceError:string|null=null,foreign=false;
  try{const sub=await secFetch('https://data.sec.gov/submissions/CIK'+cik+'.json',contact);if(String(sub.data?.cik).padStart(10,'0')!==cik)throw new Error('SEC identity did not match');recent=sub.data?.filings?.recent;
   const forms:string[]=(recent?.form??[]).map(String);foreign=forms.some(f=>/^(20-F|40-F|6-K)/.test(f))&&!forms.some(f=>/^(10-K|10-Q|8-K)/.test(f));}
  catch(e){sourceError=e instanceof Error?e.message:'SEC submissions unavailable';}
  const filings:FilingInput[]=[];
  if(!sourceError&&!foreign&&(claim.counterparties.length||claim.amounts.length)){
   const started=Date.now(),base='https://www.sec.gov/Archives/edgar/data/'+Number(cik)+'/';
   for(const f of pickFilings(recent,kase.event.publishedAt,nowMs)){
    const folder=base+f.accession.replaceAll('-','')+'/',indexUrl=folder+'index.json',documents:Doc[]=[];let error:string|null=null;
    if(Date.now()-started>=BUDGET_MS){filings.push({accession:f.accession,form:f.form,filedAt:f.filedAt,items:f.items,indexUrl,documents,error:'Not examined: time budget reached.',later:f.later});continue;}
    try{
     const names=new Set<string>();if(f.primary&&/^[-A-Za-z0-9_.]+\.(htm|html|txt)$/i.test(f.primary))names.add(f.primary);
     try{const idx=JSON.parse((await archiveText(indexUrl,f.filedAt,contact)).text);for(const it of (idx?.directory?.item??[])){const nm=String(it?.name??'');if(/ex-?99/i.test(nm)&&/^[-A-Za-z0-9_.]+\.(htm|html|txt)$/i.test(nm)&&[...names].filter(x=>/ex-?99/i.test(x)).length<LIMITS.exhibitsPerFiling)names.add(nm);}}
     catch(e){error='Filing index unreadable ('+(e instanceof Error?e.message:'error')+'); primary document only.';}
     for(const name of names){const url=folder+name;try{const d=await archiveText(url,f.filedAt,contact);documents.push({url,name,text:htmlToText(d.text),capturedAt:d.capturedAt,rawId:d.rawId,hash:d.hash});}catch(e){documents.push({url,name,text:null,error:e instanceof Error?e.message.slice(0,120):'Unreadable'});}}
    }catch(e){error=e instanceof Error?e.message.slice(0,120):'Unreadable';}
    filings.push({accession:f.accession,form:f.form,filedAt:f.filedAt,items:f.items,indexUrl,documents,error,later:f.later});
   }
  }
  result=verifyEvent({kase,checkedAt,filings,sourceError,foreignIssuer:foreign});
  // Document hashes go into the record id below, so a re-check of the same sources does not append a duplicate.
  (result as any).sourceHashes=filings.flatMap(f=>f.documents.map(d=>d.hash).filter(Boolean));
 }
 const id='event-verification:'+await hash(JSON.stringify([owner,caseId,result.state,result.sourceHashes??[],result.evidence.map((e:any)=>e.accession)]));
 const saved=await db.prepare("INSERT OR IGNORE INTO signal_log(id,owner,created_at,kind,entity,body) VALUES(?,?,?,'event_verification',?,?)").bind(id,owner,checkedAt,row.entity,JSON.stringify(result)).run();
 const stored=await db.prepare('SELECT id,created_at,body FROM signal_log WHERE id=? AND owner=?').bind(id,owner).first<any>();
 return {id,recordedAt:stored?.created_at??checkedAt,...JSON.parse(stored?.body??JSON.stringify(result)),appended:!!saved.meta.changes};
}
