import {screenLabel} from './screen-label';
export function buildInvestmentDashboard(rows:{id:string;created_at:string;body:string}[],asOf:string){
 const now=Date.parse(asOf),seen=new Set<string>(),out:any[]=[];
 for(const row of rows){let c:any;try{c=JSON.parse(row.body)}catch{continue}if(!c.identity?.name||!c.symbol||seen.has(c.symbol))continue;seen.add(c.symbol);
 const get=(label:string)=>{const e=c.brief?.evidence?.find((x:any)=>x.label===label);const t=Date.parse((e?.periodEnd||'')+'T23:59:59.999Z');if(!e?.rawEventId||!Number.isFinite(e.value)||!Number.isFinite(t)||t>now||now-t>550*86400000)return null;return {value:e.value,change:Number.isFinite(e.changePercent)?e.changePercent:null,unit:e.unit,period:e.periodEnd,accession:e.accession||null}};
 const revenue=get('Revenue'),income=get('Net income'),cash=get('Operating cash flow');const qt=Date.parse(c.brief?.quote?.sourceTime||'');const quoteFresh=Number.isFinite(qt)&&qt<=now&&now-qt<=300000&&!c.brief?.quote?.wideSpread&&!c.brief?.quote?.stale;const p=c.price;const pe=quoteFresh&&p?.status==='indicative'&&Number.isFinite(p.ratio)&&p.quoteTime===c.brief?.quote?.sourceTime?p.ratio:null;
 out.push({id:row.id,symbol:c.symbol,name:c.identity.name,cik:c.identity.cik,assessedAt:c.createdAt||row.created_at,conclusion:screenLabel(c),revenue,income,cash,pe,quoteTime:c.brief?.quote?.sourceTime||null,quoteFresh,source:c.event?.url||null,headline:c.event?.headline||null,blockers:c.decision?.blockers||[],shareBasis:c.security?.status||'unverified'});
 }return out;
}
