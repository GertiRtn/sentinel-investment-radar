import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));

// Pipeline stages are replaced by recorders; this tests routing, isolation and recording only.
const stubs={
 'cloudflare:workers':'export const env=new Proxy({},{get:(_,k)=>(globalThis.testEnv||{})[k]});',
 store:'export const iso=()=>new Date().toISOString();export function database(){return {prepare:sql=>({bind:(...a)=>({run:async()=>{globalThis.inserts.push({sql,a});return {meta:{changes:1}}}})})}}',
 pipeline:'export async function refreshWatchlistFilings(o,e){globalThis.calls.push("filings:"+o+":"+e);return [{status:"success"},{status:"failed"}]}export async function checkWatchlistNews(o){globalThis.calls.push("news:"+o);return {checked:1,results:[{status:"success",items:[{},{}]}]}}',
 'discovery-collector':'export async function collectDiscovery(o){globalThis.calls.push("discovery:"+o);if(globalThis.failDiscovery)throw new Error("feed down");return {status:"complete",window:{},pages:1,newCount:3}}',
 'discovery-case':'export async function assessDiscoveryBatch(o,e){globalThis.calls.push("assess:"+o);return {status:"complete",items:[{status:"complete",case:{conclusion:"WAIT"}},{status:"complete",case:{conclusion:"INVESTIGATE"}}]}}',
 'outcome-collector':'export async function observeOneOutcome(o){globalThis.calls.push("outcome");return globalThis.outcomesLeft-->0?{status:"observed"}:{status:"idle"}}',
};
const b=await esbuild.build({entryPoints:['lib/sentinel/scheduled.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'stubs',setup(build){
 build.onResolve({filter:/^cloudflare:workers$|db\/store$|\.\/pipeline$|discovery-collector$|discovery-case$|outcome-collector$/},a=>({path:a.path==='cloudflare:workers'?a.path:a.path.split('/').pop(),namespace:'stub'}));
 build.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'js'}));
}}]});
const {runScheduled,SCHEDULES}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const ENV={SENTINEL_HOST:'cloudflare',SENTINEL_OWNER_ID:'owner-1',SENTINEL_OWNER_EMAIL:'owner@example.test'};
const reset=(env=ENV)=>{globalThis.testEnv=env;globalThis.calls=[];globalThis.inserts=[];globalThis.failDiscovery=false;globalThis.outcomesLeft=0;};

test('cron strings match deploy/cloudflare/wrangler.jsonc',()=>{
 const text=readFileSync('deploy/cloudflare/wrangler.jsonc','utf8').replace(/^\s*\/\/.*$/gm,'');
 assert.deepEqual(JSON.parse(text).triggers.crons,Object.values(SCHEDULES));
});

test('never runs on the Sites host',async()=>{
 reset({...ENV,SENTINEL_HOST:undefined});
 assert.equal((await runScheduled(SCHEDULES.DISCOVERY)).status,'skipped');
 assert.equal(calls.length+inserts.length,0);
});

test('each schedule runs only its own stages, under the configured owner',async()=>{
 reset();await runScheduled(SCHEDULES.DISCOVERY);assert.deepEqual(calls,['discovery:owner-1','assess:owner-1']);
 reset();await runScheduled(SCHEDULES.WATCHLIST);assert.deepEqual(calls,['filings:owner-1:owner@example.test','news:owner-1']);
 reset({...ENV,SEC_CONTACT_EMAIL:'sec@example.test'});await runScheduled(SCHEDULES.WATCHLIST);assert.equal(calls[0],'filings:owner-1:sec@example.test');
});

test('a failing stage is recorded and does not stop the next one',async()=>{
 reset();globalThis.failDiscovery=true;
 const r=await runScheduled(SCHEDULES.DISCOVERY);
 assert.equal(r.status,'partial');
 assert.deepEqual(r.stages.map(s=>[s.name,s.status]),[['discovery','failed'],['assessment','complete']]);
 assert.equal(r.stages[0].summary.message,'feed down');
 assert.deepEqual(r.stages[1].summary.conclusions,{WAIT:1,INVESTIGATE:1});
 assert.equal(inserts.length,1);assert.match(inserts[0].sql,/INSERT INTO signal_log.*'scheduled_run'/);assert.equal(inserts[0].a[1],'owner-1');
});

test('outcome observations are batched but bounded',async()=>{
 reset();globalThis.outcomesLeft=3;
 let r=await runScheduled(SCHEDULES.OUTCOMES);assert.equal(r.stages[0].summary.attempts,3);
 reset();globalThis.outcomesLeft=1000;
 r=await runScheduled(SCHEDULES.OUTCOMES);assert.equal(r.stages[0].summary.attempts,10);
});

test('missing owner or contact email does nothing; unknown cron is flagged',async()=>{
 reset({...ENV,SENTINEL_OWNER_ID:''});assert.equal((await runScheduled(SCHEDULES.DISCOVERY)).status,'misconfigured');assert.equal(calls.length,0);
 reset({...ENV,SENTINEL_OWNER_EMAIL:'not-an-email'});let r=await runScheduled(SCHEDULES.WATCHLIST);assert.equal(r.status,'failed');assert.equal(calls.length,0);assert.equal(inserts.length,1);
 reset();r=await runScheduled('0 0 * * *');assert.equal(r.stages[0].name,'routing');assert.equal(calls.length,0);
});
