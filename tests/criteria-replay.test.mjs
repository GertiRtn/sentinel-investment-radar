import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const b=await esbuild.build({entryPoints:['lib/sentinel/criteria.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},plugins:[{name:'stubs',setup(build){
 build.onResolve({filter:/db\/store$|\.\/edgar$|\.\/api$/},a=>({path:a.path,namespace:'stub'}));
 build.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const database=()=>{throw new Error("not used")};export const iso=()=>new Date().toISOString();export class ApiError extends Error{};export const companyFile=()=>{throw new Error("not used")};',loader:'js'}));
}}]});
const {compareReplay,evaluate}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));

const fig=(end,val,known='2024-03-01T00:00:00.000Z')=>({metric:'cash_conversion',value:val,unit:'ratio',period_end:end,known_from:known,inputs:[{id:'f-'+end,known_from:known,accession:'acc-'+end}],method:'computed',confidence:'computed',reason:'fixture'});
const predicate={all:[{metric:'cash_conversion',op:'<',value:.7,consecutive_periods:2}]};
const asOf='2025-01-01T00:00:00.000Z';

test('identical inputs recompute to a matching replay',()=>{
 const figures=[fig('2023-12-31',.5),fig('2022-12-31',.5)];
 const r=compareReplay(evaluate(predicate,figures,[],asOf),evaluate(predicate,figures,[],asOf),'earlier-id');
 assert.deepEqual(r,{evaluationId:'earlier-id',matches:true,earlierResult:'trip',differences:[]});
});

test('a moment evaluated before a backfill differs once the missing year is captured',()=>{
 // Before backfill: only one annual period known, so a two-period streak is unknown.
 const before=evaluate(predicate,[fig('2023-12-31',.5)],[],asOf);
 // After backfill: the 2022 figure (filed before asOf) is now captured too.
 const after=evaluate(predicate,[fig('2023-12-31',.5),fig('2022-12-31',.5)],[],asOf);
 assert.equal(before.result,'unknown');assert.equal(after.result,'trip');
 const r=compareReplay(before,after,'earlier-id');
 assert.equal(r.matches,false);assert.equal(r.earlierResult,'unknown');
 assert.match(r.differences[0],/unknown to trip/);
});

test('a changed input set is a difference even when the result is the same',()=>{
 const a=evaluate(predicate,[fig('2023-12-31',.5),fig('2022-12-31',.5)],[],asOf);
 const b2=evaluate(predicate,[fig('2023-12-31',.4),fig('2022-12-31',.5)],[],asOf);
 assert.equal(a.result,b2.result);
 assert.equal(compareReplay(a,b2,'x').matches,false);
});
