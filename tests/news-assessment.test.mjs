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

test('v2 recognises cleaned company names and direct actions without promoting analyst or incidental mentions',()=>{
 for(const [headline,company] of [['HubSpot Reaffirms Q4 And FY26 Guidance','HubSpot, Inc.'],['SES AI Affirms FY2026 Sales Guidance','SES AI Corp'],['AIR Global Reports Q3 Results','AIR Global PLC'],["HubSpot's results improve",'HubSpot, Inc.'],['Costco reports quarterly results','Costco Wholesale Corp /DE/'],['Acme reports results','Acme Group Holdings N.V.']]){
  const result=assessCompanyRelevance(headline,company);assert.equal(result.level,'direct_candidate',headline);assert.equal(result.version,'headline-relevance-v3');
 }
 for(const [headline,company] of [['Bernstein Adjusts Its Costco Target','Costco Wholesale Corp'],['Unrelated company reports results','HubSpot, Inc.'],['Product launches at HubSpot stores','HubSpot, Inc.'],['Global reports results','Global Energy Holdings'],['American reports results','American Airlines Group Inc.']])assert.equal(assessCompanyRelevance(headline,company).level,'review',headline);
});
test('headline-relevance-v3: a company announcing its own results is a direct role despite hyphens, legal suffixes and exchange tags',()=>{
 const direct=[['Williams-Sonoma, Inc. Announces Third Quarter 2026 Earnings','WILLIAMS SONOMA INC'],['Acme Corp. (NYSE: ACM) Reports Q3 Results','ACME CORP'],['ODDITY Tech Raises FY2026 Sales Guidance','ODDITY Tech Ltd'],['Fixture Holdings, Inc. Announces Acquisition','Fixture Holdings Inc']];
 for(const [h,n] of direct){const r=assessCompanyRelevance(h,n);assert.equal(r.level,'direct_candidate',h);assert.equal(r.version,'headline-relevance-v3');}
 const unclear=[['Bernstein Adjusts Price Target and Rating on Mastercard','Mastercard Inc'],['Why Costco Wholesale stock fell','COSTCO WHOLESALE CORP'],['Williams Companies Reports Results','WILLIAMS SONOMA INC'],['Apple Store customers queue','Apple Inc.'],['ams-OSRAM Reports Q3 2026 Financial Results','AMERICAN SHARED HOSPITAL SERVICES']];
 for(const [h,n] of unclear)assert.equal(assessCompanyRelevance(h,n).level,'review',h);
});
