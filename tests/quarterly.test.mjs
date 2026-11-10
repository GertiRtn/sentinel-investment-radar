import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const bundle=await esbuild.build({entryPoints:['lib/sentinel/financial.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {quarterlyFigures}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const fact=(changes={})=>({id:'one',entity_id:'sec:1',metric:'revenue',source_tag:'Revenues',value:100,unit:'USD',period_start:'2024-04-01',period_end:'2024-06-30',fiscal_year:2024,fiscal_period:'Q2',form:'10-Q',known_from:'2024-08-01T23:59:59.999Z',filed:'2024-08-01',accession:'0000000001-24-000001',raw_event_id:'capture',recorded_at:'2024-08-02T00:00:00.000Z',...changes});
test('quarterly output rejects annual, YTD and instant values and respects both clocks',()=>{
 const rows=[fact(),fact({id:'ytd',period_start:'2024-01-01',value:200}),fact({id:'instant',period_start:'',value:300}),fact({id:'annual',period_start:'2023-07-01',value:400})];
 assert.equal(quarterlyFigures(rows,'2024-08-01T23:59:59.998Z').length,0);
 assert.equal(quarterlyFigures(rows,'2024-08-03T00:00:00.000Z','2024-08-01T00:00:00.000Z').length,0);
 const result=quarterlyFigures(rows,'2024-08-03T00:00:00.000Z');assert.equal(result.length,1);assert.equal(result[0].value,100);assert.equal(result[0].inputs[0].raw_event_id,'capture');
});
test('later restatement only applies after its filing date',()=>{
 const revised=fact({id:'two',value:110,known_from:'2024-09-01T23:59:59.999Z',accession:'0000000001-24-000002'});
 assert.equal(quarterlyFigures([fact(),revised],'2024-08-15T00:00:00.000Z')[0].value,100);
 assert.equal(quarterlyFigures([fact(),revised],'2024-09-02T00:00:00.000Z')[0].value,110);
});
