"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, Clock3, ExternalLink, FlaskConical, HelpCircle, Info, LockKeyhole, Minus, Plus, Quote, Shield, X } from "lucide-react";
import { CartesianGrid, ComposedChart, Line, LineChart, Bar, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { WhatChanged } from "./what-changed";
import { ResearchTeamPanel } from "./research-team-panel";

/* Company page (company-page-v1). Real data only: every value comes from /api/company-page with its period and
   source; missing values show "Unknown" with a reason. Green/red only for price direction, always with ▲/▼. */

const day = (d: string | null | undefined) => (d && Number.isFinite(Date.parse(d)) ? new Date(d.length === 10 ? d + "T12:00:00Z" : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "unknown date");
const short = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
const money = (v: number | null | undefined) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  return a >= 1e9 ? `${sign}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${sign}$${(a / 1e6).toFixed(1)}M` : `${sign}$${a.toLocaleString("en-US")}`;
};
const move = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? <span className={v >= 0 ? "text-emerald-400" : "text-red-400"}>{v >= 0 ? "▲ +" : "▼ −"}{Math.abs(v).toFixed(1)}%</span> : <span className="text-muted-foreground">—</span>);
const Card = ({ children, className = "", label }: { children: React.ReactNode; className?: string; label?: string }) => <section aria-label={label} className={`rounded-3xl border border-border bg-card/60 p-6 ${className}`}>{children}</section>;
const Unknown = ({ why }: { why: string }) => <span tabIndex={0} title={why} aria-label={`Unknown: ${why}`} className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">Unknown</span>;
const Chip = ({ children, tone = "" }: { children: React.ReactNode; tone?: string }) => <span className={`rounded-md border border-border px-2 py-1 text-[11px] ${tone}`}>{children}</span>;
const VER_TONE: Record<string, string> = { supported: "border-sky-400/40 text-sky-200", conflicting: "border-amber-400/40 text-amber-200", wrong_company: "border-red-400/40 text-red-200" };
const MATCH_TONE: Record<string, string> = { name_conflict: "border-red-400/40 text-red-200" };
function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string }) {
  return <div role="group" aria-label={label} className="inline-flex rounded-xl border border-border bg-background p-1">{options.map(o => <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)} className={`min-h-9 min-w-11 rounded-lg px-3 text-xs ${value === o ? "bg-muted font-semibold" : "text-muted-foreground hover:text-foreground"}`}>{o}</button>)}</div>;
}

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
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Price history</h2><Seg value={range} options={["1M", "6M", "1Y"] as const} onChange={setRange} label="Price period" /></div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{r ? <>{symbol} {move(r.stockPct)} · SPY {move(r.spyPct)} · {short(r.from)} – {short(r.to)}{r.partial ? " (all the history Sentinel has)" : ""}</> : "Not enough matched prices for this period."}</span>
        <span className="flex items-center gap-4">
          <label className="flex min-h-11 cursor-pointer items-center gap-2"><input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} className="size-4 accent-sky-400" />Compare with SPY</label>
          <button type="button" onClick={() => setTable(!table)} className="min-h-11 underline-offset-2 hover:underline" aria-pressed={table}>{table ? "View as chart" : "View as table"}</button>
        </span>
      </div>
      {table ? (
        <div className="mt-3 max-h-72 overflow-auto"><table className="w-full text-left text-xs tabular-nums"><caption className="sr-only">Daily closes</caption><thead className="text-muted-foreground"><tr><th className="py-1 font-medium">Date</th><th className="font-medium">{symbol} close</th><th className="font-medium">SPY close</th></tr></thead>
          <tbody>{[...data].reverse().map((d: any) => <tr key={d.date} className="border-t border-border"><td className="py-1">{day(d.date)}</td><td>${d.close.toFixed(2)}</td><td>{d.spy !== null ? `$${d.spy.toFixed(2)}` : "—"}</td></tr>)}</tbody></table></div>
      ) : (
        <div className="mt-3 h-72" role="img" aria-label={`${range} daily closes for ${symbol}${r ? `: ${r.stockPct >= 0 ? "up" : "down"} ${Math.abs(r.stockPct).toFixed(1)}% while SPY moved ${r.spyPct.toFixed(1)}%` : ""}.`}>
          <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 12, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 6" />
            <XAxis dataKey="date" tickFormatter={short} minTickGap={60} axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <YAxis domain={["auto", "auto"]} tickFormatter={(v: number) => `$${v.toFixed(0)}`} width={52} axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <Tooltip content={({ active, payload, label }) => active && payload?.length ? <div className="rounded-xl border border-border bg-popover p-2 text-xs"><p className="font-semibold">{day(String(label))}</p>{payload.map(i => <p key={String(i.dataKey)}>{i.name}: ${Number(i.value).toFixed(2)}</p>)}{marks.filter((m: any) => m.date === label).map((m: any) => <p key={m.caseId} className="mt-1 max-w-60 border-t border-border pt-1">{m.headline}</p>)}</div> : null} />
            {compare && <Line name="SPY (rebased)" dataKey="spyRebased" stroke="var(--muted-foreground)" strokeDasharray="5 5" dot={false} isAnimationActive={false} connectNulls />}
            <Line name={symbol} dataKey="close" stroke="#38bdf8" strokeWidth={2.2} dot={false} isAnimationActive={false} />
            {marks.map((m: any) => { const d = data.find((x: any) => x.date === m.date); return d ? <ReferenceDot key={m.caseId} x={m.date} y={d.close} r={4} fill="#38bdf8" stroke="var(--card)" strokeWidth={2} /> : null; })}
          </LineChart></ResponsiveContainer>
        </div>
      )}
      <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground"><span>{p.source} · fetched {day(p.fetchedAt)}</span><span>{p.note}</span></div>
      {marks.length > 0 && <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">{marks.map((m: any) => <li key={m.caseId} className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-sky-400" />{short(m.date)} · {m.headline.length > 70 ? m.headline.slice(0, 70) + "…" : m.headline}</li>)}</ul>}
    </Card>
  );
}

function KeyFigures({ rows }: { rows: any[] }) {
  return (
    <Card label="Key figures">
      <div className="mb-2 flex items-center justify-between"><h2 className="text-base font-semibold">Key figures</h2><span className="text-xs text-muted-foreground">Reported, not estimated</span></div>
      <dl className="divide-y divide-border">{rows.map(f => (
        <div key={f.metric} className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0"><dt className="flex items-center gap-1 text-sm">{f.label}<span tabIndex={0} title={f.help} aria-label={f.help} className="inline-flex size-6 items-center justify-center text-muted-foreground"><Info size={13} /></span></dt>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{f.value !== null ? <>{f.periodEnd ? `Year to ${day(f.periodEnd)}` : ""}{f.changeNote ? `${f.periodEnd ? " · " : ""}${f.changeNote}` : ""}{f.source?.url ? <> · <a className="underline" href={f.source.url} target="_blank" rel="noreferrer">{f.source.form} filed {f.source.filed}</a></> : ""}</> : f.reason}</p></div>
          <dd className="shrink-0 text-right">{f.value === null ? <Unknown why={f.reason} /> : <><span className="text-xl font-semibold tabular-nums">{f.unit === "x" ? f.value.toFixed(1) : money(f.value)}</span>{typeof f.changePct === "number" && <div className="text-xs">{move(f.changePct)}</div>}</>}</dd>
        </div>))}</dl>
    </Card>
  );
}

function Financials({ f }: { f: any }) {
  const [period, setPeriod] = useState<"Annual" | "Quarterly">("Annual"), [table, setTable] = useState(false);
  const rows = period === "Annual" ? f.annual : f.quarterly, scaled = rows.map((r: any) => ({ ...r, revenueM: r.revenue !== null ? r.revenue / 1e6 : null, netIncomeM: r.netIncome !== null ? r.netIncome / 1e6 : null }));
  const has = rows.some((r: any) => r.revenue !== null || r.netIncome !== null);
  return (
    <Card label="Financials">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Financials</h2><span className="flex items-center gap-3"><button type="button" onClick={() => setTable(!table)} aria-pressed={table} className="min-h-11 text-xs underline-offset-2 hover:underline">{table ? "View as chart" : "View as table"}</button><Seg value={period} options={["Annual", "Quarterly"] as const} onChange={setPeriod} label="Financial period" /></span></div>
      {!has ? <p className="mt-4 text-sm"><Unknown why="No reported figures" /> <span className="ml-2 text-muted-foreground">Sentinel has no reported {period.toLowerCase()} revenue or net income for this company.</span></p>
        : table ? (
          <table className="mt-4 w-full text-left text-xs tabular-nums"><caption className="sr-only">{period} revenue and net income</caption><thead className="text-muted-foreground"><tr><th className="py-1 font-medium">Period</th><th className="font-medium">Revenue</th><th className="font-medium">Net income</th><th className="font-medium">Net margin</th></tr></thead>
            <tbody>{rows.map((r: any, i: number) => <tr key={(r.periodEnd ?? "gap") + i} className="border-t border-border"><td className="py-1">{r.gap ? "Not reported separately" : r.period}</td><td>{money(r.revenue) ?? "Unknown"}</td><td>{money(r.netIncome) ?? "Unknown"}</td><td>{typeof r.margin === "number" ? `${r.margin.toFixed(1)}%` : "—"}</td></tr>)}</tbody></table>
        ) : (
          <div className="mt-4 h-64" role="img" aria-label={`${period} revenue and net income in USD millions.`}>
            <ResponsiveContainer width="100%" height="100%"><ComposedChart data={scaled} margin={{ top: 8, right: 0, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 6" />
              <XAxis dataKey="period" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
              <YAxis yAxisId="m" tickFormatter={(v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}M`} width={70} axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
              <YAxis yAxisId="p" orientation="right" tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={40} axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
              <ReferenceLine yAxisId="m" y={0} stroke="var(--muted-foreground)" />
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} formatter={(v: any, n: any) => [v === null || v === undefined ? "Unknown" : n === "Net margin" ? `${Number(v).toFixed(1)}%` : `$${Number(v).toFixed(1)}M`, n]} />
              <Bar yAxisId="m" name="Revenue" dataKey="revenueM" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
              <Bar yAxisId="m" name="Net income" dataKey="netIncomeM" fill="#2dd4bf" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
              <Line yAxisId="p" name="Net margin" dataKey="margin" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
            </ComposedChart></ResponsiveContainer>
          </div>
        )}
      <p className="mt-2 text-[11px] text-muted-foreground">{f.note} USD; bars in millions.</p>
      <p className="mt-3 border-t border-border pt-3 text-[11px] text-muted-foreground">Source: SEC filings{f.source ? <> · latest {f.source.url ? <a className="underline" href={f.source.url} target="_blank" rel="noreferrer">{f.source.form} filed {f.source.filed}</a> : `${f.source.form} filed ${f.source.filed}`}</> : ""}</p>
    </Card>
  );
}

function Assessment({ a, note, dv, onOpen }: { a: any; note: string | null; dv: any; onOpen: (id: string) => void }) {
  return (
    <Card label="Sentinel assessment">
      <div className="mb-5 flex items-center justify-between"><span className="flex items-center gap-2 text-sm font-semibold"><Shield size={18} className="text-sky-400" />Sentinel assessment</span><span className="text-[11px] text-muted-foreground">Rules, not advice</span></div>
      {!a ? <p className="text-sm text-muted-foreground">{note}</p> : <>
        {!a.promoted && <p className="mb-3 rounded-xl border border-red-400/40 bg-red-400/10 p-2 text-xs text-red-100">The latest report is probably about a different company. Nothing below is offered as an idea.</p>}
        <span className="rounded-md bg-sky-400/10 px-2 py-1 text-[11px] text-sky-200">{a.status}</span>
        <h2 className="mt-3 text-xl font-semibold leading-snug">{a.view.label}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{a.view.text}</p>
        <div className="mt-5">
          <div className="mb-1.5 flex justify-between text-xs"><span className="text-muted-foreground" title={a.score.meaning}>Evidence strength</span><span className="font-semibold tabular-nums">{a.score.score !== null ? `${a.score.score}/100` : "Too thin to score"}</span></div>
          <div className="h-1 rounded-full bg-muted" role="img" aria-label={a.score.score !== null ? `Evidence strength ${a.score.score} out of 100. ${a.score.meaning}` : "Evidence too thin to score."}><div className="h-1 rounded-full bg-sky-400" style={{ width: `${a.score.score ?? 0}%` }} /></div>
          <p className="mt-1 text-[10px] text-muted-foreground">{a.score.meaning}</p>
        </div>
        <ul className="mt-5 space-y-3 text-[13px] leading-relaxed">
          <li className="flex gap-3"><Plus size={16} className="mt-0.5 shrink-0 text-sky-400" aria-label="Supports" /><span>{a.reason ?? <span className="text-muted-foreground">{a.reasonNote}</span>}</span></li>
          <li className="flex gap-3"><Minus size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-label="Challenges" /><span className={a.counter?.unknown ? "text-muted-foreground" : ""}>{a.counter?.text ?? <span className="text-muted-foreground">No evidence-supported counterpoint was found. That is not evidence of safety.</span>}</span></li>
          <li className="flex gap-3"><HelpCircle size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-label="Unknown" /><span className="text-muted-foreground">{a.unknown}</span></li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2"><Chip tone={VER_TONE[a.verification.state] ?? ""}>Event: {a.verification.label}</Chip><Chip tone={MATCH_TONE[a.match.level] ?? ""}>Company match: {a.match.label}</Chip>{a.analystOpinion && <Chip>Analyst opinion</Chip>}</div>
        <p className="mt-3 text-[11px] text-muted-foreground">Latest report published {day(a.publishedAt)} · assessed {day(a.assessedAt)}{a.earlierEvents ? ` · ${a.earlierEvents} earlier event${a.earlierEvents === 1 ? "" : "s"} below` : ""}</p>
        <button type="button" onClick={() => onOpen(a.caseId)} className="mt-4 flex min-h-12 w-full items-center justify-between rounded-xl bg-sky-400 px-4 text-sm font-semibold text-slate-950 hover:bg-sky-300">Open full research<ArrowUpRight size={18} /></button>
      </>}
      <div className="mt-5 flex gap-3 border-t border-border pt-4 text-xs text-muted-foreground" aria-disabled="true"><LockKeyhole size={16} className="mt-0.5 shrink-0" /><p>{dv.text}</p></div>
    </Card>
  );
}

function Events({ events, onOpen }: { events: any[]; onOpen: (id: string) => void }) {
  return (
    <Card label="Events">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">Events</h2><span className="text-xs text-muted-foreground">{events.length} report{events.length === 1 ? "" : "s"} Sentinel assessed</span></div>
      {!events.length ? <p className="text-sm text-muted-foreground">No research case for this company yet.</p> : <ul className="divide-y divide-border">{events.map(e => (
        <li key={e.caseId} className="py-3">
          <div className="mb-1 flex justify-between gap-2 text-[11px]"><time className="text-muted-foreground">{day(e.publishedAt)}</time><span className={e.status === "Meets research rules" ? "text-sky-300" : "text-muted-foreground"}>{e.status}</span></div>
          {e.analystOpinion ? <p className="flex gap-2 text-[13px] italic leading-relaxed"><Quote size={13} className="mt-1 shrink-0 text-muted-foreground" />“{e.headline}”</p> : <p className="text-[13px] font-medium leading-relaxed">{e.headline ?? "No headline recorded"}</p>}
          <p className="mt-1 text-[11px] text-muted-foreground">{e.source ?? "Unknown source"} · reported claim{e.url && <> · <a className="inline-flex items-center gap-0.5 underline" href={e.url} target="_blank" rel="noreferrer">original<ExternalLink size={9} /></a></>}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">{e.analystOpinion && <Chip>Analyst opinion</Chip>}<Chip tone={MATCH_TONE[e.match.level] ?? ""}>Match: {e.match.label}</Chip><Chip tone={VER_TONE[e.verification.state] ?? ""}>{e.verification.label}</Chip>
            <button type="button" onClick={() => onOpen(e.caseId)} className="ml-auto min-h-9 rounded-md px-2 text-[11px] underline-offset-2 hover:underline">Research</button></div>
        </li>))}</ul>}
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
  const back = <a href="/" className="inline-flex min-h-11 items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft size={14} />Sentinel</a>;
  if (error) return <main className="mx-auto max-w-6xl p-6">{back}<p className="mt-6 text-sm"><Unknown why={error} /> <span className="ml-2 text-muted-foreground">{error}</span></p></main>;
  if (!d) return <main className="mx-auto max-w-6xl p-6" aria-busy="true">{back}<div className="mt-6 h-10 w-64 animate-pulse rounded-lg bg-muted" /><div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]"><div className="h-96 animate-pulse rounded-3xl bg-muted/60" /><div className="h-96 animate-pulse rounded-3xl bg-muted/60" /></div></main>;
  const p = d.price, followed = d.company.followed || following === "done";
  return (
    <main className="mx-auto max-w-6xl px-4 pb-12 pt-4 sm:px-6">
      <div className="flex items-center justify-between">{back}<span className="text-xs text-muted-foreground">Company research · USD</span></div>
      <header className="mt-4 flex flex-wrap items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-4"><span aria-hidden className="flex size-14 items-center justify-center rounded-full bg-muted text-xl font-semibold text-sky-300">{(d.company.name ?? symbol).slice(0, 1)}</span>
            <div><h1 className="text-3xl font-semibold leading-tight">{d.company.name ?? symbol} <span className="text-muted-foreground">· {symbol}</span></h1><p className="mt-1 text-xs text-muted-foreground">{d.company.cik ? `SEC CIK ${d.company.cik}` : "No SEC identity"}{d.company.industryCode ? ` · SEC industry code ${d.company.industryCode}` : ""}</p></div></div>
          {p.status === "ok" ? <>
            <div className="mt-6 flex flex-wrap items-center gap-3"><span className="text-5xl font-semibold tabular-nums">${p.last.close.toFixed(2)}</span><span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${p.last.stale ? "bg-amber-400/15 text-amber-200" : "bg-muted text-muted-foreground"}`}><Clock3 size={13} />Last close · {day(p.last.date)} · IEX{p.last.stale ? ` · ${p.last.staleSessions} sessions old` : ""}</span></div>
            {p.ranges?.["6M"] && <p className="mt-2 text-sm">{move(p.ranges["6M"].stockPct)} over 6M <span className="mx-1.5 text-muted-foreground">·</span><span className="text-muted-foreground">SPY</span> {move(p.ranges["6M"].spyPct)} <span className="text-muted-foreground">same dates</span></p>}
          </> : <p className="mt-6 text-sm"><Unknown why={p.reason} /><span className="ml-2 text-muted-foreground">Price unavailable: {p.reason}</span></p>}
        </div>
        <button type="button" onClick={follow} disabled={followed || following === "busy"} aria-pressed={followed} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-5 text-sm disabled:opacity-80">{followed ? <><Check size={16} />Following</> : following === "busy" ? "Adding…" : <><Plus size={16} />Follow</>}</button>
      </header>
      {following === "failed" && <p className="mt-2 text-xs text-amber-200">The company could not be added. Try again in a minute.</p>}

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6"><PriceCard p={p} symbol={symbol} /><KeyFigures rows={d.keyFigures} /><Financials f={d.financials} /></div>
        <aside className="min-w-0 space-y-6">
          <Assessment a={d.assessment} note={d.assessmentNote} dv={d.directionalView} onOpen={setOpen} />
          <Events events={d.events} onOpen={setOpen} />
          <section aria-label="Your positions" className="px-1">
            <h2 className="mb-3 text-sm font-semibold">Your virtual positions</h2>
            <div className="flex flex-wrap gap-2"><Chip>Manual Practice: {d.positions.manualCents === null ? "unknown" : d.positions.manualCents > 0 ? money(d.positions.manualCents / 100) + " at cost" : "none"}</Chip><Chip>Automated experiment: {d.positions.inExperiment === null ? "unknown" : d.positions.inExperiment ? "holding" : "none"}</Chip></div>
            <a href="/#practice" className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm hover:bg-muted"><FlaskConical size={16} />Practice with virtual money</a>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">Opens Practice. Trades are priced from a live IEX quote, so only in US market hours (14:30–21:00 UK).</p>
          </section>
        </aside>
      </div>
      <footer className="mt-10 border-t border-border pt-5 text-center text-[11px] text-muted-foreground">{d.footer} · sources on each figure</footer>

      {open && <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={() => setOpen(null)}>
        <div role="dialog" aria-modal="true" aria-label="Full research" className="h-full w-full max-w-2xl overflow-y-auto border-l border-border bg-background p-4 sm:p-6" onClick={e => e.stopPropagation()}>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">Full research · {symbol}</h2><button type="button" autoFocus onClick={() => setOpen(null)} aria-label="Close research" className="inline-flex size-11 items-center justify-center rounded-full hover:bg-muted"><X size={18} /></button></div>
          <div className="space-y-4"><WhatChanged caseId={open} symbol={symbol} /><ResearchTeamPanel caseId={open} /></div>
        </div>
      </div>}
    </main>
  );
}
