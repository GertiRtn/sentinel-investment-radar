import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const b=await esbuild.build({entryPoints:['lib/sentinel/research-assessment.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {assessReportedResults}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const row={label:'Revenue',changePercent:2.7,accession:'current',rawEventId:'raw-current',previous:{accession:'previous',rawEventId:'raw-previous'}};
test('reported change has sourced explanation and counterpoint without forecasting',()=>{const [p]=assessReportedResults([row]);assert.match(p.observation,/rose 2.7%/);assert.match(p.meaning,/sales/);assert.match(p.counterpoint,/margins/);assert.equal(p.previousRawEventId,'raw-previous');});
test('declines, zero precision and missing comparison are correctly represented',()=>{assert.match(assessReportedResults([{...row,changePercent:-46.3}])[0].observation,/fell 46.3%/);assert.match(assessReportedResults([{...row,changePercent:0.01}])[0].observation,/unchanged/);assert.deepEqual(assessReportedResults([{...row,previous:null}]),[]);assert.deepEqual(assessReportedResults([{...row,changePercent:null}]),[]);});
