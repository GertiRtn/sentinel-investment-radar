import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {Miniflare,createFetchMock}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler/package.json')]}));
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const migration=(readFileSync('drizzle/0000_material_lord_tyger.sql','utf8')+'\n--> statement-breakpoint\n'+readFileSync('drizzle/0001_illegal_frightful_four.sql','utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
const worker=`import * as workspace from './app/api/workspace/route';import * as journal from './app/api/journal/route';import * as history from './app/api/history/route';import {collectMarket,collectNews} from './lib/sentinel/collector';export default {async fetch(request,env){globalThis.testUser=request.headers.get('x-test-user');let p=new URL(request.url).pathname;if(p==='/market')return Response.json(await collectMarket());if(p==='/news')return Response.json(await collectNews());const route=p==='/workspace'?workspace:p==='/journal'?journal:history;return route[request.method](request)}};`;
const built=await esbuild.build({stdin:{contents:worker,resolveDir:process.cwd(),sourcefile:'test-worker.ts',loader:'ts'},bundle:true,write:false,platform:'neutral',format:'esm',target:'es2022',external:['cloudflare:workers'],plugins:[{name:'test-identity',setup(build){build.onResolve({filter:/chatgpt-auth$/},()=>({path:'test-identity',namespace:'identity'}));build.onLoad({filter:/.*/,namespace:'identity'},()=>({contents:'export async function getChatGPTUser(){return globalThis.testUser?{userId:globalThis.testUser,email:"test@example.test"}:null}',loader:'js'}));}}]});
const mock=createFetchMock();mock.disableNetConnect();
const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',cf:false,d1Databases:['DB'],fetchMock:mock,script:built.outputFiles[0].text});
const db=await mf.getD1Database('DB');for(const sql of migration)await db.prepare(sql).run();
async function req(path,method='GET',body,user='owner-a',origin='http://localhost'){const response=await mf.dispatchFetch('http://localhost'+path,{method,headers:{...(user?{'x-test-user':user}:{}),...(method!=='GET'?{'Origin':origin,'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};}
const base={saved:[],notes:{},digest:true,urgent:false,instruments:[]};
try{
 await test('server state migration preserves notes; duplicate retries and stale revisions are safe',async()=>{
  assert.equal((await req('/workspace','GET',undefined,null)).status,401);
  assert.equal((await req('/workspace','POST',{},'owner-a','https://evil.test')).status,403);
  const before=await req('/workspace');assert.equal(before.data.revision,0);
  const requestId=crypto.randomUUID(),body={requestId,expectedRevision:0,operation:'import',data:{...base,saved:['lmt'],notes:{lmt:'Imported thesis, original date unknown'}}};
  const imported=await req('/workspace','POST',body);assert.equal(imported.status,200);assert.equal(imported.data.revision,1);
  const duplicate=await req('/workspace','POST',body);assert.equal(duplicate.data.revision,1);
  assert.equal((await req('/workspace','POST',{...body,requestId:crypto.randomUUID(),operation:'save'})).status,409);
  const other=await req('/workspace','GET',undefined,'owner-b');assert.equal(other.data.revision,0);
  assert.equal((await req('/workspace')).data.data.notes.lmt,body.data.notes.lmt);
  await assert.rejects(()=>db.prepare('DELETE FROM workspace_revision').run(),/immutable/);
 });
 await test('journal rejects incomplete forecasts and records valid entries once',async()=>{
  const body={requestId:crypto.randomUUID(),kind:'prediction',entity:'Test company',statement:'Revenue will grow above five percent in the next report.',counterEvidence:'Demand declines and orders are cancelled.',references:'User-entered test evidence',disposition:'wait',probability:null,resolvesAt:null,resolutionRule:''};
  assert.equal((await req('/journal','POST',body)).status,400);
  body.probability=0.7;body.resolvesAt=new Date(Date.now()+86400000).toISOString();body.resolutionRule='Revenue growth exceeds 5% in the annual report';
  assert.equal((await req('/journal','POST',body)).status,200);assert.equal((await req('/journal','POST',body)).status,200);
  assert.equal((await req('/journal')).data.entries.filter(e=>e.kind==='prediction').length,1);
  assert.equal((await req('/journal','GET',undefined,'owner-b')).data.entries.length,0);
  assert.equal((await req('/journal','POST',{kind:'resolution',requestId:crypto.randomUUID(),resolves_id:body.requestId,outcome:1,evidence:'Premature resolution should be refused.',resolution_source_url:'https://example.com/evidence'})).status,400);
  await assert.rejects(()=>db.prepare("UPDATE signal_log SET probability=1 WHERE id=?").bind(body.requestId).run(),/immutable/);
 });
 await test('past predictions resolve once with evidence; original record stays unchanged',async()=>{
  const id=crypto.randomUUID(),past=new Date(Date.now()-86400000).toISOString();
  await db.prepare('INSERT INTO signal_log(id,owner,created_at,kind,entity,body,probability,resolves_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,'owner-a',past,'prediction','Test company',JSON.stringify({statement:'A fixture prediction',resolutionRule:'Fixture fact is true'}),0.7,past).run();
  const body={kind:'resolution',requestId:crypto.randomUUID(),resolves_id:id,outcome:1,evidence:'Evidence: the dated fixture report confirms the original outcome.',resolution_source_url:'https://example.com/evidence'};
  assert.equal((await req('/journal','POST',body,'owner-b')).status,404);
  assert.equal((await req('/journal','POST',body)).status,200);
  assert.equal((await req('/journal','POST',{...body,outcome:0})).status,409);
  const recorded=(await req('/journal')).data.entries.find(e=>e.id===id);assert.equal(recorded.probability,0.7);assert.equal(recorded.outcome,1);
  await assert.rejects(()=>db.prepare('DELETE FROM resolution_record WHERE signal_id=?').bind(id).run(),/immutable/);
 });
 let beforeCapture;
 await test('raw capture and point-in-time history exclude information learned later',async()=>{
  beforeCapture=new Date().toISOString();await new Promise(r=>setTimeout(r,20));
  for(const s of ['BTC','ETH'])mock.get('https://api.coinbase.com').intercept({path:`/v2/prices/${s}-USD/spot`}).reply(200,JSON.stringify({data:{base:s,amount:'123.45',currency:'USD'}}));
  const r=await req('/market');assert.equal(r.data.quotes.length,2);assert.ok(r.data.quotes.every(q=>q.rawEventId&&!q.stale));
  const past=await req('/history?asOf='+encodeURIComponent(beforeCapture));assert.equal(past.data.quotes.length,0);
  const current=await req('/history');assert.equal(current.data.quotes.length,2);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM raw_event').first()).n,2);
  await assert.rejects(()=>db.prepare('DELETE FROM raw_event').run(),/immutable/);
 });
 await test('upstream failures preserve stale values and three failed runs open the circuit',async()=>{
  for(let n=0;n<3;n++){
   await db.prepare("UPDATE source_state SET checked_at=NULL,retry_at=NULL WHERE source LIKE 'coinbase:%'").run();
   for(const s of ['BTC','ETH'])mock.get('https://api.coinbase.com').intercept({path:`/v2/prices/${s}-USD/spot`}).reply(403,'blocked');
   const r=await req('/market');assert.equal(r.data.quotes.length,2);assert.ok(r.data.quotes.every(q=>q.stale&&q.amount===123.45));
  }
  const last=await req('/market');assert.ok(last.data.sources.every(s=>s.status==='degraded'&&s.retryAt));
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM signal_log WHERE kind='feed_health'").first()).n,2);
  const history=await req('/history');assert.equal(history.data.health.length,2);
 });
 await test('503 is retried before success and duplicate content has one raw capture',async()=>{
  await db.prepare("UPDATE source_state SET checked_at=NULL,retry_at=NULL WHERE source LIKE 'coinbase:%'").run();
  for(const s of ['BTC','ETH']){
   mock.get('https://api.coinbase.com').intercept({path:`/v2/prices/${s}-USD/spot`}).reply(503,'temporary');
   mock.get('https://api.coinbase.com').intercept({path:`/v2/prices/${s}-USD/spot`}).reply(200,JSON.stringify({data:{base:s,amount:'123.45',currency:'USD'}}));
  }
  const r=await req('/market');assert.ok(r.data.quotes.every(q=>!q.stale));assert.equal((await db.prepare('SELECT COUNT(*) n FROM raw_event').first()).n,2);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM collector_run WHERE status='available' AND attempts=2").first()).n,2);
 });
}finally{await mf.dispose()}
