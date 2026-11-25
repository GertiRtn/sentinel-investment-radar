"use client";
import { useEffect, useState } from "react";
import { ChevronDown, Download, RefreshCw } from "lucide-react";

/* What the price assumes (implied-expectations-v3). A reading of the price under stated illustrative assumptions:
   not a forecast, no value for the shares, no verdict. No green or red: nothing here is good or bad by itself.
   Layout ported 2026-11-17 from the Lovable prototype (DecisionPanels.tsx, commit 7b5ec85). Every state, reason and
   figure is the API's own text; the prototype's sample states, "Value per share" table and simulated buttons were
   not ported. */

const usd = (v: number | null | undefined) => (typeof v !== "number" ? "unavailable" : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const pct = (g: number | null | undefined, digits = 1) => (typeof g === "number" ? `${g >= 0 ? "+" : ""}${(g * 100).toFixed(digits)}%` : "—");
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "unknown date");

function Fold({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className="mt-5 border-t border-border pt-4"><button type="button" className="flex min-h-11 w-full items-center justify-between text-left text-sm font-medium" aria-expanded={open} onClick={() => setOpen(!open)}>{title}<ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} /></button>{open && <div className="mt-3 text-xs leading-relaxed">{children}</div>}</div>;
}
/** "Checks not run: a, b." → the label in bold, as in the design. The text itself is the API's. */
function ChecksNotRun({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  const m = text.match(/^(Checks not run:)\s*(.*)$/);
  return <p className="checks-box mt-3">{m ? <><span className="font-semibold text-foreground">{m[1]}</span> {m[2]}</> : text}</p>;
}
const H3 = ({ children }: { children: React.ReactNode }) => <h3 className="mb-1 mt-3 font-semibold first:mt-0">{children}</h3>;

export function ImpliedExpectationsPanel({ symbol }: { symbol: string }) {
  const [r, setR] = useState<any>(undefined), [error, setError] = useState(""), [loading, setLoading] = useState(""), [tick, setTick] = useState(0);
  useEffect(() => { setR(undefined); setError(""); fetch(`/api/implied-expectations?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" }).then(async x => { const j: any = await x.json(); if (!x.ok) throw new Error(j.error || "Could not load."); setR(j); }).catch(e => { setR(null); setError(e.message); }); }, [symbol, tick]);
  async function loadShares() {
    setLoading("Loading SEC data…");
    try { const x = await fetch("/api/implied-expectations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "backfill", symbol }) }); const j: any = await x.json(); if (!x.ok) throw new Error(j.error || "SEC data could not be loaded.");
      const failed = j.results.filter((q: any) => q.status === "failed"); setLoading(failed.length ? failed.map((q: any) => `${q.company}: ${q.message}`).join(" ") : `Loaded ${j.processed} compan${j.processed === 1 ? "y" : "ies"}${j.remaining ? `; ${j.remaining} more to load` : ""}.`); setTick(t => t + 1); }
    catch (e: any) { setLoading(e.message); }
  }
  // The SEC data was read before the current fact parser: the calculation may still run, with some checks not run.
  const stale = !!r && r.canLoadShareCounts === true && r.sec?.state === "loaded" && r.sec.parserCurrent === false;
  const canLoad = !!r && (stale || r.sec?.state === "not_loaded" || r.sec?.state === "failed");
  const busy = loading === "Loading SEC data…";
  const loadControl = canLoad && <div className="mb-5 mt-4">
    {stale && r.status !== "unavailable" && <p className="mb-2 text-xs text-muted-foreground">This company’s SEC data was read with an older version of the reader. Loading it again lets the checks above run.</p>}
    <button type="button" onClick={loadShares} disabled={busy} className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm hover:bg-muted disabled:opacity-50">{r.sec?.state === "failed" ? <><RefreshCw size={16} className={busy ? "animate-spin" : ""} />Try the SEC read again</> : <><Download size={16} />Load share counts</>}</button>
    {loading && <p className="mt-2 text-[11px] text-muted-foreground" role="status">{loading}</p>}
  </div>;
  return (
    <section aria-label="What the price assumes" className="company-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">What the price assumes</h2><span className="text-[11px] text-muted-foreground">Illustrative assumptions</span></div>
      {r === undefined ? <p className="text-sm text-muted-foreground">Loading…</p> : !r ? <div className="state-box"><span className="unknown-pill">Unavailable</span><p className="mt-3 text-sm font-medium">{error || "Could not load."}</p></div> : <>
        {r.status === "unavailable" ? <div className="state-box">
          <span className="unknown-pill">Unavailable</span>
          {/* Every reason, as the API wrote it. The first is the headline; nothing is estimated in its place. */}
          <p className="mt-3 text-sm font-medium leading-relaxed">{r.missing[0]}</p>
          {r.missing.length > 1 && <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">{r.missing.slice(1).map((m: string) => <li key={m}>{m}</li>)}</ul>}
          <p className="mt-2 text-xs text-muted-foreground">The calculation needs every input above. Nothing is estimated in its place.</p>
        </div> : <>
          {r.implied.status === "solved"
            ? <p className="text-[22px] font-semibold leading-snug">{r.implied.text}</p>
            : <><p className="text-[22px] font-semibold leading-snug">Outside range</p><p className="mt-1 text-sm">{r.implied.text}</p></>}
          <p className="mt-2 text-[11px] text-muted-foreground">{r.marketValue.price.source} · shares from the cover page of {r.marketValue.shares.form} filed {r.marketValue.shares.filed} · cash flow for the year to {r.baseCashFlow.periodEnd} · as of {day(r.asOf)}</p>
          {r.baseCashFlow.capexNote && <p className="mt-1 text-[11px] text-muted-foreground">{r.baseCashFlow.capexNote}</p>}
        </>}
        <ChecksNotRun text={r.notRun?.text} />
        {loadControl}
        {/* Checks that ran and found nothing, or a small amount (e.g. "not reported"), stay in view, not only in the fold. */}
        {r.caveats.filter((c: any) => /_checked$/.test(c.id)).length > 0 && <ul className="mt-2 space-y-0.5 text-[11px] leading-relaxed text-muted-foreground">{r.caveats.filter((c: any) => /_checked$/.test(c.id)).map((c: any) => <li key={c.id}>{c.text}</li>)}</ul>}
        <p className="mt-4 text-xs"><span className="font-medium">Does reality differ from what the price assumes?</span> <span className="text-muted-foreground">{r.opportunity.text}</span></p>
        <Fold title="How this was worked out">
          {r.status === "computed" && <>
            <H3>Inputs</H3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-muted-foreground">
              <dt>Market value</dt><dd className="text-foreground">{usd(r.marketValue.value)} = ${r.marketValue.price.value.toFixed(2)} × {r.marketValue.shares.value.toLocaleString("en-US")} shares</dd>
              <dt>Price</dt><dd>{r.marketValue.price.source}{r.marketValue.price.ageDays ? ` · ${r.marketValue.price.ageDays} days old` : ""}</dd>
              <dt>Shares</dt><dd>Cover page {r.marketValue.shares.coverDate} · {r.marketValue.shares.form} filed {r.marketValue.shares.filed} · {r.marketValue.shares.ageDays} days old{r.marketValue.shares.stale ? " (old)" : ""}</dd>
              <dt>Cash flow</dt><dd>{usd(r.baseCashFlow.value)} = operating cash flow {usd(r.baseCashFlow.cfo)} − capital expenditure {usd(r.baseCashFlow.capex)} (calculated) · year to {r.baseCashFlow.periodEnd} · filed {r.baseCashFlow.filed}{r.baseCashFlow.capexTag ? ` · capital expenditure tag ${r.baseCashFlow.capexTag} (${r.baseCashFlow.capexTagList})` : ""}</dd>
              <dt>Net debt</dt><dd>{r.netDebtContext.value === null ? r.netDebtContext.note : `${usd(r.netDebtContext.value)} (context only; not part of the calculation)`}</dd>
            </dl>
            <H3>Under other assumptions (implied growth a year)</H3>
            <div className="overflow-x-auto"><table className="w-full text-left tabular-nums"><thead><tr className="text-muted-foreground"><th className="py-1.5 pr-3 font-normal">Discount rate ↓ / growth after year {r.assumptions.years} →</th>{r.sensitivity.terminalGrowth.map((t: number) => <th key={t} className="py-1.5 pr-3 font-normal">{(t * 100).toFixed(0)}%</th>)}</tr></thead>
              <tbody>{r.sensitivity.discount.map((d: number) => <tr key={d} className="border-t border-border"><td className="py-1.5 pr-3 text-muted-foreground">{(d * 100).toFixed(0)}%</td>{r.sensitivity.terminalGrowth.map((t: number) => { const c = r.sensitivity.cells.find((x: any) => x.discount === d && x.terminalGrowth === t); return <td key={t} className="py-1.5 pr-3">{c.growth === null ? "outside range" : pct(c.growth)}</td>; })}</tr>)}</tbody></table></div>
          </>}
          <H3>Reported history (not a forecast)</H3>
          {r.history.rows.length ? <table className="w-full tabular-nums"><tbody>{r.history.rows.map((h: any) => <tr key={h.periodEnd} className="border-t border-border"><td className="py-1.5 pr-3 text-muted-foreground">Year to {h.periodEnd}</td><td className="pr-3">{h.value === null ? "unavailable" : usd(h.value)}</td><td className="text-muted-foreground">{h.changePct !== null ? pct(h.changePct / 100) : h.changeNote}</td></tr>)}</tbody></table> : <p className="text-muted-foreground">No reported annual cash flow is stored.</p>}
          <H3>Basis</H3><p className="text-muted-foreground">{r.basis.text}</p>
          <H3>Assumptions</H3><p className="text-muted-foreground">Discount rate {(r.assumptions.discount * 100).toFixed(0)}%, growth after year {r.assumptions.years} of {(r.assumptions.terminalGrowth * 100).toFixed(0)}%. {r.assumptions.label}</p>
          <H3>Caveats</H3>
          <ul className="list-disc space-y-1 pl-4 text-muted-foreground"><li>{r.leverage.text}</li>{r.caveats.map((c: any) => <li key={c.id}>{c.text}</li>)}</ul>
          <p className="mt-3 text-muted-foreground">{r.limitations}</p>
        </Fold>
      </>}
    </section>
  );
}
