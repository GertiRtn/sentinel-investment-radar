import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const b=await esbuild.build({entryPoints:['lib/sentinel/investment-readiness.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {investmentReadiness}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
test('a passed screen and positive facts do not become a buy recommendation',()=>{
 const k={conclusion:'INVESTIGATE',createdAt:'2026-11-13',price:{status:'indicative',ratio:20}};
 const ctx={business:[{label:'Revenue (year)',changePct:12.3,comparison:'prior year',latest:{period:{end:'2025-12-31'}}},{label:'Net income (year)',latest:{value:100,display:'$100',period:{end:'2025-12-31'}}}]};
 const v=investmentReadiness(k,ctx,{level:'named_in_headline'});
 assert.equal(v.status,'insufficient_for_recommendation');assert.match(v.financials[0],/12.3%/);assert.match(v.price,/20.0/);assert.match(v.price,/alone cannot/);assert.match(v.blockers.join(' '),/not yet demonstrated/);
});
test('missing price and likely wrong company never produce positive company figures',()=>{
 const v=investmentReadiness({price:{status:'unavailable'}},{business:[{label:'Revenue (year)',changePct:10,latest:{}}]},{level:'name_conflict'});
 assert.deepEqual(v.financials,[]);assert.match(v.event,/different company/);assert.match(v.price,/not recorded/);assert.equal(v.status,'insufficient_for_recommendation');
});
