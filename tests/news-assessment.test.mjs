import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),esbuild=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));const b=await esbuild.build({entryPoints:['lib/sentinel/news-assessment.ts'],bundle:true,write:false,platform:'node',format:'esm'});const {assessNews,assessCompanyRelevance}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const make=headline=>({id:'1',headline,url:'https://example.test',source:'example',publishedAt:'2026-01-01',updatedAt:null});
test('earnings headline prompts verification and avoids predicting direction',()=>{const a=assessNews(make('Company reports lower earnings'));assert.deepEqual(a.topics,['Earnings or financial results']);assert.ok(a.questions.some(q=>q.includes('expectations')));assert.ok(!JSON.stringify(a).includes('buy'));});
test('analyst opinions and unknown topics remain distinct',()=>{assert.deepEqual(assessNews(make('Analyst upgrades company')).topics,['Analyst opinion']);assert.deepEqual(assessNews(make('Company announces a new programme')).topics,[]);});

test('company relevance distinguishes direct events from ticker-only and incidental mentions',()=>{
 const a=(h)=>assessCompanyRelevance(h,'Apple Inc.');
 assert.equal(a('EU regulator fines Apple in competition case').level,'direct_candidate');
 assert.equal(a('Apple reports quarterly results').level,'direct_candidate');
 assert.equal(a('Semiconductor Rally Defies Nvidia Scandal; Hot CPI; CoreWeave Earnings Ahead').level,'review');
 assert.equal(a('ShiftCam ProRig Filmmaker Kit Launches at Apple Stores').level,'review');
 assert.equal(a('Competitor challenges Apple over new product').level,'review');
 assert.equal(a('Apple sales beat expectations').level,'review');
});
