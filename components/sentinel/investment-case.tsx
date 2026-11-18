"use client";
import { useEffect, useState } from "react";

/* Investment case: research prototype (investment-case-v1). Research priority only; never a statement that the
   price is attractive. Not used for notifications, rankings or experiments. No green: supported is shown in blue. */

const STATE: Record<string, { label: string; tone: string }> = {
  supported: { label: "Supported", tone: "border-sky-400/40 text-sky-200" }, contradicted: { label: "Contradicted", tone: "border-amber-400/40 text-amber-200" },
  not_established: { label: "Not established", tone: "border-border text-muted-foreground" }, not_applicable: { label: "Not applicable", tone: "border-border text-muted-foreground" },
};
const COND: Record<string, string> = { met: "✓ met", not_met: "– not met", concern: "! concern", unknown: "? unknown", not_applicable: "n/a" };
const CHECK: Record<string, string> = { supported: "Supported", concern: "Concern", unavailable: "Unavailable", not_checked: "Not checked", not_applicable: "Not applicable" };

export function InvestmentCasePanel({ caseId }: { caseId: string }) {
  const [r, setR] = useState<any>(undefined), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { setR(undefined); fetch(`/api/investment-case?case=${encodeURIComponent(caseId)}`, { cache: "no-store" }).then(x => x.json()).then((j: any) => setR(j.investmentCase ?? null)).catch(() => setR(null)); }, [caseId]);
  async function assess() {
    setBusy(true); setError("");
    try { const x = await fetch("/api/investment-case", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseId }) }); const j: any = await x.json(); if (!x.ok) throw new Error(j.error || "The assessment could not run."); setR(j.investmentCase); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <section aria-label="Investment case" className="company-card text-[13px]">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Investment case</h2><span className="rounded-md bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">Research prototype</span></div>
      {r === undefined ? <p className="text-muted-foreground">Loading…</p> : !r ? <>
        <p className="text-muted-foreground">Not assessed yet. Sentinel checks the business evidence known when this case was assessed and says what it supports. It does not judge the price.</p>
        <button type="button" onClick={assess} disabled={busy} className="mt-3 min-h-11 w-full rounded-xl border border-border text-sm hover:bg-muted disabled:opacity-50">{busy ? "Checking the evidence…" : "Assess the investment case"}</button>
        {error && <p className="mt-2 text-xs text-amber-200">{error}</p>}
      </> : <>
        <p className="text-base font-semibold">{r.verdict.text}</p>
        <p className="mt-1 text-xs text-muted-foreground">{r.verdict.why}</p>
        <p className="mt-3 rounded-lg bg-muted/50 p-2 text-xs"><span className="font-medium">Price opportunity: not established.</span> <span className="text-muted-foreground">{r.priceOpportunity.why}</span></p>
        <ul className="mt-3 space-y-2">{r.mechanisms.map((m: any) => (
          <li key={m.id}><details>
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2"><span>{m.label}</span><span className={`rounded-md border px-1.5 py-0.5 text-[10px] ${STATE[m.state]?.tone ?? ""}`}>{STATE[m.state]?.label ?? m.state}{m.conditions.length ? ` · ${m.supportedCount}/${m.conditions.length}` : ""}</span></summary>
            <ul className="mt-1 space-y-1 pl-3 text-[11px] text-muted-foreground">{m.conditions.map((c: any, k: number) => <li key={k}><span className="font-medium text-foreground">{COND[c.status]}</span> {c.label}: {c.detail}</li>)}
              {m.note && <li>{m.note}</li>}{m.missing.length > 0 && <li>Still missing: {m.missing.join("; ")}.</li>}</ul>
          </details></li>))}</ul>
        {r.concerns.length > 0 && <p className="mt-3 text-xs"><span className="font-medium">Confirmed concerns:</span> {r.concerns.join(", ")}.</p>}
        {r.characteristics.some((c: any) => c.state === "flagged") && <p className="mt-1 text-xs"><span className="font-medium">Characteristics:</span> {r.characteristics.filter((c: any) => c.state === "flagged").map((c: any) => c.label).join(", ")}.</p>}
        <details className="mt-3 text-[11px] text-muted-foreground"><summary className="cursor-pointer">All checks, gaps and basis</summary>
          <ul className="mt-1 space-y-1">{r.checks.map((c: any) => <li key={c.id}><span className="text-foreground">{c.label}: {CHECK[c.state]}</span> · {c.text}{c.source ? ` (${c.source})` : ""}</li>)}</ul>
          <ul className="mt-2 space-y-1">{r.characteristics.map((c: any) => <li key={c.id}>{c.label}: {c.text}</li>)}</ul>
          <p className="mt-2">Data as known on {String(r.asOf).slice(0, 10)}{r.retrospective ? `, computed later on ${String(r.computedAt).slice(0, 10)} (retrospective)` : ""}. {r.use}</p>
        </details>
      </>}
    </section>
  );
}
