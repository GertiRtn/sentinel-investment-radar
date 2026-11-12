/**
 * Security identity (security-identity-v2, 2026-11-12).
 *
 * v1 required the provider's name to contain "Common Stock". Alpaca names most
 * NYSE-listed common shares without that phrase (e.g. "GE Vernova Inc."), so v1
 * rejected ordinary US companies. On the live Site, 70 of 152 cases failed on
 * the name alone, which blocked their P/E and kept the screen at WAIT.
 *
 * v2 accepts an active US equity whose exact symbol is the SEC record's only
 * ticker, unless the name signals a different instrument: depositary
 * receipts/shares, warrants, units, rights, preferred, funds, trusts, ETFs/ETNs,
 * notes, or a named share class. Everything else still fails closed. Share basis
 * and corporate actions still need independent confirmation, and the P/E still
 * requires a 10-K annual diluted EPS (foreign 20-F filers do not qualify).
 * Stored cases keep the v1 result they were assessed with.
 */
export const SECURITY_IDENTITY_VERSION = 'security-identity-v2';
const OTHER_INSTRUMENT = /\b(american depositary|american depository|depositary|depository|adrs?|ads|warrants?|units?|rights?|preferred|pfd|fund|trust|etf|etn|notes?|debentures?|bonds?|class [a-z]|series [a-z]|limited partner(ship)? interests?)\b/i;

export function classifySecurity(asset:any,symbol:string,tickers:unknown){
 const deny=(reason:string)=>({status:'unverified' as const,reason,version:SECURITY_IDENTITY_VERSION});
 if(!asset||asset.symbol!==symbol||asset.class!=='us_equity'||asset.status!=='active'||typeof asset.name!=='string'||!asset.name.trim())return deny('The provider did not identify an active US equity for this exact symbol.');
 if(!Array.isArray(tickers)||tickers.length!==1||typeof tickers[0]!=='string'||tickers[0].toUpperCase()!==symbol)return deny('The SEC record does not contain exactly one matching listed symbol.');
 if(OTHER_INSTRUMENT.test(asset.name))return deny('The security name suggests a depositary receipt, unit, warrant, preferred share, fund or share class; it needs human verification.');
 return {status:'candidate_common' as const,name:asset.name,symbol,exchange:typeof asset.exchange==='string'?asset.exchange:'unknown',version:SECURITY_IDENTITY_VERSION,reason:'Provider identifies an active US equity and the SEC record has one matching ticker; share basis and corporate actions still need independent confirmation.'};
}
