import type {CompanyNewsItem} from './company-news';
export type NewsAssessment={headlineId:string;topics:string[];whyReview:string[];questions:string[];classificationVersion:string};
export type CompanyRelevance={level:'direct_candidate'|'review';role:string;evidence:string|null;reason:string;version:string};
/** Headline-only routing. This is not entity resolution, fact verification or a materiality model. */
export function assessCompanyRelevance(headline:string,company:string):CompanyRelevance{
 const name=company.replace(/\s+(inc\.?|corp\.?|corporation|ltd\.?|plc)$/i,'').trim();
 const result=(level:CompanyRelevance['level'],role:string,evidence:string|null,reason:string):CompanyRelevance=>({level,role,evidence,reason,version:'headline-relevance-v1'});
 if(name.length<3)return result('review','unknown',null,'Company name is too ambiguous for automatic routing.');
 const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const match=new RegExp('\\b'+escaped+'\\b','i').exec(headline);
 if(!match)return result('review','unknown',null,'The company is not named in the headline; the provider ticker tag alone is insufficient.');
 const before=headline.slice(0,match.index),after=headline.slice(match.index+match[0].length);
 if(/\b(stores?|shop|customers?|devices?|users?)\b/i.test(after.slice(0,28)) && before.trim())return result('review','mentioned platform or distribution channel',match[0],'The company may be a distribution channel or context; its material exposure is unverified.');
 const directVerb='(?:reports?|reported|announces?|announced|raises?|raised|cuts?|cut|launches?|launched|acquires?|acquired|faces?|faced|sues?|sued|settles?|settled|beats?|misses?|plans?|recalls?|warns?|warned|files?|filed|wins?|loses?|partners?|is|was|to)';
 const directAfter=new RegExp('^\\s+(?:'+directVerb+')\\b','i');
 const affectedBefore=/\b(?:fines?|fined|sues?|sued|investigates?|investigated|charges?|charged|acquires?|acquired|targets?|targeted|orders?|ordered)\s+$/i;
 if(directAfter.test(after)||affectedBefore.test(before))return result('direct_candidate',affectedBefore.test(before)?'possible affected party':'possible event subject',match[0],'Headline wording suggests a direct company role; verify the original report and its materiality.');
 return result('review','mentioned company',match[0],'The company is mentioned, but its role and exposure are unclear from the headline.');
}
/** Conservative keyword routing for research questions, not a fact check or prediction. */
export function assessNews(item:CompanyNewsItem):NewsAssessment{
 const text=item.headline.toLowerCase();const rules=[
  {topic:'Earnings or financial results',match:/\b(earnings|quarterly results|financial results|revenue|guidance)\b/i,why:'Reported results or guidance may affect the outlook for sales, profitability or cash flow.',question:'Check the company release and compare the figures with prior expectations and any earlier guidance.'},
  {topic:'Regulation or legal matter',match:/\b(regulat(?:ion|ory|or|ors)|lawsuit|litigation|court|antitrust|tariff|sanctions)\b/i,why:'Legal or regulatory developments may affect costs, operations or access to markets.',question:'Verify the decision, its scope, timing, likelihood and direct exposure in primary sources.'},
  {topic:'Acquisition or transaction',match:/\b(acquisition|acquire[sd]?|merger|takeover)\b/i,why:'A transaction may affect the business mix, funding needs or future earnings.',question:'Check whether a transaction is proposed, agreed or completed, its price and financing.'},
  {topic:'Analyst opinion',match:/\b(analyst|price target|upgrade[sd]?|downgrade[sd]?)\b/i,why:'An analyst change can reflect revised expectations but is an opinion rather than a company result.',question:'Check the analyst’s reasoning, assumptions and when the opinion was published.'}
 ];const matched=rules.filter(r=>r.match.test(text));return {headlineId:item.id,topics:matched.map(r=>r.topic),whyReview:matched.map(r=>r.why),questions:[...matched.map(r=>r.question),'Verify the original report and whether it concerns this company; a ticker tag alone does not establish the claim.','Check what the market already expected and the price response before assessing investment relevance.'],classificationVersion:'headline-routing-v1'};
}
