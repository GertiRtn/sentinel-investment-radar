import {env} from 'cloudflare:workers';
import {database} from '@/db/store';
import {companyFile} from './edgar';
import {buildEvidencePack} from './evidence-pack';
import {whatChanged,priceContext} from './case-context';
import {archivedDailyBars as bars} from './daily-bars';
import {marketModel} from './market-model';
import {caseEvidenceScore} from './evidence-score';
import {caseEventMatch} from './event-match';
import {ideaCard,portfolioFit,type PortfolioFit} from './idea-card';
import {practiceState,type PracticeTrade} from './practice';
import {AUTO_POLICY} from './auto-practice';
import {buildThesis} from './thesis';

/** Shared by the case sheet (/api/case-context) and the idea list (/api/ideas): one stored case → context + idea card. Read-only. */
export type CaseRow={id:string;created_at:string;body:string};
export const parseCase=(row:CaseRow)=>{const body=JSON.parse(row.body);return {...body,id:row.id,createdAt:body.createdAt??row.created_at};};

/** The owner's virtual holdings (manual Practice at cost, and the experiment's open symbols). Loaded once per request. */
export async function holdings(owner:string){
 try{
  const rows=await database().prepare("SELECT kind,body FROM signal_log WHERE owner=? AND kind IN ('practice_trade','auto_practice_decision','auto_practice_close') ORDER BY created_at,id").bind(owner).all<{kind:string;body:string}>();
  const trades:PracticeTrade[]=[],autoOpen=new Map<string,string>();
  for(const r of rows.results){const b=JSON.parse(r.body);if(r.kind==='practice_trade')trades.push(b);else if(r.kind==='auto_practice_decision'&&b.kind==='open')autoOpen.set(b.positionId,b.symbol);else if(r.kind==='auto_practice_close')autoOpen.delete(b.positionId);}
  const st=practiceState({trades,reviews:[],marks:[],live:{},now:new Date().toISOString()});
  return {manual:{open:st.open.map(p=>({symbol:p.symbol,amountCents:p.amountCents})),cashCents:st.cashCents,startCents:st.startCents},autoOpenSymbols:[...autoOpen.values()]};
 }catch{return null}
}
const fitFor=(symbol:string,h:Awaited<ReturnType<typeof holdings>>):PortfolioFit=>portfolioFit({symbol,manual:h?.manual??null,autoOpenSymbols:h?.autoOpenSymbols??[],standardPositionCents:AUTO_POLICY.positionCents});

export async function caseIdea(owner:string,kase:any,held:Awaited<ReturnType<typeof holdings>>){
 const asOf=String(kase.createdAt);let figures:any[]=[],quarterly:any[]=[];const notes:string[]=[];
 if(kase.identity?.cik){try{const file=await companyFile('sec:'+kase.identity.cik,asOf,'recorded',owner);figures=file.figures;quarterly=file.quarterlyFigures;}catch{notes.push('SEC figures could not be loaded.');}}
 const pack=buildEvidencePack({caseId:kase.id,kase,figures,quarterlyFigures:quarterly,asOf,recordedBy:asOf});pack.missing.push(...notes);
 const context=whatChanged(pack,kase),score=caseEvidenceScore(kase),match=caseEventMatch(kase);
 // `thesis(price)` rebuilds the panel once the owner has asked for prices; the observations do not change.
 return {context,score,match,idea:ideaCard({kase,context,score,match,fit:fitFor(String(kase.symbol??''),held)}),thesis:(price?:any)=>buildThesis({kase,context,match,price})};
}

/** Daily closes around the event vs SPY. Fetched only when a person asks; archived and reused for 6 hours. */
export async function casePrice(kase:any){
 const symbol=String(kase.symbol||''),publishedAt=kase.event?.publishedAt??null;
 const fail=(reason:string)=>({status:'unavailable',reason,symbol,source:'Alpaca IEX daily bars'});
 if(!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol))return fail('The case has no usable ticker.');
 if(!publishedAt||!Number.isFinite(Date.parse(publishedAt)))return fail('The event has no valid publication time.');
 const creds=env as unknown as {ALPACA_DATA_KEY_ID?:string;ALPACA_DATA_SECRET?:string};
 if(!creds.ALPACA_DATA_KEY_ID||!creds.ALPACA_DATA_SECRET)return fail('Market data is not connected.');
 const day=86400000,start=new Date(Date.parse(publishedAt)-400*day).toISOString().slice(0,10),end=new Date(Math.min(Date.now(),Date.parse(publishedAt)+45*day)).toISOString().slice(0,10);
 try{
  const [stock,spy]=await Promise.all([bars(symbol,start,end,creds as any),bars('SPY',start,end,creds as any)]);
  const input={stock:stock.payload,spy:spy.payload,symbol,publishedAt,caseAt:String(kase.createdAt),fetchedAt:stock.fetchedAt<spy.fetchedAt?stock.fetchedAt:spy.fetchedAt,source:'Alpaca IEX daily bars',adjustment:'all',rawIds:[stock.rawId,spy.rawId]};
  // The market model reads the same archived bars; nothing is stored and no case or outcome changes.
  return {...priceContext(input),marketModel:marketModel(input)};
 }catch(e){return fail(e instanceof Error?e.message:'The price source could not be used.');}
}
