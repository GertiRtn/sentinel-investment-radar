import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const {Miniflare,createFetchMock}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler/package.json')]}));
test('all four feed requests run in the actual Worker runtime; redirects fail closed',async()=>{
 const mock=createFetchMock();mock.disableNetConnect();
 mock.get('https://www.ecb.europa.eu').intercept({path:'/rss/press.html'}).reply(200,'<rss><channel><item><title>Policy update</title><link>https://www.ecb.europa.eu/press/test.html</link><pubDate>Tue, 15 Sep 2026 09:00:00 GMT</pubDate></item></channel></rss>');
 mock.get('https://www.federalreserve.gov').intercept({path:'/feeds/press_all.xml'}).reply(302,'',{headers:{location:'https://unexpected.example/feed'}});
 for(const s of ['BTC','ETH'])mock.get('https://api.coinbase.com').intercept({path:`/v2/prices/${s}-USD/spot`}).reply(200,JSON.stringify({data:{amount:'123.45',base:s,currency:'USD'}}));
 const script=ts.transpileModule(readFileSync('lib/sentinel/feeds.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',cf:false,fetchMock:mock,script:script+'\nexport default {async fetch(){return Response.json({news:await fetchNews(),market:await fetchMarket()})}};'});
 try{const response=await mf.dispatchFetch('http://localhost/');const data=await response.json();assert.equal(data.news.items.length,1);assert.equal(data.news.sources[0].status,'available');assert.equal(data.news.sources[1].status,'unavailable');assert.equal(data.market.quotes.length,2);assert.ok(data.market.sources.every(s=>s.status==='available'));mock.assertNoPendingInterceptors();}finally{await mf.dispose();}
});
