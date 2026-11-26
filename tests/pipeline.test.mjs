import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const b=await esbuild.build({entryPoints:['lib/sentinel/pipeline.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const M=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const {STAGES,parseStages,statusOf,runStage,skippedRecord,summarise}=M;

test('no stages argument means every stage in the original order; a subset keeps that fixed order',()=>{
 assert.deepEqual(parseStages(undefined).stages,[...STAGES]);
 assert.deepEqual(parseStages(['outcomes','assessment']).stages,['assessment','outcomes'],'a stage never runs before the one it reads from');
 assert.deepEqual(parseStages(['assessment','assessment']).stages,['assessment'],'duplicates collapse');
});

test('bad stage arguments are rejected, never guessed',()=>{
 for(const bad of [[],'assessment',['trade'],[1],{}])assert.ok('error' in parseStages(bad),JSON.stringify(bad));
});

test('an unrecognised result shape is a failure, not a pass',()=>{
 assert.equal(statusOf('discovery',null),'failed');
 assert.equal(statusOf('discovery',{}),'failed');
 assert.equal(statusOf('assessment',{status:'something-new'}),'failed');
 assert.equal(statusOf('practice',{date:'2026-11-13'}),'complete','the Practice mark returns a dated record');
 assert.equal(statusOf('practice',{}),'failed');
});

test('stage results map onto complete / partial / idle / failed',()=>{
 assert.equal(statusOf('discovery',{status:'partial'}),'partial','a partial discovery window is partial, not complete');
 assert.equal(statusOf('discovery',{status:'complete'}),'complete');
 assert.equal(statusOf('assessment',{status:'idle'}),'idle');
 assert.equal(statusOf('experiment',{status:'not_started'}),'idle');
 assert.equal(statusOf('outcomes',{status:'failed',message:'x'}),'failed');
 assert.equal(statusOf('filings',{results:[]}),'idle');
 assert.equal(statusOf('filings',{results:[{status:'success'},{status:'success'}]}),'complete');
 assert.equal(statusOf('filings',{results:[{status:'success'},{status:'failed'}]}),'partial');
 assert.equal(statusOf('filings',{results:[{status:'failed'}]}),'failed');
 assert.equal(statusOf('filings',{results:[{status:'success'}],deferred:2}),'partial','companies left for the next run are not complete');
 assert.equal(statusOf('news',{results:[{status:'failed'},{status:'failed'}]}),'failed');
});

test('a throwing stage becomes a failed record with its time, and the caller can carry on',async()=>{
 let t=1000;const clock=()=>t;
 const ok=await runStage('assessment',async()=>{t+=1200;return {status:'complete'}},clock);
 assert.deepEqual([ok.record.status,ok.record.elapsedMs],['complete',1200]);
 const bad=await runStage('outcomes',async()=>{t+=300;throw new Error('provider timeout')},clock);
 assert.deepEqual([bad.record.status,bad.record.elapsedMs,bad.record.message],['failed',300,'provider timeout']);
 assert.equal(bad.result.status,'failed');
 const long=await runStage('news',async()=>{throw new Error('x'.repeat(500))},clock);
 assert.equal(long.record.message.length,200,'messages are bounded');
});

test('one failed stage means the run is never complete; skipped stages are not failures',()=>{
 const rec=(stage,status)=>({stage,status,elapsedMs:1});
 assert.equal(summarise([rec('filings','complete'),rec('news','complete')]).status,'complete');
 assert.equal(summarise([rec('filings','complete'),rec('discovery','partial')]).status,'partial');
 const mixed=summarise([rec('filings','complete'),rec('assessment','failed'),rec('outcomes','complete')]);
 assert.equal(mixed.status,'partial');assert.deepEqual(mixed.failed,['assessment']);
 assert.equal(summarise([rec('assessment','failed')]).status,'failed');
 assert.equal(summarise([rec('assessment','failed'),skippedRecord('filings')]).status,'failed','a skipped stage does not dilute a failure');
 assert.equal(summarise([rec('assessment','idle'),skippedRecord('news')]).status,'idle');
 const s=summarise([skippedRecord('news'),rec('assessment','complete')]);assert.deepEqual(s.skipped,['news']);assert.equal(s.status,'complete');
});

test('busy (assessment lease held elsewhere) is neither a failure nor work done',async()=>{
 assert.equal(statusOf('assessment',{status:'busy'}),'busy');
 const s=summarise([{stage:'filings',status:'complete',elapsedMs:1},{stage:'assessment',status:'busy',elapsedMs:1}]);
 assert.deepEqual(s.failed,[]);assert.deepEqual(s.busy,['assessment']);assert.equal(s.status,'complete');
 assert.equal(summarise([{stage:'assessment',status:'busy',elapsedMs:1}]).status,'idle','a busy-only call did nothing and is not an error');
});

test('last success per step: latest run, latest complete-or-idle, latest failure; steps never seen say so',async()=>{
 const {lastPerStage}=M;
 const rows=[{stage:'assessment',status:'complete',at:'2026-11-26T10:00:00Z'},{stage:'assessment',status:'busy',at:'2026-11-26T10:15:00Z'},{stage:'assessment',status:'failed',at:'2026-11-26T09:00:00Z',message:'x'},
  {stage:'news',status:'failed',at:'2026-11-26T10:00:00Z',message:'News source unavailable'},{stage:'nonsense',status:'complete',at:'2026-11-26T11:00:00Z'}];
 const by=Object.fromEntries(lastPerStage(rows).map(r=>[r.stage,r]));
 assert.deepEqual(Object.keys(by),[...STAGES]);
 assert.equal(by.assessment.lastRun.status,'busy');assert.equal(by.assessment.lastSuccess.at,'2026-11-26T10:00:00Z');assert.equal(by.assessment.lastFailure.at,'2026-11-26T09:00:00Z');
 assert.equal(by.news.lastSuccess,null);assert.equal(by.news.lastFailure.message,'News source unavailable');
 assert.equal(by.outcomes.lastRun,null);assert.match(by.outcomes.note,/No record/);
});

test('Alpaca backoff schedule: 60 s, doubling, capped at 15 minutes',async()=>{
 const b2=await esbuild.build({stdin:{contents:"export {backoffMs,ALPACA_BACKOFF} from './lib/sentinel/alpaca-backoff';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'no-db',setup(x){x.onResolve({filter:/db\/store$/},()=>({path:'db',namespace:'stub'}));x.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const database=()=>{throw new Error("no database in this test")};',loader:'js'}))}}]}); // the schedule is pure; the database layer is not loaded
 const {backoffMs}=await import('data:text/javascript;base64,'+Buffer.from(b2.outputFiles[0].text).toString('base64'));
 assert.deepEqual([1,2,3,4,5,6,10].map(n=>backoffMs(n)/1000),[60,120,240,480,900,900,900]);
});
