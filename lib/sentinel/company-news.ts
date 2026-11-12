export type CompanyNewsItem={id:string;headline:string;url:string;source:string;publishedAt:string;updatedAt:string|null};
export function parseCompanyNews(payload:any,symbol:string,asOf:string):CompanyNewsItem[]{
 if(!payload||!Array.isArray(payload.news))throw new Error('Invalid news response');
 const cutoff=Date.parse(asOf);if(!Number.isFinite(cutoff))throw new Error('Invalid capture time');
 const out:CompanyNewsItem[]=[];const seen=new Set<string>();
 for(const n of payload.news){if(!Array.isArray(n.symbols)||!n.symbols.includes(symbol)||typeof n.headline!=='string'||!n.headline.trim()||n.headline.length>500||typeof n.url!=='string'||typeof n.created_at!=='string')continue;
  let url:URL;try{url=new URL(n.url)}catch{continue}if(url.protocol!=='https:'||url.username||url.password)continue;
  const published=Date.parse(n.created_at),updated=n.updated_at?Date.parse(n.updated_at):null;if(!Number.isFinite(published)||published>cutoff||updated!==null&&(!Number.isFinite(updated)||updated>cutoff))continue;
  const id=String(n.id??url.href);if(seen.has(id))continue;seen.add(id);out.push({id,headline:n.headline.trim(),url:url.href,source:typeof n.source==='string'?n.source.slice(0,100):'Unknown provider',publishedAt:new Date(published).toISOString(),updatedAt:updated===null?null:new Date(updated).toISOString()});if(out.length>=10)break;
 }return out;
}
