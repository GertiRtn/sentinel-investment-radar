/**
 * Deterministic paper-strategy planner. This module does not fetch data, persist
 * records or place orders. It must not be presented as an investment forecast.
 * A caller must supply a point-in-time snapshot and persist its decisions before
 * any simulated fills. Experiment rules are versioned, not retroactively edited.
 */
export const AUTO_PRACTICE_VERSION = 'auto-practice-plan-v1';
export const AUTO_POLICY = Object.freeze({startingCashCents: 1_000_000, positionCents: 100_000, maxPositions: 5, maxOpensPerRun: 2, holdDays: 30, maxCaseAgeDays: 7, maxQuoteAgeMinutes: 15, costBpsPerSide: 15});
const DAY = 86_400_000;
type Quote = { priceCents:number; at:string; rawEventId:string; source:string };
type Candidate = { caseId:string; symbol:string; assessedAt:string; publishedAt:string; firstObservedAt:string; screenVersion:string; conclusion:string; score:number|null };
type Position = { id:string; symbol:string; openedAt:string; quantityMicros:number };
type Input = { now:string; cashCents:number; candidates:Candidate[]; positions:Position[]; prices:Record<string,Quote|null>; seenCaseIds:string[] };
const instant = (s:unknown) => typeof s === 'string' ? Date.parse(s) : NaN;
function validQuote(q:Quote|null|undefined, now:number) {
 const at=instant(q?.at);
 return !!q && Number.isSafeInteger(q.priceCents) && q.priceCents>0 && !!q.rawEventId && !!q.source && Number.isFinite(at) && at<=now && now-at<=AUTO_POLICY.maxQuoteAgeMinutes*60_000;
}
/** Plans at most two opens and closes due positions first. No price -> skip, never invent a fill. */
export function planAutomatedPractice(input:Input) {
 const now=instant(input.now);
 if (!Number.isFinite(now) || !Number.isSafeInteger(input.cashCents) || input.cashCents<0) throw new Error('Invalid snapshot');
 const decisions:{action:'open'|'close'|'skip'; symbol:string; caseId?:string; positionId?:string; reason:string; amountCents?:number; price?:Quote; spy?:Quote; costCents?:number}[]=[];
 const spy=input.prices.SPY;
 // Cash and position slots are not recycled on a planned close. The persistence
 // layer must first confirm the close, then make a fresh plan from the new state.
 for (const p of [...input.positions].sort((a,b)=>a.id.localeCompare(b.id))) {
  const opened=instant(p.openedAt);
  if (!Number.isFinite(opened) || opened>now) { decisions.push({action:'skip',symbol:p.symbol,positionId:p.id,reason:'Invalid position time'}); continue; }
  if (now-opened < AUTO_POLICY.holdDays*DAY) continue;
  const quote=input.prices[p.symbol];
  if (!validQuote(quote,now)||!validQuote(spy,now)) { decisions.push({action:'skip',symbol:p.symbol,positionId:p.id,reason:'Fresh stock and SPY quotes required to close'}); continue; }
  const gross=Math.floor(p.quantityMicros*quote!.priceCents/1_000_000);
  if (!Number.isSafeInteger(p.quantityMicros)||p.quantityMicros<=0||!Number.isSafeInteger(gross)||gross<=0) { decisions.push({action:'skip',symbol:p.symbol,positionId:p.id,reason:'Invalid position quantity or value'}); continue; }
  decisions.push({action:'close',symbol:p.symbol,positionId:p.id,reason:'30 calendar-day holding period completed',price:quote!,spy:spy!,costCents:Math.ceil(gross*AUTO_POLICY.costBpsPerSide/10000)});
 }
 let cash=input.cashCents, slots=Math.max(0,AUTO_POLICY.maxPositions-input.positions.length), opened=0;
 const held=new Set(input.positions.map(p=>p.symbol)), seen=new Set(input.seenCaseIds);
 // Oldest assessed eligible cases first: a simple reproducible baseline, not an alpha score.
 const ordered=[...input.candidates].sort((a,b)=>a.assessedAt.localeCompare(b.assessedAt)||a.caseId.localeCompare(b.caseId));
 for(const c of ordered) {
  const assessed=instant(c.assessedAt), pub=instant(c.publishedAt), observed=instant(c.firstObservedAt);
  let reason='';
  if(!c.caseId||!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(c.symbol)) reason='Invalid case or symbol';
  else if(![assessed,pub,observed].every(Number.isFinite)||pub>observed||observed>assessed||assessed>now||now-assessed>AUTO_POLICY.maxCaseAgeDays*DAY) reason='Case timing missing, inconsistent or too old';
  else if(c.screenVersion!=='research-screen-v2'||c.conclusion!=='INVESTIGATE') reason='Does not meet the v2 research rules';
  else if(seen.has(c.caseId)) reason='Case already considered';
  else if(held.has(c.symbol)) reason='Symbol already open or selected';
  else if(opened>=AUTO_POLICY.maxOpensPerRun||slots<=0) reason='Position or per-run limit reached';
  else if(cash<AUTO_POLICY.positionCents) reason='Insufficient virtual cash';
  else if(!validQuote(input.prices[c.symbol],now)||!validQuote(spy,now)) reason='Fresh stock and SPY quotes required';
  if(reason) { decisions.push({action:'skip',symbol:c.symbol,caseId:c.caseId,reason}); continue; }
  const cost=Math.ceil(AUTO_POLICY.positionCents*AUTO_POLICY.costBpsPerSide/10000);
  if(Math.floor((AUTO_POLICY.positionCents-cost)*1_000_000/input.prices[c.symbol]!.priceCents)<1) {decisions.push({action:'skip',symbol:c.symbol,caseId:c.caseId,reason:'Position too small for quote precision'});continue;}
  decisions.push({action:'open',symbol:c.symbol,caseId:c.caseId,reason:'Meets v2 research rules; oldest eligible assessment first',amountCents:AUTO_POLICY.positionCents,price:input.prices[c.symbol]!,spy:spy!,costCents:cost});
  cash-=AUTO_POLICY.positionCents; slots--; opened++; held.add(c.symbol); seen.add(c.caseId);
 }
 return {version:AUTO_PRACTICE_VERSION,asOf:input.now,policy:AUTO_POLICY,decisions};
}
