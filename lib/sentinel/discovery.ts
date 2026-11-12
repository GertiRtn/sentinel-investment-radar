import {assessNews} from './news-assessment';
/** Provider tags are leads, not verified entity matches or trading signals. */
export function parseDiscovery(payload:any,asOf:string){
 if(!payload||!Array.isArray(payload.news)||!(payload.next_page_token===null||typeof payload.next_page_token==='string'))throw new Error('Invalid discovery response');
 const cutoff=Date.parse(asOf);if(!Number.isFinite(cutoff))throw new Error('Invalid capture time');
 const out:any[]=[];
 for(const n of payload.news){
  if((typeof n.id!=='number'&&typeof n.id!=='string')||!Array.isArray(n.symbols)||typeof n.headline!=='string'||!n.headline.trim()||n.headline.length>500||typeof n.url!=='string')continue;
  let url:URL;try{url=new URL(n.url)}catch{continue}if(url.protocol!=='https:'||url.username||url.password)continue;
  const published=Date.parse(n.created_at),updated=Date.parse(n.updated_at);if(!Number.isFinite(published)||!Number.isFinite(updated)||published>cutoff||updated>cutoff)continue;
  const symbols=[...new Set<string>(n.symbols.filter((s:unknown):s is string=>typeof s==='string'&&/^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)))];if(!symbols.length)continue;
  const item={id:String(n.id),headline:n.headline.trim(),url:url.href,source:typeof n.source==='string'?n.source.slice(0,100):'Unknown',publishedAt:new Date(published).toISOString(),updatedAt:new Date(updated).toISOString()};
  const analysis=assessNews(item);const providerSummary=typeof n.summary==='string'?n.summary.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,1200)||null:null;out.push({...item,symbols,analysis,providerSummary,priority:analysis.topics.length?'topic match':'unclassified',conclusion:'INVESTIGATE',limitations:'Provider tags can indicate a mention, not necessarily a directly affected company. Event, asset identity, materiality, valuation and price reaction are unverified.'});
 }
 return {items:out,nextPageToken:payload.next_page_token as string|null};
}
