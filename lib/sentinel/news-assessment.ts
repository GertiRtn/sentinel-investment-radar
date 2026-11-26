import type {CompanyNewsItem} from './company-news';
export type NewsAssessment={headlineId:string;topics:string[];whyReview:string[];questions:string[];classificationVersion:string};
export type CompanyRelevance={level:'direct_candidate'|'review';role:string;evidence:string|null;reason:string;version:string;basis?:string;label?:string;analystOpinion?:boolean};
/**
 * Headline-only routing. This is not entity resolution, fact verification or a materiality model.
 * headline-relevance-v3 (2026-11-13): v2 missed the most common press-release form. In "Williams-Sonoma, Inc.
 * Announces Third Quarter 2026 Earnings" it matched only "Williams", then saw "-Sonoma, Inc." instead of a verb and
 * called the role unclear, so a company announcing its own results failed rule R2. v3 lets the words of the name be
 * joined by hyphens or punctuation, and skips a legal suffix and a "(NYSE: XYZ)" tag before looking for the verb.
 * Stored cases keep the result they were assessed with.
 */
/** The direct-role verbs (v3, unchanged in v4). */
const DIRECT_VERB='(?:reports?|reported|announces?|announced|raises?|raised|cuts?|cut|launches?|launched|acquires?|acquired|faces?|faced|sues?|sued|settles?|settled|beats?|misses?|plans?|recalls?|warns?|warned|files?|filed|wins?|loses?|partners?|is|was|to|reaffirms|affirms|reiterates|guides|posts|completes|signs|enters|receives|secures|agrees|prices|declares|appoints|expands|unveils|delivers|issues|narrows|lowers|boosts|tops|updates)';
export function assessCompanyRelevanceV3(headline:string,company:string):CompanyRelevance{
 const words=company.replace(/\/de\//gi,' ').replace(/\b([ns])\s*\.\s*([av])\s*\./gi,'$1$2').replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/);
 const suffixes=new Set(['inc','corp','corporation','co','company','ltd','limited','plc','holdings','holding','group','nv','sa','ag','se']);
 while(words.length && suffixes.has(words[words.length-1].toLowerCase()))words.pop();
 const name=words.join(' ');
 const result=(level:CompanyRelevance['level'],role:string,evidence:string|null,reason:string):CompanyRelevance=>({level,role,evidence,reason,version:'headline-relevance-v3'});
 if(name.length<3)return result('review','unknown',null,'Company name is too ambiguous for automatic routing.');
 const common=new Set(['american','general','united','first','national','international','global','digital','energy','capital']);
 const alias=words[0];const names=[name,...(alias.length>=4 && !common.has(alias.toLowerCase()) && alias!==name?[alias]:[])];
 const match=names.map(n=>new RegExp('\\b'+n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,"[\\s\\-.,&']+")+'\\b','i').exec(headline)).find(Boolean);
 if(!match)return result('review','unknown',null,'The company is not named in the headline; the provider ticker tag alone is insufficient.');
 const before=headline.slice(0,match.index),rawAfter=headline.slice(match.index+match[0].length);
 // Skip a legal suffix (", Inc.", " Corp.") and an exchange tag ("(NYSE: WSM)") that sit between the name and the verb.
 const after=rawAfter.replace(/^(?:[\s,.]*\b(?:incorporated|inc|corporation|corp|company|co|limited|ltd|plc|holdings?|group|llc|l\.?p|n\.?v|s\.?a|ag|se)\b\.?)*/i,'').replace(/^\s*\((?:NYSE|NASDAQ|AMEX|CBOE|OTC)[^)]{0,24}\)/i,'');
 if(/\b(stores?|shop|customers?|devices?|users?)\b/i.test(after.slice(0,28)) && before.trim())return result('review','mentioned platform or distribution channel',match[0],'The company may be a distribution channel or context; its material exposure is unverified.');
 const directVerb=DIRECT_VERB;
 const directAfter=new RegExp('^\\s+(?:'+directVerb+')\\b','i');
 const affectedBefore=/\b(?:fines?|fined|sues?|sued|investigates?|investigated|charges?|charged|acquires?|acquired|targets?|targeted|orders?|ordered)\s+$/i;
 if(directAfter.test(after)||affectedBefore.test(before)||(/^[’']s\b/i.test(rawAfter)&&!before.trim()))return result('direct_candidate',affectedBefore.test(before)?'possible affected party':'possible event subject',match[0],'Headline wording suggests a direct company role; verify the original report and its materiality.');
 return result('review','mentioned company',match[0],'The company is mentioned, but its role and exposure are unclear from the headline.');
}
/** Conservative keyword routing for research questions, not a fact check or prediction. */
export function assessNewsV1(item:CompanyNewsItem):NewsAssessment{
 const text=item.headline.toLowerCase();const rules=[
  {topic:'Earnings or financial results',match:/\b(earnings|quarterly results|financial results|revenue|guidance)\b/i,why:'Reported results or guidance may affect the outlook for sales, profitability or cash flow.',question:'Check the company release and compare the figures with prior expectations and any earlier guidance.'},
  {topic:'Regulation or legal matter',match:/\b(regulat(?:ion|ory|or|ors)|lawsuit|litigation|court|antitrust|tariff|sanctions)\b/i,why:'Legal or regulatory developments may affect costs, operations or access to markets.',question:'Verify the decision, its scope, timing, likelihood and direct exposure in primary sources.'},
  {topic:'Acquisition or transaction',match:/\b(acquisition|acquire[sd]?|merger|takeover)\b/i,why:'A transaction may affect the business mix, funding needs or future earnings.',question:'Check whether a transaction is proposed, agreed or completed, its price and financing.'},
  {topic:'Analyst opinion',match:/\b(analyst|price target|upgrade[sd]?|downgrade[sd]?)\b/i,why:'An analyst change can reflect revised expectations but is an opinion rather than a company result.',question:'Check the analyst’s reasoning, assumptions and when the opinion was published.'}
 ];const matched=rules.filter(r=>r.match.test(text));return {headlineId:item.id,topics:matched.map(r=>r.topic),whyReview:matched.map(r=>r.why),questions:[...matched.map(r=>r.question),'Verify the original report and whether it concerns this company; a ticker tag alone does not establish the claim.','Check what the market already expected and the price response before assessing investment relevance.'],classificationVersion:'headline-routing-v1'};
}

// ---------------------------------------------------------------------------------------------------------------
// Label rules v2 (2026-11-26, founder approval): headline-routing-v2, headline-relevance-v4. v1/v3 above are kept so
// stored labels can be read and compared; new cases use the functions below.

/**
 * Analyst opinion, checked FIRST by routing, news direction and role. Detection patterns only: these words are never
 * shown in the UI. Exceptions removed before matching: "analyst day", "investor day", and "analyst estimates /
 * expectations / forecasts / consensus" (a results comparison, not an opinion). "to Buy/Hold/Sell/Outperform/
 * Overweight" counts only as a rating: at the end of the headline, before punctuation, or before from, at, by, on,
 * after, amid, as, with or rating, so "to Hold Conference Call" and "to Buy Activision" are not ratings.
 */
const ANALYST_EXCEPTIONS=[/\b(?:analyst|investor) day\b/gi,/\banalyst(?:s|s'|'s|’s|s’)? (?:estimates?|expectations?|forecasts?|consensus)\b/gi];
const ANALYST_PATTERNS=[/\banalyst\b/i,/\bprice target/i,/\b(?:up|down)grades?\b/i,/\brating\b/i,/\binitiates coverage\b/i,
 /\bto (?:buy|hold|sell|outperform|overweight)\b(?=\s*$|\s*[,;:()\-–—]|\s+(?:from|at|by|on|after|amid|as|with|rating)\b)/i];
export function analystOpinion(headline:string|null|undefined){
 let t=String(headline??'');for(const re of ANALYST_EXCEPTIONS)t=t.replace(re,' ');
 return ANALYST_PATTERNS.some(re=>re.test(t));
}
export const ROUTING_VERSION='headline-routing-v2',RELEVANCE_VERSION='headline-relevance-v4';
const ROUTING_RULES=[
 {topic:'Earnings or financial results',match:/\b(earnings|quarterly results|financial results|revenue|guidance)\b/i,why:'Reported results or guidance may affect the outlook for sales, profitability or cash flow.',question:'Check the company release and compare the figures with prior expectations and any earlier guidance.'},
 {topic:'Regulation or legal matter',match:/\b(regulat(?:ion|ory|or|ors)|lawsuit|litigation|court|antitrust|tariff|sanctions)\b/i,why:'Legal or regulatory developments may affect costs, operations or access to markets.',question:'Verify the decision, its scope, timing, likelihood and direct exposure in primary sources.'},
 {topic:'Acquisition or transaction',match:/\b(acquisition|acquire[sd]?|merger|takeover)\b/i,why:'A transaction may affect the business mix, funding needs or future earnings.',question:'Check whether a transaction is proposed, agreed or completed, its price and financing.'},
];
const ANALYST_TOPIC={topic:'Analyst opinion',why:'An analyst change can reflect revised expectations but is an opinion rather than a company result.',question:'Check the analyst’s reasoning, assumptions and when the opinion was published.'};
const GENERIC_QUESTIONS=['Verify the original report and whether it concerns this company; a ticker tag alone does not establish the claim.','Check what the market already expected and the price response before assessing investment relevance.'];
/** headline-routing-v2: an analyst opinion is ONLY "Analyst opinion" (never a material topic, so it never passes R1). */
export function assessNews(item:CompanyNewsItem):NewsAssessment{
 const matched=analystOpinion(item.headline)?[ANALYST_TOPIC]:ROUTING_RULES.filter(r=>r.match.test(item.headline));
 return {headlineId:item.id,topics:matched.map(r=>r.topic),whyReview:matched.map(r=>r.why),questions:[...matched.map(r=>r.question),...GENERIC_QUESTIONS],classificationVersion:ROUTING_VERSION};
}

/** The SEC name cleaned as in v3 (punctuation, "/DE/", "N.V." and trailing legal suffixes removed), and its first word. */
export function cleanedName(company:string){
 const words=company.replace(/\/de\//gi,' ').replace(/\b([ns])\s*\.\s*([av])\s*\./gi,'$1$2').replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/).filter(Boolean);
 const suffixes=new Set(['inc','corp','corporation','co','company','ltd','limited','plc','holdings','holding','group','nv','sa','ag','se']);
 while(words.length && suffixes.has(words[words.length-1].toLowerCase()))words.pop();
 const common=new Set(['american','general','united','first','national','international','global','digital','energy','capital']);
 const name=words.join(' '),first=words[0]??'';
 return {name,alias:words.length>1&&first.length>=4&&!common.has(first.toLowerCase())?first:null};
}
const esc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const wordsRe=(n:string)=>new RegExp('\\b'+esc(n).replace(/\s+/g,"[\\s\\-.,&']+")+'\\b','i');
/** The full cleaned SEC name as whole words. */
export function fullNameIn(text:string,company:string){const {name}=cleanedName(company);if(name.length<3)return null;return wordsRe(name).exec(text);}
/** The ticker in a recognised form: "(AAPL)", "NASDAQ: AAPL" or "NYSE: AAPL". The ticker itself must be in capitals. */
export function tickerFormIn(text:string,symbol:string|null|undefined){
 const s=String(symbol??'').trim().toUpperCase();if(!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(s))return null;
 return new RegExp('\\(\\s*'+esc(s)+'\\s*\\)|\\b(?:[Nn][Aa][Ss][Dd][Aa][Qq]|[Nn][Yy][Ss][Ee])\\s*:\\s*'+esc(s)+'(?![A-Za-z0-9])').exec(text);
}
/** The first word of the name alone (v3's alias). In v2 this is only a partial match: never confirmed, never a role. */
export function aliasOnlyIn(text:string,company:string){const {alias}=cleanedName(company);return alias?wordsRe(alias).exec(text):null;}

/**
 * headline-relevance-v4. The role is read from the headline's wording only and is never verified here: every result
 * says so. The company must be named in full or by a recognised ticker form (a first word alone no longer counts).
 * An analyst opinion makes the company "mentioned", whatever the verbs. The verb rules are v3's, unchanged.
 */
export function assessCompanyRelevance(headline:string,company:string,symbol?:string|null):CompanyRelevance{
 const label='Role from headline wording: not verified';
 const result=(level:CompanyRelevance['level'],role:string,evidence:string|null,reason:string,analyst=false):CompanyRelevance=>({level,role,evidence,reason,version:RELEVANCE_VERSION,basis:'headline wording',label,analystOpinion:analyst});
 if(cleanedName(company).name.length<3&&!tickerFormIn(headline,symbol))return result('review','unknown',null,'Company name is too ambiguous for automatic routing.');
 const match=fullNameIn(headline,company)??tickerFormIn(headline,symbol);
 if(analystOpinion(headline))return result('review','mentioned company',match?match[0]:null,'The headline reports an analyst’s view, so the company is only mentioned, whatever the wording.',true);
 if(!match)return result('review','unknown',null,aliasOnlyIn(headline,company)?'Only part of the company name appears in the headline; it may be another company.':'The company is not named in the headline; the provider ticker tag alone is insufficient.');
 const before=headline.slice(0,match.index),rawAfter=headline.slice(match.index+match[0].length);
 const after=rawAfter.replace(/^(?:[\s,.]*\b(?:incorporated|inc|corporation|corp|company|co|limited|ltd|plc|holdings?|group|llc|l\.?p|n\.?v|s\.?a|ag|se)\b\.?)*/i,'').replace(/^\s*\((?:NYSE|NASDAQ|AMEX|CBOE|OTC)[^)]{0,24}\)/i,'');
 if(/\b(stores?|shop|customers?|devices?|users?)\b/i.test(after.slice(0,28)) && before.trim())return result('review','mentioned platform or distribution channel',match[0],'The company may be a distribution channel or context; its material exposure is unverified.');
 const directAfter=new RegExp('^\\s+(?:'+DIRECT_VERB+')\\b','i');
 const affectedBefore=/\b(?:fines?|fined|sues?|sued|investigates?|investigated|charges?|charged|acquires?|acquired|targets?|targeted|orders?|ordered)\s+$/i;
 if(directAfter.test(after)||affectedBefore.test(before)||(/^[’']s\b/i.test(rawAfter)&&!before.trim()))return result('direct_candidate',affectedBefore.test(before)?'possible affected party':'possible event subject',match[0],'Headline wording suggests a direct company role; verify the original report and its materiality.');
 return result('review','mentioned company',match[0],'The company is mentioned, but its role and exposure are unclear from the headline.');
}
