"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, Clock3, ExternalLink, FlaskConical, HelpCircle, Info, LockKeyhole, Minus, Plus, Quote, Shield, X } from "lucide-react";
import { CartesianGrid, ComposedChart, Line, LineChart, Bar, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Switch } from "@/components/ui/switch";
import { WhatChanged } from "./what-changed";
import { ResearchTeamPanel } from "./research-team-panel";
import { InvestmentCasePanel } from "./investment-case";
import { ImpliedExpectationsPanel } from "./implied-expectations";
import { DecisionComparePanel } from "./decision-compare";

/* Company page (company-page-v1). Real data only: every value comes from /api/company-page with its period and
   source; missing values show "Unknown" with a reason. Green/red only for price direction, always with ▲/▼.
   Layout and styling ported 2026-11-17 from the Lovable prototype "Signal Scout Investment Desk" (commit 7b5ec85):
   presentation only, no change to data, calculations or endpoints. */

const day = (d: string | null | undefined) => (d && Number.isFinite(Date.parse(d)) ? new Date(d.length === 10 ? d + "T12:00:00Z" : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "unknown date");
const short = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
const money = (v: number | null | undefined) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  return a >= 1e9 ? `${sign}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${sign}$${(a / 1e6).toFixed(1)}M` : `${sign}$${a.toLocaleString("en-US")}`;
};
const move = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? <span className={v >= 0 ? "text-price-up" : "text-price-down"}>{v >= 0 ? "▲ +" : "▼ −"}{Math.abs(v).toFixed(1)}%</span> : <span className="text-muted-foreground">—</span>);
const Card = ({ children, className = "", label }: { children: React.ReactNode; className?: string; label?: string }) => <section aria-label={label} className={`company-card ${className}`}>{children}</section>;
const Unknown = ({ why }: { why: string }) => <span tabIndex={0} title={why} aria-label={`Unknown: ${why}`} className="unknown-pill">Unknown</span>;
const Chip = ({ children, tone = "" }: { children: React.ReactNode; tone?: string }) => <span className={`evidence-chip ${tone}`}>{children}</span>;
const VER_TONE: Record<string, string> = { supported: "tone-sky", conflicting: "tone-amber", wrong_company: "tone-red" };
const MATCH_TONE: Record<string, string> = { name_conflict: "tone-red" };
const NEWS_TONE = (d: string) => (d === "positive" ? "tone-sky" : d === "neutral" || d === "not_company_news" ? "" : "tone-amber");
const InfoTip = ({ text }: { text: string }) => <span tabIndex={0} title={text} aria-label={text} className="inline-flex size-11 items-center justify-center text-muted-foreground"><Info size={14} /></span>;
function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string }) {
  return <div role="group" aria-label={label} className="segmented">{options.map(o => <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)} className={value === o ? "selected" : ""}>{o}</button>)}</div>;
}
const tooltipStyle = { background: "var(--popover)", border: "1px solid var(--border)", color: "var(--foreground)", borderRadius: 12, fontSize: 12 };

function PriceCard({ p, symbol }: { p: any; symbol: string }) {
  const [range, setRange] = useState<"1M" | "6M" | "1Y">("6M"), [compare, setCompare] = useState(false), [table, setTable] = useState(false);
  const r = p.ranges?.[range];
  const data = useMemo(() => {
    const n = { "1M": 21, "6M": 126, "1Y": 252 }[range], rows = p.series.slice(-(n + 1)), first = rows.find((x: any) => x.spy !== null);
    return rows.map((x: any) => ({ ...x, spyRebased: first && x.spy !== null ? (first.close * x.spy) / first.spy : null }));
  }, [p.series, range]);
  const marks = (p.markers ?? []).filter((m: any) => data.some((d: any) => d.date === m.date));
  if (p.status !== "ok") return <Card label="Price history"><h2 className="text-base font-semibold">Price history</h2><p className="mt-3 text-sm"><Unknown why={p.reason} /> <span className="ml-2 text-muted-foreground">{p.reason}</span></p></Card>;
  return (
    <Card label="Price history">
      <div className="flex flex-wrap items-center justify-between gap-4"><h2 className="text-base font-semibold">Price history</h2><Seg value={range} options={["1M", "6M", "1Y"] as const} onChange={setRange} label="Price period" /></div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs">
        <span className="flex items-center gap-2 text-muted-foreground"><span className="legend-dot bg-investigate" />{symbol}{compare && <><span className="legend-dot ml-3 bg-muted-foreground" />SPY · rebased</>}</span>
        <span className="flex items-center gap-4">
          <label className="flex min-h-11 cursor-pointer items-center gap-3" htmlFor="compare-spy">Compare with SPY<Switch id="compare-spy" checked={compare} onCheckedChange={setCompare} /></label>
          <button type="button" onClick={() => setTable(!table)} className="min-h-11 underline-offset-2 hover:underline" aria-pressed={table}>{table ? "View as chart" : "View as table"}</button>
        </span>
      </div>
      {table ? (
        <div className="mt-3 max-h-72 overflow-auto"><table className="w-full text-left text-xs tabular-nums"><caption className="sr-only">Daily closes</caption><thead className="text-muted-foreground"><tr><th className="py-1 font-medium">Date</th><th className="font-medium">{symbol} close</th><th className="font-medium">SPY close</th></tr></thead>
          <tbody>{[...data].reverse().map((d: any) => <tr key={d.date} className="border-t border-border"><td className="py-1">{day(d.date)}</td><td>${d.close.toFixed(2)}</td><td>{d.spy !== null ? `$${d.spy.toFixed(2)}` : "—"}</td></tr>)}</tbody></table></div>
      ) : (
        <div className="price-chart mt-2" role="img" aria-label={`${range} daily closes for ${symbol}${r ? `: ${r.stockPct >= 0 ? "up" : "down"} ${Math.abs(r.stockPct).toFixed(1)}% while SPY moved ${r.spyPct.toFixed(1)}%` : ""}${compare ? ", with SPY rebased to the starting price" : ""}.`}>
          <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 20, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 6" />
            <XAxis dataKey="date" tickFormatter={short} minTickGap={65} axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} dy={12} />
            <YAxis domain={["auto", "auto"]} tickFormatter={(v: number) => `$${v.toFixed(0)}`} width={52} axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <Tooltip content={({ active, payload, label }) => active && payload?.length ? <div className="chart-tooltip"><p className="mb-2 font-semibold">{day(String(label))}</p>{payload.map(i => <p key={String(i.dataKey)}>{i.name}: ${Number(i.value).toFixed(2)}</p>)}{marks.filter((m: any) => m.date === label).map((m: any) => <p key={m.caseId} className="mt-2 max-w-56 border-t border-border pt-2">{m.headline}</p>)}</div> : null} />
            {compare && <Line name="SPY (rebased)" dataKey="spyRebased" stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="5 5" dot={false} isAnimationActive={false} connectNulls />}
            <Line name={symbol} dataKey="close" stroke="var(--investigate)" strokeWidth={2.4} dot={false} activeDot={{ r: 5 }} isAnimationActive={false} />
            {marks.map((m: any) => { const d = data.find((x: any) => x.date === m.date); return d ? <ReferenceDot key={m.caseId} x={m.date} y={d.close} r={4} fill="var(--investigate)" stroke="var(--card)" strokeWidth={2} /> : null; })}
          </LineChart></ResponsiveContainer>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-[11px] text-muted-foreground"><span>{p.source} · fetched {day(p.fetchedAt)}</span><span>{r ? <>{symbol} {move(r.stockPct)} over {range}; SPY {move(r.spyPct)} on the same dates{r.partial ? " (all the history Sentinel has)" : ""}.</> : "Not enough matched prices for this period."}</span></div>
      <p className="mt-1 text-[11px] text-muted-foreground">{p.note}</p>
      {marks.length > 0 && <div className="mt-2 flex flex-wrap gap-x-4 text-[11px] text-muted-foreground">{marks.map((m: any) => <span key={m.caseId} tabIndex={0} title={m.headline} className="event-chart-key inline-flex min-h-11 items-center gap-1.5"><span className="legend-dot bg-investigate" />{short(m.date)}<span className="event-chart-headline">{m.headline}</span></span>)}</div>}
    </Card>
  );
}

function KeyFigures({ rows }: { rows: any[] }) {
  return (
    <Card label="Key figures">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">Key figures</h2><span className="text-xs text-muted-foreground">Reported, not estimated</span></div>
      <dl className="divide-y divide-border">{rows.map(f => (
        <div key={f.metric} className="figure-row">
          <div className="min-w-0"><dt className="text-sm">{f.label}<InfoTip text={f.help} /></dt>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{f.value !== null ? <>{f.periodEnd ? `${f.metric === "pe" ? "EPS for year to" : "Year to"} ${day(f.periodEnd)}` : ""}{f.changeNote ? `${f.periodEnd ? " · " : ""}${f.changeNote}` : ""}{f.source?.url ? <> · <a className="underline" href={f.source.url} target="_blank" rel="noreferrer">{f.source.form} filed {f.source.filed}</a></> : ""}</> : f.reason}</p></div>
          <dd className="shrink-0 text-right">{f.value === null ? <Unknown why={f.reason} /> : <><span className="text-[23px] font-semibold tabular-nums">{f.unit === "x" ? f.value.toFixed(1) : money(f.value)}</span>{typeof f.changePct === "number" && <div className="text-xs">{move(f.changePct)}</div>}</>}</dd>
        </div>))}</dl>
    </Card>
  );
}

function Financials({ f }: { f: any }) {
  const [period, setPeriod] = useState<"Annual" | "Quarterly">("Annual"), [table, setTable] = useState(false);
  const rows = period === "Annual" ? f.annual : f.quarterly;
  const peak = Math.max(0, ...rows.flatMap((r: any) => [Math.abs(r.revenue ?? 0), Math.abs(r.netIncome ?? 0)])), big = peak >= 1e9, div = big ? 1e9 : 1e6, u = big ? "B" : "M";
  const scaled = rows.map((r: any) => ({ ...r, revenueM: r.revenue !== null ? r.revenue / div : null, netIncomeM: r.netIncome !== null ? r.netIncome / div : null }));
  const has = rows.some((r: any) => r.revenue !== null || r.netIncome !== null);
  return (
    <Card label="Financials">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Financials</h2><span className="flex items-center gap-3"><button type="button" onClick={() => setTable(!table)} aria-pressed={table} className="min-h-11 text-xs underline-offset-2 hover:underline">{table ? "View as chart" : "View as table"}</button><Seg value={period} options={["Annual", "Quarterly"] as const} onChange={setPeriod} label="Financial period" /></span></div>
      {has && !table && <div className="my-6 flex flex-wrap gap-5 text-xs text-muted-foreground"><span className="flex items-center gap-2"><span className="legend-dot bg-financial-revenue" />Revenue</span><span className="flex items-center gap-2"><span className="legend-dot bg-financial-income" />Net income</span><span className="flex items-center gap-2"><span className="h-0.5 w-4 bg-financial-margin" />Net margin</span><span className="ml-auto">USD {big ? "billions" : "millions"} / margin %</span></div>}
      {!has ? <p className="mt-4 text-sm"><Unknown why="No reported figures" /> <span className="ml-2 text-muted-foreground">Sentinel has no reported {period.toLowerCase()} revenue or net income for this company.</span></p>
        : table ? (
          <table className="mt-4 w-full text-left text-xs tabular-nums"><caption className="sr-only">{period} revenue and net income</caption><thead className="text-muted-foreground"><tr><th className="py-1 font-medium">Period</th><th className="font-medium">Revenue</th><th className="font-medium">Net income</th><th className="font-medium">Net margin</th></tr></thead>
            <tbody>{rows.map((r: any, i: number) => <tr key={(r.periodEnd ?? "gap") + i} className="border-t border-border"><td className="py-1">{r.gap ? "Not reported separately" : r.period}</td><td>{money(r.revenue) ?? "Unknown"}</td><td>{money(r.netIncome) ?? "Unknown"}</td><td>{typeof r.margin === "number" ? `${r.margin.toFixed(1)}%` : "—"}</td></tr>)}</tbody></table>
        ) : (
          <div className="financial-chart" role="img" aria-label={`${period} revenue and net income in USD ${big ? "billions" : "millions"}.`}>
            <ResponsiveContainer width="100%" height="100%"><ComposedChart data={scaled} margin={{ top: 12, right: 0, bottom: 12, left: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 6" />
              <XAxis dataKey="period" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} dy={10} />
              <YAxis yAxisId="m" tickFormatter={(v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: big ? 1 : 0 })}${u}`} width={64} axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
              <YAxis yAxisId="p" orientation="right" tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={40} axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
              <ReferenceLine yAxisId="m" y={0} stroke="var(--muted-foreground)" />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [v === null || v === undefined ? "Unknown" : n === "Net margin" ? `${Number(v).toFixed(1)}%` : `$${Number(v).toFixed(big ? 2 : 1)}${u}`, n]} />
              <Bar yAxisId="m" name="Revenue" dataKey="revenueM" fill="var(--financial-revenue)" radius={[4, 4, 0, 0]} maxBarSize={42} isAnimationActive={false} />
              <Bar yAxisId="m" name="Net income" dataKey="netIncomeM" fill="var(--financial-income)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
              <Line yAxisId="p" name="Net margin" dataKey="margin" stroke="var(--financial-margin)" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
            </ComposedChart></ResponsiveContainer>
          </div>
        )}
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{f.note} USD; bars in {big ? "billions" : "millions"}.</p>
      <p className="mt-5 border-t border-border pt-4 text-[11px] text-muted-foreground">Source: SEC filings{f.source ? <> · latest {f.source.url ? <a className="underline" href={f.source.url} target="_blank" rel="noreferrer">{f.source.form} filed {f.source.filed}</a> : `${f.source.form} filed ${f.source.filed}`}</> : ""}</p>
    </Card>
  );
}

function Assessment({ a, note, dv, onOpen }: { a: any; note: string | null; dv: any; onOpen: (id: string) => void }) {
  return (
    <Card label="Sentinel assessment" className="assessment-card">
      <div className="mb-6 flex items-center justify-between"><span className="flex items-center gap-2 text-sm font-semibold"><Shield size={20} className="text-investigate" />Sentinel assessment</span><span className="text-[11px] text-muted-foreground">Rules, not advice</span></div>
      {!a ? <p className="text-sm text-muted-foreground">{note}</p> : <>
        {!a.promoted && <p className="mb-3 rounded-xl border border-red-400/40 bg-red-400/10 p-2 text-xs text-red-100">The latest report is probably about a different company. Nothing below is offered as an idea.</p>}
        <span className="assessment-label">{a.status}</span>
        <h2 className="mt-3 text-[22px] font-semibold leading-snug">{a.view.label}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{a.view.text}</p>
        {/* Evidence strength: the current display is kept as it was (founder decision pending on the design's version). */}
        <div className="mt-5">
          <div className="mb-1.5 flex justify-between text-xs"><span className="text-muted-foreground" title={a.score.meaning}>Evidence strength</span><span className="font-semibold tabular-nums">{a.score.score !== null ? `${a.score.score}/100` : "Too thin to score"}</span></div>
          <div className="h-1 rounded-full bg-muted" role="img" aria-label={a.score.score !== null ? `Evidence strength ${a.score.score} out of 100. ${a.score.meaning}` : "Evidence too thin to score."}><div className="h-1 rounded-full bg-sky-400" style={{ width: `${a.score.score ?? 0}%` }} /></div>
          <p className="mt-1 text-[10px] text-muted-foreground">{a.score.meaning}</p>
        </div>
        <ul className="mt-6 space-y-4 text-[13px] leading-relaxed">
          <li className="flex gap-3"><Plus size={16} className="mt-0.5 shrink-0 text-investigate" aria-label="Supports" /><span>{a.reason ?? <span className="text-muted-foreground">{a.reasonNote}</span>}</span></li>
          <li className="flex gap-3"><Minus size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-label="Challenges" /><span>{a.counter && !a.counter.unknown ? a.counter.text : <span className="text-muted-foreground">No evidence-supported counterpoint was found. That is not evidence of safety.</span>}</span></li>
          <li className="flex gap-3"><HelpCircle size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-label="Unknown" /><span className="text-muted-foreground">{a.counter?.unknown ? a.counter.text : a.unknown}</span></li>
        </ul>
        <div className="mb-6 mt-5 flex flex-wrap gap-2">{a.newsDirection && <Chip tone={NEWS_TONE(a.newsDirection.direction)}>{a.newsDirection.label}</Chip>}<Chip tone={VER_TONE[a.verification.state] ?? ""}>Event: {a.verification.label}</Chip><Chip tone={MATCH_TONE[a.match.level] ?? ""}>Company match: {a.match.label}</Chip>{a.analystOpinion && <Chip>Analyst opinion</Chip>}</div>
        {a.role && <p className="-mt-3 mb-4 text-[11px] text-muted-foreground">{a.role.text} {a.verifiedParty?.state === "verified" ? a.verifiedParty.label + " (" + a.verifiedParty.reason + ")" : "Verified party: not verified."}</p>}
        <p className="mb-4 text-[11px] text-muted-foreground">Latest report published {day(a.publishedAt)} · assessed {day(a.assessedAt)}{a.earlierEvents ? ` · ${a.earlierEvents} earlier event${a.earlierEvents === 1 ? "" : "s"} below` : ""}</p>
        <button type="button" onClick={() => onOpen(a.caseId)} className="flex h-12 w-full items-center justify-between rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90">Open full research<ArrowUpRight size={18} /></button>
      </>}
      <div className="mt-6 flex gap-3 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground" aria-disabled="true"><LockKeyhole size={16} className="mt-0.5 shrink-0" /><p>{dv.text}</p></div>
    </Card>
  );
}

function Events({ events, onOpen }: { events: any[]; onOpen: (id: string) => void }) {
  return (
    <Card label="Recent events">
      <div className="mb-5 flex items-center justify-between"><h2 className="text-base font-semibold">Recent events</h2><span className="text-xs text-muted-foreground">{events.length} report{events.length === 1 ? "" : "s"} Sentinel assessed</span></div>
      {!events.length ? <p className="text-sm text-muted-foreground">No research case for this company yet.</p> : <div className="divide-y divide-border">{events.map(e => (
        <article key={e.caseId} className="event-row">
          <div className="mb-2 flex justify-between gap-2 text-[11px]"><time className="text-muted-foreground">{day(e.publishedAt)}</time><span className={e.status === "Meets research rules" ? "text-investigate" : "text-muted-foreground"}>{e.status}</span></div>
          {e.analystOpinion ? <blockquote className="flex gap-2 text-[13px] leading-relaxed"><Quote size={14} className="mt-1 shrink-0 text-muted-foreground" />“{e.headline}”</blockquote> : <h3 className="text-[13px] font-medium leading-relaxed">{e.headline ?? "No headline recorded"}</h3>}
          <p className="mt-2 text-[11px] text-muted-foreground">{e.source ?? "Unknown source"} · reported claim{e.url && <> · <a className="inline-flex items-center gap-0.5 underline" href={e.url} target="_blank" rel="noreferrer">original<ExternalLink size={9} /></a></>}</p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">{e.newsDirection && <Chip tone={NEWS_TONE(e.newsDirection.direction)}>{e.newsDirection.label}</Chip>}{e.analystOpinion && <Chip>Analyst opinion</Chip>}<Chip tone={MATCH_TONE[e.match.level] ?? ""}>Company match: {e.match.label}</Chip><Chip tone={VER_TONE[e.verification.state] ?? ""}>{e.verification.label}</Chip>
            <button type="button" onClick={() => onOpen(e.caseId)} className="ml-auto min-h-11 rounded-md px-2 text-[11px] underline-offset-2 hover:underline">Research</button></div>
          {e.role && <p className="mt-1 text-[11px] text-muted-foreground">{e.role.text} {e.verifiedParty?.state === "verified" ? e.verifiedParty.label + " (" + e.verifiedParty.reason + ")" : "Verified party: not verified."}</p>}
        </article>))}</div>}
    </Card>
  );
}

export function CompanyPageView({ symbol }: { symbol: string }) {
  const [d, setD] = useState<any>(null), [error, setError] = useState(""), [open, setOpen] = useState<string | null>(null), [following, setFollowing] = useState<"idle" | "busy" | "done" | "failed">("idle");
  useEffect(() => {
    setD(null); setError("");
    fetch(`/api/company-page?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" }).then(r => r.json().then((j: any) => { if (!r.ok) throw new Error(j.error || "The company page could not be loaded."); setD(j); })).catch(e => setError(e.message));
  }, [symbol]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  async function follow() {
    setFollowing("busy");
    try { const r = await fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: symbol }) }); if (!r.ok) throw new Error(); setFollowing("done"); } catch { setFollowing("failed"); }
  }
  const topbar = <header className="company-topbar"><div className="company-container flex flex-wrap items-center justify-between gap-4"><a href="/" className="flex min-h-11 items-center gap-2.5 text-lg font-semibold"><Shield size={24} strokeWidth={1.6} className="text-investigate" />Sentinel<span className="ml-3 hidden border-l border-border pl-5 text-xs font-normal text-muted-foreground sm:inline">Company research</span></a><a href="/" className="inline-flex min-h-11 items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft size={14} />Back to Sentinel</a></div></header>;
  if (error) return <div className="company-page min-h-screen">{topbar}<main className="company-container pt-10"><p className="text-sm"><Unknown why={error} /> <span className="ml-2 text-muted-foreground">{error}</span></p></main></div>;
  if (!d) return <div className="company-page min-h-screen" aria-busy="true">{topbar}<main className="company-container pt-10"><div className="h-10 w-64 animate-pulse rounded-lg bg-muted" /><div className="company-grid mt-6"><div className="h-96 animate-pulse rounded-3xl bg-muted/60" /><div className="h-96 animate-pulse rounded-3xl bg-muted/60" /></div></main></div>;
  const p = d.price, followed = d.company.followed || following === "done";
  return (
    <div className="company-page min-h-screen">
      {topbar}
      <main className="company-container pb-12 pt-10">
        <div className="mb-7 flex items-center gap-2 text-xs text-muted-foreground"><span>Company research</span><span>/</span><span className="text-foreground">{symbol}</span><span className="ml-auto">USD</span></div>
        <div className="mb-9 flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="flex items-center gap-4"><span aria-hidden className="company-monogram">{(d.company.name ?? symbol).slice(0, 1)}</span>
              <div><h1 className="text-3xl font-semibold leading-tight">{d.company.name ?? symbol} <span className="text-muted-foreground">· {symbol}</span></h1><p className="mt-2 text-xs text-muted-foreground">{d.company.cik ? `SEC CIK ${d.company.cik}` : "No SEC identity"}{d.company.industryCode ? ` · SEC industry code ${d.company.industryCode}` : ""}</p></div></div>
            {p.status === "ok" ? <>
              <div className="mt-7 flex flex-wrap items-center gap-4"><span className="text-[48px] font-semibold leading-none tabular-nums">${p.last.close.toFixed(2)}</span><span className={`source-chip ${p.last.stale ? "stale" : ""}`}><Clock3 size={14} />Last close · {day(p.last.date)} · IEX{p.last.stale ? ` · ${p.last.staleSessions} sessions old` : ""}</span></div>
              {p.ranges?.["6M"] && <p className="mt-3 text-sm">{move(p.ranges["6M"].stockPct)} over 6M <span className="mx-2 text-muted-foreground">·</span><span className="text-muted-foreground">SPY</span> {move(p.ranges["6M"].spyPct)} <span className="text-muted-foreground">same dates</span></p>}
            </> : <p className="mt-7 text-sm"><Unknown why={p.reason} /><span className="ml-2 text-muted-foreground">Price unavailable: {p.reason}</span></p>}
          </div>
          <button type="button" onClick={follow} disabled={followed || following === "busy"} aria-pressed={followed} className="mt-2 inline-flex h-11 items-center gap-2 rounded-full border border-border bg-card px-5 text-sm disabled:opacity-80">{followed ? <><Check size={16} />Following</> : following === "busy" ? "Adding…" : <><Plus size={16} />Follow</>}</button>
        </div>
        {following === "failed" && <p className="-mt-6 mb-6 text-xs text-monitor">The company could not be added. Try again in a minute.</p>}

        <div className="company-grid">
          <div className="min-w-0 space-y-6">
            <PriceCard p={p} symbol={symbol} />
            <KeyFigures rows={d.keyFigures} />
            <Financials f={d.financials} />
            <ImpliedExpectationsPanel symbol={symbol} />
            <DecisionComparePanel symbol={symbol} caseId={d.assessment?.caseId ?? null} />
          </div>
          <aside className="company-aside min-w-0 space-y-6">
            <Assessment a={d.assessment} note={d.assessmentNote} dv={d.directionalView} onOpen={setOpen} />
            {d.assessment?.caseId && <InvestmentCasePanel caseId={d.assessment.caseId} />}
            <Events events={d.events} onOpen={setOpen} />
            <section aria-label="Your positions" className="px-1">
              <h2 className="mb-4 text-sm font-semibold">Your virtual positions</h2>
              <div className="flex flex-wrap gap-2"><span className="position-chip">Manual Practice: {d.positions.manualCents === null ? "unknown" : d.positions.manualCents > 0 ? money(d.positions.manualCents / 100) + " at cost" : "none"}</span><span className="position-chip">Automated experiment: {d.positions.inExperiment === null ? "unknown" : d.positions.inExperiment ? "holding" : "none"}</span></div>
              <a href="/#practice" className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-secondary text-sm hover:bg-muted"><FlaskConical size={16} />Practice with virtual money</a>
              <p className="mt-3 text-center text-[11px] text-muted-foreground">Opens Practice. Trades are priced from a live IEX quote, so only in US market hours (14:30–21:00 UK).</p>
            </section>
          </aside>
        </div>
      </main>
      <footer className="company-container border-t border-border py-6 text-center text-[11px] text-muted-foreground">{d.footer} · sources on each figure</footer>

      {open && <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={() => setOpen(null)}>
        <div role="dialog" aria-modal="true" aria-label="Full research" className="h-full w-full max-w-2xl overflow-y-auto border-l border-border bg-background p-4 sm:p-6" onClick={e => e.stopPropagation()}>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">Full research · {symbol}</h2><button type="button" autoFocus onClick={() => setOpen(null)} aria-label="Close research" className="inline-flex size-11 items-center justify-center rounded-full hover:bg-muted"><X size={18} /></button></div>
          <div className="space-y-4"><WhatChanged caseId={open} symbol={symbol} /><ResearchTeamPanel caseId={open} /></div>
        </div>
      </div>}
    </div>
  );
}
