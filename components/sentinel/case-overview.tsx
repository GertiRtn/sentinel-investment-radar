"use client";
import { useState } from "react";
import { ArrowUpRight, ChevronRight, BarChart3, Newspaper, Sparkles } from "lucide-react";

type Tab = 'Overview' | 'Financials' | 'News';
const time = (x: string | null) => x && Number.isFinite(Date.parse(x)) ? new Date(x).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : 'Date unavailable';
function FinancialChart({ rows }: { rows: any[] }) {
  const [period,setPeriod] = useState<'year'|'quarter'>('year');
  const row = rows.find(r => r.label === `Revenue (${period})`);
  const values = [row?.prior, row?.latest];
  const chartable = row?.changePct != null && values.every(v => typeof v?.value === 'number' && Number.isFinite(v.value) && v.value >= 0) && Math.max(...values.map(v=>v.value)) > 0;
  const max = chartable ? Math.max(...values.map(v=>v.value)) : 1;
  return <section className="sentinel-finance"><div className="sentinel-section-title"><h3>Financial performance</h3><BarChart3 size={18}/></div><div className="sentinel-card">
    <div className="sentinel-segment" aria-label="Reporting period">{(['year','quarter'] as const).map(x=><button key={x} aria-pressed={period===x} onClick={()=>setPeriod(x)}>{x==='year'?'Annual':'Quarterly'}</button>)}</div>
    <div className="sentinel-metric-label">Revenue {row?.changePct != null ? <span className={row.changePct>=0?'sentinel-green':'sentinel-red'}>{row.changePct>=0?'+':''}{row.changePct.toFixed(1)}%</span> : <span>—</span>}</div>
    <p className="sentinel-muted">{row?.changePct != null ? `Compared with ${row.comparison}.` : 'A comparable change is not available.'}</p>
    {chartable ? <div className="sentinel-bars" role="img" aria-label={`Revenue: ${values[0].display} for period ending ${values[0].period?.end}; ${values[1].display} for period ending ${values[1].period?.end}`}>
      {values.map((v,i)=><div className="sentinel-bar-col" key={i}><span className="sentinel-bar-value">{v.display}</span><div className="sentinel-bar-track"><div className="sentinel-bar" style={{height:`${Math.max(2,v.value/max*100)}%`,opacity:i===0?.58:1}} /></div><span className="sentinel-muted">{v.period?.end ?? 'Unknown date'}</span></div>)}
    </div> : <div className="sentinel-empty">{row?.latest ? `Latest reported: ${row.latest.display} · period ended ${row.latest.period?.end ?? 'unknown'}. A comparable chart is unavailable.` : 'No reported revenue for this period was available when the case was assessed.'}</div>}
    <p className="sentinel-footnote">Company filings recorded by the case assessment. Figures are historical, not estimates.</p></div></section>;
}
export function CaseOverview({d,symbol}: {d:any;symbol:string}) {
  const [tab,setTab]=useState<Tab>('Overview');
  const decision=d.investmentDecision, brief=d.idea?.plainBrief, ev=d.event, valuation=d.valuation;
  const positive=brief?.positives ?? [];
  return <div className="sentinel-overview">
    <div className="sentinel-tabs" role="tablist" aria-label="Case sections">{(['Overview','Financials','News'] as Tab[]).map(t=><button role="tab" aria-selected={tab===t} key={t} onClick={()=>setTab(t)}>{t}</button>)}</div>
    {tab==='Overview' && <div className="sentinel-content">
      <section><div className="sentinel-eyebrow"><Sparkles size={14}/> SENTINEL INSIGHT</div><div className="sentinel-verdict sentinel-card"><div className="sentinel-dot"/><h3>Still researching</h3><p>Sentinel has spotted a case to explore. There isn’t enough evidence yet for a buy decision.</p><details><summary>What’s missing <ChevronRight size={16}/></summary><ul>{(decision?.blockers ?? []).map((x:string)=><li key={x}>{x}</li>)}</ul></details></div></section>
      <section><div className="sentinel-section-title"><h3>Why it’s on the radar</h3><Newspaper size={18}/></div><div className="sentinel-card"><p className="sentinel-headline">{ev?.headline ?? 'Headline unavailable'}</p><p className="sentinel-muted sentinel-spaced">{brief?.why ?? 'More information is needed to explain this report.'}</p><div className="sentinel-source">{ev?.source ?? 'Source unavailable'} · {time(ev?.publishedAt)}{ev?.url && <> · <a href={ev.url} target="_blank" rel="noreferrer">Read source <ArrowUpRight size={13}/></a></>}</div><p className="sentinel-footnote">Based on the headline and available summary; the report still needs verification.</p></div></section>
      <section><div className="sentinel-section-title"><h3>At a glance</h3></div><div className="sentinel-card sentinel-stat-list"><div><span>P/E ratio</span><strong>{valuation?.pe?.display ?? 'Unavailable'}</strong></div><div><span>Sales growth</span><strong>{d.business?.find((r:any)=>r.label==='Revenue (quarter)' && r.changePct!=null)?.changePct != null ? `${d.business.find((r:any)=>r.label==='Revenue (quarter)' && r.changePct!=null).changePct.toFixed(1)}%` : d.business?.find((r:any)=>r.label==='Revenue (year)' && r.changePct!=null)?.changePct != null ? `${d.business.find((r:any)=>r.label==='Revenue (year)' && r.changePct!=null).changePct.toFixed(1)}%` : 'Unavailable'}</strong></div><div><span>Buy decision</span><strong>Not assessed</strong></div><p className="sentinel-footnote">P/E uses last reported annual earnings; sales growth uses the latest comparable quarter or year. Data is from the original assessment, not necessarily today.</p></div></section>
      <section><div className="sentinel-section-title"><h3>What stands out</h3></div><div className="sentinel-card">{positive.length ? <ol className="sentinel-points">{positive.map((p:any,i:number)=><li key={i}><span>{i+1}</span><div><strong>{p.text}</strong><p className="sentinel-muted">{p.detail}</p></div></li>)}</ol> : <p className="sentinel-muted">There isn’t enough comparable company data to highlight a financial trend yet.</p>}<p className="sentinel-footnote">A positive trend alone does not establish that the shares are good value.</p></div></section>
      <FinancialChart rows={d.business ?? []}/>
    </div>}
    {tab==='Financials' && <div className="sentinel-content"><FinancialChart rows={d.business ?? []}/><section><div className="sentinel-section-title"><h3>Reported figures</h3></div><div className="sentinel-card sentinel-stat-list">{(d.business ?? []).length ? d.business.map((r:any)=><div key={r.latest.id}><span>{r.label}<small>Period ended {r.latest.period?.end ?? 'unknown'}</small></span><strong>{r.latest.display}</strong></div>) : <p className="sentinel-muted">No company figures were available at the time of this case.</p>}<p className="sentinel-footnote">Expand the sources below for filing details and comparisons.</p></div></section></div>}
    {tab==='News' && <div className="sentinel-content"><section><div className="sentinel-section-title"><h3>Reported event</h3></div><div className="sentinel-card"><p className="sentinel-headline">{ev?.headline ?? 'Headline unavailable'}</p><p className="sentinel-muted sentinel-spaced">{ev?.summary || 'No provider summary is available.'}</p><div className="sentinel-source">{ev?.source ?? 'Source unavailable'} · {time(ev?.publishedAt)}{ev?.url && <> · <a href={ev.url} target="_blank" rel="noreferrer">Read source <ArrowUpRight size={13}/></a></>}</div><p className="sentinel-footnote">The headline and summary are reported claims. Check the company’s filing in the full thesis below.</p></div></section></div>}
  </div>;
}
