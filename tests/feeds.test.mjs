import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRSS,parseQuote,fetchNews,fetchMarket,NEWS_SOURCES} from '../lib/sentinel/feeds.ts';
const source=NEWS_SOURCES[0];const now='2026-09-15T12:00:00Z';
const item=(link,date='Tue, 15 Sep 2026 10:00:00 GMT',title='Interest rate decision')=>`<item><title><![CDATA[${title}]]></title><link>${link}</link><pubDate>${date}</pubDate></item>`;
test('source links are constrained, duplicates removed, titles cleaned, dates preserved',()=>{
 const xml=`<rss><channel>${item('https://www.ecb.europa.eu/press/test')}${item('https://www.ecb.europa.eu/press/test')}${item('javascript:alert(1)')}${item('https://evil.example/phish')}</channel></rss>`;
 const rows=parseRSS(xml,source,now);assert.equal(rows.length,1);assert.equal(rows[0].publishedAt,'2026-09-15T10:00:00.000Z');assert.equal(rows[0].analysisType,'topic-context');assert.equal(rows[0].topic,'Rates & inflation');
});
test('missing and future dates are not assigned retrieval time as publication time',()=>{
 for(const date of ['', 'Tue, 15 Sep 2036 10:00:00 GMT'])assert.equal(parseRSS(`<rss>${item('https://www.ecb.europa.eu/test',date)}</rss>`,source,now)[0].publishedAt,null);
});
test('HTML error pages and entity expansion are rejected',()=>{
 assert.throws(()=>parseRSS('<html>Forbidden</html>',source,now));assert.throws(()=>parseRSS('<!DOCTYPE foo><rss/>',source,now));
});
test('prices reject bad amounts, wrong currency and mismatched assets',()=>{
 for(const data of [{amount:'NaN',currency:'USD'},{amount:'-2',currency:'USD'},{amount:'1',currency:'EUR'},{amount:'0',currency:'USD'},{amount:'12',currency:'USD',base:'ETH'}])assert.throws(()=>parseQuote({data},'BTC','Bitcoin',now));
 assert.equal(parseQuote({data:{amount:'123.45',currency:'USD'}},'BTC','Bitcoin',now).sourceTimestamp,null);
});
test('one broken news source does not hide the other or invent news',async()=>{
 const fetcher=(async (url)=>String(url).includes('ecb.europa.eu')?new Response(`<rss>${item('https://www.ecb.europa.eu/test')}</rss>`):new Response('Blocked',{status:403}));
 const result=await fetchNews(fetcher);assert.equal(result.items.length,1);assert.deepEqual(result.sources.map(s=>s.status),['available','unavailable']);
});
test('all broken sources return explicit failures and empty data',async()=>{
 const fetcher=(async()=>{throw new Error('timeout')});
 const n=await fetchNews(fetcher);const m=await fetchMarket(fetcher);assert.equal(n.items.length,0);assert.equal(m.quotes.length,0);assert.ok([...n.sources,...m.sources].every(s=>s.status==='unavailable'));
});
test('feed pool exceeds twelve and normalizes duplicate path separators',()=>{
 const xml='<rss>'+Array.from({length:20},(_,n)=>item('https://www.ecb.europa.eu//press/item'+n)).join('')+'</rss>';
 const rows=parseRSS(xml,source,now);assert.equal(rows.length,20);assert.ok(rows.every(r=>!new URL(r.url).pathname.includes('//')));
});
