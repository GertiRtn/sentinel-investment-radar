"use client";
import { useEffect, useState } from "react";

/* What the price assumes (implied-expectations-v1). A reading of the price under stated illustrative assumptions:
   not a forecast, no value for the shares, no verdict. No green or red: nothing here is good or bad by itself. */

const usd = (v: number | null | undefined) => (typeof v !== "number" ? "unavailable" : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const pct = (g: number | null | undefined, digits = 1) => (typeof g === "number" ? `${g >= 0 ? "+" : ""}${(g * 100).toFixed(digits)}%` : "—");

export function ImpliedExpectationsPanel({ symbol }: { symbol: string }) {
  const [r, setR] = useState<any>(undefined), [error, setError] = useState(""), [loading, setLoading] = useState(""), [tick, setTick] = useState(0);
  useEffect(() => { setR(undefined); setError(""); fetch(`/api/implied-expectations?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" }).then(async x => { const j: any = await x.json(); if (!x.ok) throw new Error(j.error || "Could not load."); setR(j); }).catch(e => { setR(null); setError(e.message); }); }, [symbol, tick]);
  async function loadShares() {
    setLoading("Loading SEC data…");
    try { const x = await fetch("/api/implied-expectations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "backfill", symbol }) }); const j: any = await x.json(); if (!x.ok) throw new Error(j.error || "SEC data could not be loaded.");
      const failed = j.results.filter((q: any) => q.status === "failed"); setLoading(failed.length ? failed.map((q: any) => `${q.company}: ${q.message}`).join(" ") : `Loaded ${j.processed} compan${j.processed === 1 ? "y" : "ies"}${j.remaining ? `; ${j.remaining} more to load` : ""}.`); setTick(t => t + 1); }
    catch (e: any) { setLoading(e.message); }
  }
  return (
    <section aria-label="What the price assumes" className="rounded-3xl border border-border bg-card/60 p-6 text-[13px]">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">What the price assumes</h2><span className="rounded-md bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">Illustrative assumptions</span></div>
      {r === undefined ? <p className="text-muted-foreground">Loading…</p> : !r ? <p className="text-muted-foreground">Unavailable: {error || "could not load"}</p> : <>
        {r.status === "unavailable" ? <>
          <p className="text-base font-semibold">Unavailable</p>
          {r.notRun?.text && <p className="mt-1 text-xs text-amber-200">{r.notRun.text}</p>}
          <p className="mt-1 text-muted-foreground">The calculation needs every input below. Nothing is estimated in its place.</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">{r.missing.map((m: string) => <li key={m}>{m}</li>)}</ul>
          {(r.canLoadShareCounts || r.sec?.state === "not_loaded" || r.sec?.state === "failed") && <button type="button" onClick={loadShares} disabled={loading === "Loading SEC data…"} className="mt-3 min-h-11 w-full rounded-xl border border-border text-sm hover:bg-muted disabled:opacity-50">{r.sec?.state === "failed" ? "Try the SEC read again" : "Load share counts"}</button>}
          {loading && <p className="mt-1 text-xs text-muted-foreground" role="status">{loading}</p>}
        </> : <>
          {r.implied.status === "solved" ? <><p className="text-3xl font-semibold tabular-nums">{pct(r.implied.growth)} <span className="text-sm font-normal text-muted-foreground">implied growth a year, {r.assumptions.years} years</span></p><p className="mt-2">{r.implied.text}</p></>
            : <><p className="text-base font-semibold">Outside range</p><p className="mt-1">{r.implied.text}</p></>}
          {r.notRun?.text && <p className="mt-2 text-xs text-amber-200">{r.notRun.text} <span className="text-muted-foreground">See basis and caveats below.</span></p>}
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">Market value</dt><dd>{usd(r.marketValue.value)} = ${r.marketValue.price.value.toFixed(2)} × {r.marketValue.shares.value.toLocaleString("en-US")} shares</dd>
            <dt className="text-muted-foreground">Price</dt><dd>{r.marketValue.price.source}{r.marketValue.price.ageDays ? ` · ${r.marketValue.price.ageDays} days old` : ""}</dd>
            <dt className="text-muted-foreground">Shares</dt><dd>Cover page {r.marketValue.shares.coverDate} · {r.marketValue.shares.form} filed {r.marketValue.shares.filed} · {r.marketValue.shares.ageDays} days old{r.marketValue.shares.stale ? " (old)" : ""}</dd>
            <dt className="text-muted-foreground">Cash flow</dt><dd>{usd(r.baseCashFlow.value)} = operating cash flow {usd(r.baseCashFlow.cfo)} − capital expenditure {usd(r.baseCashFlow.capex)} (calculated) · year to {r.baseCashFlow.periodEnd} · filed {r.baseCashFlow.filed}</dd>
            <dt className="text-muted-foreground">Net debt</dt><dd>{r.netDebtContext.value === null ? r.netDebtContext.note : `${usd(r.netDebtContext.value)} (context only; not part of the calculation)`}</dd>
          </dl>
          <h3 className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Under other assumptions</h3>
          <table className="w-full text-xs tabular-nums"><thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-2 font-normal">Discount rate ↓ · growth after year {r.assumptions.years} →</th>{r.sensitivity.terminalGrowth.map((t: number) => <th key={t} className="pr-2 font-normal">{(t * 100).toFixed(0)}%</th>)}</tr></thead>
            <tbody>{r.sensitivity.discount.map((d: number) => <tr key={d} className="border-t border-border"><td className="py-1 pr-2 text-muted-foreground">{(d * 100).toFixed(0)}%</td>{r.sensitivity.terminalGrowth.map((t: number) => { const c = r.sensitivity.cells.find((x: any) => x.discount === d && x.terminalGrowth === t); return <td key={t} className="pr-2">{c.growth === null ? "outside range" : pct(c.growth)}</td>; })}</tr>)}</tbody></table>
        </>}
        <h3 className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Reported history (not a forecast)</h3>
        {r.history.rows.length ? <table className="w-full text-xs tabular-nums"><tbody>{r.history.rows.map((h: any) => <tr key={h.periodEnd} className="border-t border-border"><td className="py-1 pr-2 text-muted-foreground">Year to {h.periodEnd}</td><td className="pr-2">{h.value === null ? "unavailable" : usd(h.value)}</td><td className="text-muted-foreground">{h.changePct !== null ? pct(h.changePct / 100) : h.changeNote}</td></tr>)}</tbody></table> : <p className="text-xs text-muted-foreground">No reported annual cash flow is stored.</p>}
        <p className="mt-3 text-xs"><span className="font-medium">Does reality differ from what the price assumes?</span> <span className="text-muted-foreground">{r.opportunity.text}</span></p>
        <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">Basis, assumptions and caveats</summary>
          <p className="mt-2">{r.basis.text}</p>
          <p className="mt-1">Discount rate {(r.assumptions.discount * 100).toFixed(0)}%, growth after year {r.assumptions.years} of {(r.assumptions.terminalGrowth * 100).toFixed(0)}%. {r.assumptions.label}</p>
          <p className="mt-1">{r.leverage.text}</p>
          <ul className="mt-1 list-disc pl-4">{r.caveats.map((c: any) => <li key={c.id}>{c.text}</li>)}</ul>
          <p className="mt-1">{r.limitations}</p>
        </details>
      </>}
    </section>
  );
}
