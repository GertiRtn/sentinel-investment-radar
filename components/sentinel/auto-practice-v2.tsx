"use client";
import { useCallback, useEffect, useState } from "react";

/* auto-practice-v2: a separate virtual experiment with fixed rules (docs/specs/auto-practice-v2-spec-2026-11-15.md). No broker, no real orders. */

const pct = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%` : "—");
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "unknown");
const H = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</h4>;
const COUNT_COLS: [string, string][] = [["assessed", "Cases"], ["researchRules", "Meet rules"], ["goodNews", "+ good news"], ["ordinaryShare", "+ ordinary share"], ["namedInHeadline", "+ named"], ["noPrice", "No price"], ["belowMinPrice", "< $5"], ["priceNotChecked", "Not checked"], ["companyBlocked", "Company blocked"], ["wouldSignal", "Would signal"]];

export function AutoPracticeV2() {
  const [d, setD] = useState<any>(null), [count, setCount] = useState<any>(null), [busy, setBusy] = useState(""), [error, setError] = useState("");
  const load = useCallback(async () => { const r = await fetch("/api/auto-practice-v2", { cache: "no-store" }); const j: any = await r.json(); if (!r.ok) throw new Error(j.error || "Could not load auto-practice-v2."); setD(j); }, []);
  useEffect(() => { load().catch(e => setError(e.message)); }, [load]);
  async function act(action: "start" | "stop" | "run") {
    if (action === "start" && !window.confirm("Start auto-practice-v2? It runs alongside v1 with its own virtual ledger. No real money is involved.")) return;
    setBusy(action); setError("");
    try { const r = await fetch("/api/auto-practice-v2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, requestId: crypto.randomUUID() }) }); const j: any = await r.json(); if (!r.ok) throw new Error(j.error || "Request failed."); setD(j); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  }
  async function countPast() {
    setBusy("count"); setError("");
    try { const r = await fetch("/api/auto-practice-v2?view=count", { cache: "no-store" }); const j: any = await r.json(); if (!r.ok) throw new Error(j.error || "Count failed."); setCount(j); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  }
  const j = d?.judging;
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="font-semibold">auto-practice-v2 (virtual)</h3>
          <p className="text-xs text-muted-foreground">Good-news cases only, priced on adjusted closes over 20 sessions. Runs alongside v1 and never changes it.</p></div>
        {d && <div className="flex flex-wrap gap-2">
          <button onClick={countPast} disabled={!!busy} className="rounded-md border border-border px-3 py-1.5 text-xs">{busy === "count" ? "Counting…" : "Count past cases"}</button>
          {d.status !== "active" ? <button onClick={() => act("start")} disabled={!!busy} className="rounded-md border border-border px-3 py-1.5 text-xs">Start</button>
            : <><button onClick={() => act("run")} disabled={!!busy} className="rounded-md border border-border px-3 py-1.5 text-xs">Check now</button><button onClick={() => act("stop")} disabled={!!busy} className="rounded-md border border-border px-3 py-1.5 text-xs">Stop</button></>}
        </div>}
      </div>
      {error && <p className="text-xs text-amber-300">{error}</p>}
      {d && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Rules ({d.rules.version})</summary><ul className="ml-4 mt-1 list-disc space-y-1">{d.rules.text.map((t: string) => <li key={t}>{t}</li>)}</ul><p className="mt-1">{d.rules.disclaimer}</p></details>}
      {count && <div className="mt-3 overflow-x-auto">
        <H>Past stored cases that would have met the entry rules</H>
        <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th className="pr-2">Month</th>{COUNT_COLS.map(([k, l]) => <th key={k} className="pr-2" title={count.columns?.[k]}>{l}</th>)}</tr></thead>
          <tbody>{[...count.months, count.total].map((m: any) => <tr key={m.month} className="border-t border-border"><td className="pr-2">{m.month}</td>{COUNT_COLS.map(([k]) => <td key={k} className="pr-2">{m[k]}</td>)}</tr>)}</tbody></table>
        <ul className="mt-1 list-disc pl-4 text-[11px] text-muted-foreground">{count.limits.map((l: string) => <li key={l}>{l}</li>)}</ul>
      </div>}
      {d?.status === "not_started" && <p className="mt-2 text-sm text-muted-foreground">Not started. Nothing is recorded until you start it.</p>}
      {d?.experiment && <>
        <p className="mt-2 text-xs text-muted-foreground">{d.status === "active" ? "Running" : "Stopped"} since {when(d.experiment.startedAt)}. Last check: {when(d.lastRun?.at)}.</p>
        <H>Judging</H><p className="text-sm">{j?.text}</p>
        <H>Signal ledger ({d.signalLedger.length})</H>
        {d.signalLedger.length ? <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th className="pr-2">Company</th><th className="pr-2">Assessed</th><th className="pr-2">20-session vs SPY after costs</th><th className="pr-2">Portfolio</th><th className="pr-2">Investment case (shadow)</th></tr></thead>
          <tbody>{d.signalLedger.map((s: any) => <tr key={s.caseId} className="border-t border-border"><td className="pr-2">{s.symbol}</td><td className="pr-2">{when(s.assessedAt)}</td>
            <td className="pr-2">{s.result.status === "priced" ? pct(s.result.excessReturn) : s.result.status === "open" ? "open" : "no price"}</td><td className="pr-2">{s.portfolio}</td>
            <td className="pr-2">{typeof s.shadow.investmentCase === "string" ? s.shadow.investmentCase : s.shadow.investmentCase.verdict === "not_reconstructable" ? "not reconstructable" : s.shadow.investmentCase.text}</td></tr>)}</tbody></table></div>
          : <p className="text-xs text-muted-foreground">No signals yet.</p>}
        <H>Compared against</H>
        <ul className="space-y-1 text-xs"><li>{d.comparison.main.label}: {d.comparison.main.cases} cases, average {pct(d.comparison.main.averageExcess)}</li>
          {d.comparison.secondary.map((r: any) => <li key={r.label} className="text-muted-foreground">{r.label}: {r.cases}, average {pct(r.averageExcess ?? r.average)}</li>)}</ul>
        <H>Virtual portfolio (realism check)</H>
        <p className="text-xs text-muted-foreground">{d.portfolio.open.length} open, {d.portfolio.closed.length} closed, {d.portfolio.notTaken.length} not taken. {d.portfolio.note}</p>
      </>}
    </div>
  );
}
