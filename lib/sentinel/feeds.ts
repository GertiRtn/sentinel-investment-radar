export type FeedSource = {id:string;name:string;url:string;host:string};
export const NEWS_SOURCES:FeedSource[]=[
 {id:"ecb",name:"European Central Bank",url:"https://www.ecb.europa.eu/rss/press.html",host:"www.ecb.europa.eu"},
 {id:"fed",name:"Federal Reserve",url:"https://www.federalreserve.gov/feeds/press_all.xml",host:"www.federalreserve.gov"}
];
export type NewsItem={id:string;title:string;url:string;source:string;publishedAt:string|null;receivedAt:string;topic:string;context:string;watch:string;analysisType:"topic-context";rawEventId?:string;knownFrom?:string;stale?:boolean};
export type SourceStatus={name:string;status:"available"|"unavailable"|"degraded";checkedAt:string;message:string;lastGoodAt?:string|null;retryAt?:string|null;failures?:number;stale?:boolean};
export type NewsPayload={items:NewsItem[];sources:SourceStatus[];checkedAt:string;mode:"public-feeds"};
export type Quote={symbol:string;name:string;amount:number;currency:"USD";receivedAt:string;source:string;sourceTimestamp:null;rawEventId?:string;knownFrom?:string;stale?:boolean;reconciliation?:string};
export type MarketPayload={quotes:Quote[];sources:SourceStatus[];checkedAt:string};
export function cleanText(value:string):string{
 return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/<[^>]*>/g,"").replace(/&#(x[0-9a-f]+|\d+);/gi,(_,v)=>{const n=v[0].toLowerCase()==="x"?parseInt(v.slice(1),16):parseInt(v,10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):""}).replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,v)=>({amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" "} as Record<string,string>)[v]||"").replace(/\s+/g," ").trim();
}
export function topicContext(title:string){
 if(/interest rate|monetary policy|inflation|fomc|policy rate/i.test(title))return {topic:"Rates & inflation",context:"Interest-rate expectations can affect borrowing costs, company valuations, currencies and gold. The direction depends on the decision relative to expectations; the headline alone does not establish that.",watch:"Check the actual decision, previous guidance and market reaction. Relevant research: gold and interest-sensitive equities."};
 if(/crypto|bitcoin|digital asset|stablecoin/i.test(title))return {topic:"Digital assets",context:"Rules around digital assets can change access and operating costs. A consultation, proposal and enacted rule have different implications.",watch:"Confirm legal status, affected assets and effective dates. This is not a token safety assessment."};
 if(/supervis|bank|capital|financial stability|stress test/i.test(title))return {topic:"Banks & stability",context:"Bank supervision and capital requirements may influence lending and financial-sector risk. A routine release need not imply a market-wide problem.",watch:"Identify the institutions affected and whether requirements actually changed before drawing a conclusion."};
 if(/trade|tariff|geopolit|sanction/i.test(title))return {topic:"Trade & geopolitics",context:"Trade restrictions can affect costs, sales and supply chains differently across companies. A policy discussion is not evidence of implementation.",watch:"Find the operative policy document, affected countries and business exposure. No hidden motive is inferred."};
 return {topic:"Official update",context:"An official release is available. Its market relevance and any investment implication have not been established.",watch:"Read the original release to determine whether it changes policy, guidance or financial conditions."};
}
export function parseRSS(xml:string,source:FeedSource,receivedAt:string):NewsItem[]{
 if(xml.length>2_000_000||!/\<rss[\s>]/i.test(xml)||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error("Unsupported feed format");
 const rows=[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
 if(!rows.length)throw new Error("Feed contains no readable items");
 const seen=new Set<string>();const result:NewsItem[]=[];
 for(const [,body] of rows){
  const tag=(name:string)=>cleanText(body.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`,"i"))?.[1]||"");
  const title=tag("title").slice(0,350);const link=tag("link");if(!title||!link)continue;
  let url:URL;try{url=new URL(link);}catch{continue;}
  if(url.protocol!=="https:"||url.hostname!==source.host||url.username||url.password)continue;
  url.pathname=url.pathname.replace(/\/{2,}/g,"/");url.hash="";const id=source.id+":"+url.href;if(seen.has(id))continue;seen.add(id);
  const raw=tag("pubDate")||tag("dc:date");const date=raw?Date.parse(raw):NaN;
  // Future-dated or absent publication metadata must never be represented as fresh news.
  const publishedAt=Number.isFinite(date)&&date<=Date.parse(receivedAt)+300_000?new Date(date).toISOString():null;
  result.push({id,title,url:url.href,source:source.name,publishedAt,receivedAt,...topicContext(title),analysisType:"topic-context"});
 }
 if(!result.length)throw new Error("No valid source links");
 return result.sort((a,b)=>(Date.parse(b.publishedAt||"")||0)-(Date.parse(a.publishedAt||"")||0)).slice(0,100);
}
export function parseQuote(body:unknown,symbol:string,name:string,receivedAt:string):Quote{
 const d=(body as {data?:{amount?:unknown;currency?:unknown;base?:unknown}})?.data;
 if(!d||d.currency!=="USD"||(d.base!==undefined&&d.base!==symbol)||typeof d.amount!=="string"||!/^\d+(\.\d+)?$/.test(d.amount))throw new Error("Invalid price response");
 const amount=Number(d.amount);if(!Number.isFinite(amount)||amount<=0)throw new Error("Invalid price");
 return {symbol,name,amount,currency:"USD",receivedAt,source:"Coinbase spot reference",sourceTimestamp:null};
}
export async function readBody(response:Response):Promise<string>{
 if(!response.ok)throw new Error("Provider returned "+response.status);
 const reader=response.body?.getReader();if(!reader)throw new Error("Empty response");
 const decoder=new TextDecoder();let size=0,result="";
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000)throw new Error("Response too large");result+=decoder.decode(value,{stream:true});}return result+decoder.decode();}finally{await reader.cancel().catch(()=>{});}
}
export async function fetchNews(fetcher:typeof fetch=fetch):Promise<NewsPayload>{
 const checkedAt=new Date().toISOString();
 const results=await Promise.all(NEWS_SOURCES.map(async source=>{
 try{const response=await fetcher(source.url,{headers:{Accept:"application/rss+xml, application/xml, text/xml"},signal:AbortSignal.timeout(10_000),redirect:"manual"});
 const items=parseRSS(await readBody(response),source,new Date().toISOString());
 return {items,status:{name:source.name,status:"available" as const,checkedAt,message:`${items.length} official releases retrieved. Publication dates shown separately.`}};
 }catch(error){console.error("Sentinel news source failure",source.id,error instanceof Error?error.message.slice(0,250):"Unknown error");return {items:[],status:{name:source.name,status:"unavailable" as const,checkedAt,message:"The source could not be read. Coverage is incomplete; no sample news was substituted."}};}
 }));
 return {items:results.flatMap(r=>r.items).sort((a,b)=>(Date.parse(b.publishedAt||"")||0)-(Date.parse(a.publishedAt||"")||0)),sources:results.map(r=>r.status),checkedAt,mode:"public-feeds"};
}
export async function fetchMarket(fetcher:typeof fetch=fetch):Promise<MarketPayload>{
 const checkedAt=new Date().toISOString();
 const results=await Promise.all([["BTC","Bitcoin"],["ETH","Ethereum"]].map(async([symbol,name])=>{
 try{const response=await fetcher(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(10_000),redirect:"manual"});
 const quote=parseQuote(JSON.parse(await readBody(response)),symbol,name,new Date().toISOString());
 return {quote,status:{name:`Coinbase ${symbol}/USD`,status:"available" as const,checkedAt,message:"Indicative spot price. Provider trade timestamp not supplied."}};
 }catch(error){console.error("Sentinel quote source failure",symbol,error instanceof Error?error.message.slice(0,250):"Unknown error");return {quote:null,status:{name:`Coinbase ${symbol}/USD`,status:"unavailable" as const,checkedAt,message:"Quote unavailable. No estimated or sample price substituted."}};}
 }));
 return {quotes:results.flatMap(r=>r.quote?[r.quote]:[]),sources:results.map(r=>r.status),checkedAt};
}
