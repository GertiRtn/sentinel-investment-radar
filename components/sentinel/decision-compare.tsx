"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Save } from "lucide-react";
import { createSaveGuard } from "@/lib/sentinel/save-guard";

/* Portfolio suitability: keep the portfolio, add the stock, or add SPY, from the same virtual Practice state
   (decision-compare-v1), then save the decision unchanged (decision-snapshot-v1) and review it later.
   Virtual only. Nothing here trades. No colour for good or bad.
   Layout ported 2026-11-17 from the Lovable prototype (DecisionPanels.tsx, commit 7b5ec85): the comparison becomes one
   card per option below 640px; the prototype's sample price, "quote refreshes" checkbox and saved-decisions link were not ported. */

const money = (c: number | null | undefined) => (typeof c === "number" ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100) : "unavailable");
const pct = (v: number | null | undefined, d = 2) => (typeof v === "number" && Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(d)}%` : "—");
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "unknown");
const STATUS: Record<string, string> = { met: "Yes", not_met: "No", not_yet: "Not yet", overdue: "Overdue", unavailable: "Unavailable", computed: "" };
const H = ({ children }: { children: React.ReactNode }) => <h3 className="mb-2 mt-5 text-sm font-semibold">{children}</h3>;

function Options({ c }: { c: any }) {
  const rows: { label: string; get: (o: any) => React.ReactNode }[] = [
    { label: "Cash remaining", get: o => money(o.cashAfterCents) },
    { label: "Cost to enter", get: o => money(o.costs.entryCents) },
    { label: "Cost to exit (estimate)", get: o => money(o.costs.exitCents) },
    { label: `${c.symbol} weight`, get: o => (o.stockWeightPct === null ? <span className="unknown-pill">unavailable</span> : `${o.stockWeightPct.toFixed(1)}%`) },
    ...[0, 1, 2].map(k => ({ label: `If SPY moves ${pct(c.options[0].scenarios?.[k]?.spyMove * 100, 0)}`, get: (o: any) => { const s = o.scenarios[k]; return s.status === "computed" ? <>{money(s.valueCents)} <span className="text-muted-foreground">({pct(s.changePct)})</span></> : <span className="unknown-pill" title={s.reason}>unavailable</span>; } })),
    { label: "Mandate", get: o => o.mandate.status === "none" ? <span className="unknown-pill">no mandate set</span> : o.mandate.status === "checked" ? `reserve ${o.mandate.reserveOk ? "kept" : "not kept"}; position limit ${o.mandate.positionOk ? "kept" : "not kept"}` : "unavailable" },
  ];
  const cell = (o: any, r: (typeof rows)[number]) => (o.status === "unavailable" ? <span className="unknown-pill" title={o.reason}>unavailable</span> : r.get(o));
  return <>
    <div className="space-y-3 sm:hidden">{c.options.map((o: any) => <div key={o.id} className="rounded-xl border border-border p-3"><h4 className="mb-2 text-sm font-semibold">{o.label}</h4><dl className="divide-y divide-border text-xs tabular-nums">{rows.map(r => <div key={r.label} className="flex items-center justify-between gap-3 py-1.5"><dt className="text-muted-foreground">{r.label}</dt><dd className="text-right">{cell(o, r)}</dd></div>)}</dl></div>)}</div>
    <div className="hidden overflow-x-auto sm:block"><table className="w-full min-w-[460px] text-left text-xs tabular-nums">
      <thead><tr><th className="py-2 pr-3 font-normal text-muted-foreground">Budget {money(c.budgetCents)}</th>{c.options.map((o: any) => <th key={o.id} className="py-2 pr-3 font-semibold">{o.label}</th>)}</tr></thead>
      <tbody>{rows.map(r => <tr key={r.label} className="border-t border-border align-top"><td className="py-2 pr-3 text-muted-foreground">{r.label}</td>{c.options.map((o: any) => <td key={o.id} className="py-2 pr-3">{cell(o, r)}</td>)}</tr>)}</tbody></table></div>
    {c.options.filter((o: any) => o.status === "unavailable").map((o: any) => <p key={o.id} className="mt-2 text-xs text-monitor">{o.label}: {o.reason}</p>)}
    {[...new Set(c.options.flatMap((o: any) => (o.scenarios ?? []).filter((s: any) => s.status === "unavailable").map((s: any) => s.reason)))].map((t: any) => <p key={t} className="mt-2 text-xs text-monitor">Scenarios unavailable: {t}</p>)}
    <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{c.scenarioLabel} {c.valuation ?? ""} Changes are against the starting portfolio of {money(c.start.totalCents)}.</p>
  </>;
}

function Review({ r }: { r: any }) {
  const item = (x: any, body: React.ReactNode) => <li className="border-t border-border py-2.5"><p className="font-medium">{x.question}</p><p className="mt-1 leading-relaxed">{STATUS[x.status] ? <span className="unknown-pill mr-1.5">{STATUS[x.status]}</span> : null}{body}</p></li>;
  return <ul className="text-xs">
    {item(r.business, <>{r.business.text} <span className="text-muted-foreground">Condition: {r.business.condition} (by {r.business.dueBy})</span></>)}
    {item(r.investment, r.investment.status === "computed" ? <>{pct(r.investment.netReturn * 100)} after costs ({money(r.investment.resultCents)}). <span className="text-muted-foreground">{r.investment.text}</span></> : r.investment.text)}
    {item(r.alternatives, r.alternatives.status === "computed" ? <>Stock {money(r.alternatives.stock.resultCents)} · SPY {money(r.alternatives.spy.resultCents)} · keeping the portfolio {money(0)}. <span className="text-muted-foreground">{r.alternatives.text}</span></> : r.alternatives.text)}
    <li className="border-t border-border pt-2 text-muted-foreground">{r.note}</li>
  </ul>;
}

export function DecisionComparePanel({ symbol, caseId }: { symbol: string; caseId: string | null }) {
  const [c, setC] = useState<any>(null), [budget, setBudget] = useState("1000"), [busy, setBusy] = useState(""), [error, setError] = useState("");
  const [meta, setMeta] = useState<any>(null), [checkpoint, setCheckpoint] = useState("quarterly_revenue_yoy"), [opened, setOpened] = useState<any>(null), [saved, setSaved] = useState<any>(null);
  const list = useCallback(async () => { try { const r = await fetch(`/api/decision-snapshot?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" }); if (r.ok) setMeta(await r.json()); } catch { } }, [symbol]);
  useEffect(() => { setC(null); setOpened(null); setSaved(null); list(); }, [symbol, list]);
  const cents = () => Math.round(Number(budget) * 100);
  const guard = useRef(createSaveGuard(() => crypto.randomUUID()));
  async function call(tag: string, url: string, init?: RequestInit) {
    setBusy(tag); setError("");
    try { const r = await fetch(url, init ?? { cache: "no-store" }); const j: any = await r.json(); if (!r.ok) throw new Error(j.error || "Request failed."); return j; }
    catch (e: any) { setError(e.message); return null; } finally { setBusy(""); }
  }
  const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  async function compare() { if (!(cents() >= 100)) { setError("Enter a budget of at least $1."); return; } const j = await call("compare", "/api/decision-compare", post({ symbol, budgetCents: cents() })); if (j) setC(j); }
  async function save() {
    // One request id per comparison on screen, and no second save while one is running: a double click makes one snapshot.
    const g = guard.current; if (!c || !g.begin()) return;
    try { const j = await call("save", "/api/decision-snapshot", post({ action: "save", caseId, requestId: g.idFor(c), budgetCents: c.budgetCents, checkpoint, shown: c })); if (j) { setSaved(j); await list(); await reopen(j.id); } }
    finally { g.end(); }
  }
  async function reopen(id: string) { const j = await call("open", `/api/decision-snapshot?id=${encodeURIComponent(id)}`); if (j) { setOpened(j); setSaved((s: any) => (s?.id === id ? s : null)); } }
  async function record() { const j = await call("review", "/api/decision-snapshot", post({ action: "review", id: opened.id })); if (j) setOpened({ ...opened, review: j.review, recordedReviews: j.recordedReviews }); }
  return (
    <section aria-label="What acting would change" className="company-card text-[13px]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">What acting would change</h2><span className="text-[11px] text-muted-foreground">Practice money{c ? ` · ${money(c.budgetCents)} trade` : ""}</span></div>
      <p className="mb-4 text-[11px] leading-relaxed text-muted-foreground">{c ? <>Price {c.marks?.[symbol] ? `$${c.marks[symbol].close.toFixed(2)} · IEX close ${c.marks[symbol].sessionDate}` : <span className="unknown-pill">no price</span>} · Mandate: {c.options[0]?.mandate?.status === "none" ? <span className="unknown-pill">No mandate set</span> : c.options[0]?.mandate?.text}</> : "Three options from the same practice portfolio and budget, under the same stated market scenarios. Nothing is traded."}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">Budget ($)<input value={budget} onChange={e => setBudget(e.target.value)} inputMode="decimal" className="mt-1 block h-11 w-28 rounded-lg border border-border bg-background px-3 text-sm text-foreground" /></label>
        <button type="button" onClick={compare} disabled={!!busy} className="h-11 rounded-lg border border-border bg-card px-4 text-sm hover:bg-muted disabled:opacity-50">{busy === "compare" ? "Comparing…" : "Compare the three options"}</button>
      </div>
      {error && <p className="mt-2 text-xs text-monitor">{error}</p>}
      {c && <div className="mt-5"><Options c={c} />
        {caseId ? <div className="mt-5 border-t border-border pt-4">
          <p className="text-sm font-medium">Save this decision to review later</p>
          <label className="mt-2 block text-xs text-muted-foreground">One condition to check at the next filing
            <select value={checkpoint} onChange={e => setCheckpoint(e.target.value)} className="mt-1 block h-11 w-full rounded-xl border border-border bg-background px-2 text-sm text-foreground">{Object.entries(meta?.checkpoints ?? { quarterly_revenue_yoy: "Next filing: reported quarterly revenue at or above the same quarter a year earlier." }).map(([k, v]) => <option key={k} value={k}>{String(v)}</option>)}</select></label>
          <button type="button" onClick={save} disabled={!!busy} className="mt-3 inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"><Save size={16} />{busy === "save" ? "Saving…" : "Save snapshot"}</button>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Saved as calculated when you pressed save: the price, what the price assumes, your practice portfolio and the three options are recalculated at that moment, so they can differ from the figures above if anything changed. A saved snapshot is never changed.</p>
        </div> : <p className="mt-3 text-xs text-muted-foreground">A snapshot needs a research case for this company.</p>}
      </div>}
      {meta?.snapshots?.length > 0 && <><H>Saved snapshots</H><ul className="text-xs">{meta.snapshots.map((s: any) => <li key={s.id} className="flex items-center justify-between gap-2 border-t border-border py-1.5"><span>{when(s.savedAt)} · {money(s.budgetCents)} · check by {s.dueBy}</span><button type="button" onClick={() => reopen(s.id)} disabled={!!busy} className="min-h-11 rounded-lg border border-border px-3 hover:bg-muted">Reopen</button></li>)}</ul></>}
      {opened && <div className="mt-5 rounded-xl border border-border p-4">
        <p className="text-sm font-semibold">Snapshot saved {when(opened.snapshot.savedAt)} <span className="font-normal text-muted-foreground">· shown as stored</span></p>
        <p className="mt-1 text-xs text-muted-foreground">Price then: {opened.snapshot.price.value === null ? "unavailable" : `$${opened.snapshot.price.value.toFixed(2)} (IEX close ${opened.snapshot.price.sessionDate})`} · What the price assumed: {opened.snapshot.impliedExpectations.status === "computed" ? (opened.snapshot.impliedExpectations.implied.status === "solved" ? `${opened.snapshot.impliedExpectations.implied.growthPct}% a year` : "outside range") : "unavailable"}</p>
        {saved?.id === opened.id && <div className={`mt-3 text-xs ${saved.check.differences.length ? "diff-box" : ""}`} role="status">
          <p className={`font-semibold ${saved.check.differences.length ? "text-monitor" : ""}`}>Saved as calculated when you pressed save ({when(saved.calculatedAt)})</p>
          <p className={`mt-1 ${saved.check.status === "differs" ? "text-monitor" : "text-muted-foreground"}`}>{saved.check.status === "differs" ? "Differs from the comparison on screen. " : ""}{saved.check.text}</p>
          {saved.check.differences.length > 0 && <table className="mt-1 w-full tabular-nums"><thead><tr className="text-left text-muted-foreground"><th className="pr-2 font-normal">Option</th><th className="pr-2 font-normal">Figure</th><th className="pr-2 font-normal">On screen</th><th className="font-normal">Saved</th></tr></thead>
            <tbody>{saved.check.differences.map((x: any, i: number) => { const f = (v: any) => (typeof v === "number" ? (x.field === "stock weight" ? `${v.toFixed(1)}%` : money(v)) : String(v ?? "—")); return <tr key={i} className="border-t border-border"><td className="pr-2">{x.option}</td><td className="pr-2">{x.field}</td><td className="pr-2">{f(x.shown)}</td><td>{f(x.saved)}</td></tr>; })}</tbody></table>}
        </div>}
        <H>The three options as saved</H><Options c={opened.snapshot.alternatives} />
        <H>Review, computed now</H><Review r={opened.review} />
        <button type="button" onClick={record} disabled={!!busy} className="mt-3 h-11 w-full rounded-lg border border-border text-sm hover:bg-muted disabled:opacity-50">{busy === "review" ? "Recording…" : "Record this review"}</button>
        <p className="mt-1 text-[11px] text-muted-foreground">{opened.recordedReviews.length} review{opened.recordedReviews.length === 1 ? "" : "s"} recorded. Reviews are separate records; the snapshot stays as saved.</p>
      </div>}
    </section>
  );
}
