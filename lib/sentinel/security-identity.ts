export function classifySecurity(asset:any,symbol:string,tickers:unknown){
 const deny=(reason:string)=>({status:'unverified' as const,reason});
 if(!asset||asset.symbol!==symbol||asset.class!=='us_equity'||asset.status!=='active'||typeof asset.name!=='string')return deny('The provider did not identify an active US equity for this exact symbol.');
 if(!Array.isArray(tickers)||tickers.length!==1||typeof tickers[0]!=='string'||tickers[0].toUpperCase()!==symbol)return deny('The SEC record does not contain exactly one matching listed symbol.');
 if(!/\bcommon stock\b/i.test(asset.name)||/\b(american depositary|american depository|depositary|depository|adr|ads|warrant|unit|preferred|trust|fund|class [a-z])\b/i.test(asset.name))return deny('Security name or share class needs human verification.');
 return {status:'candidate_common' as const,name:asset.name,symbol,exchange:typeof asset.exchange==='string'?asset.exchange:'unknown',reason:'Provider identifies common stock and the SEC record has one ticker; share basis and corporate actions still need independent confirmation.'};
}
