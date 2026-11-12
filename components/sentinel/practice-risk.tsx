"use client";
import { useState } from "react";

/* Practice risk check: on demand, simulated, virtual positions only. */

const usd = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v) : "—");
const pct = (v: number | null | undefined, d = 1) => (typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(d)}%` : "—");
const Unavailable = ({ children }: { children: React.ReactNode }) => <p className="text-sm"><span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-xs font-semibold">Unavailable</span><span className="text-muted-foreground">{children}</span></p>;

export function PracticeRisk() {
  const [r, setR] = useState<any>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function run() {
    setBusy(true); setError("");
    try { const res = await fetch("/api/practice-risk", { cache: "no-store" }); const j: any = await res.json(); if (!res.ok) throw new Error(j.error || "Risk check failed."); setR(j); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  const sim = r?.simulation, conc = r?.concentration;
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div><h3 className="font-semibold">Risk check (simulated)</h3><p className="text-xs text-muted-foreground">Concentration, data coverage and a seeded simulation of your open practice positions. Runs only when you click.</p></div>
        <button onClick={run} disabled={busy} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">{busy ? "Running…" : r ? "Run again" : "Run risk check"}</button>
      </div>
      {error && <p className="text-sm text-amber-200" role="alert">{error}</p>}
      {r && <div className="space-y-4 text-sm">
        <section><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Concentration</h4>
          {conc.status !== "ok" ? <Unavailable>{conc.reason}</Unavailable> : <>
            <p>Largest position {conc.largest ? `${conc.largest.symbol} ${pct(conc.largest.weight * 100)}` : "—"} · cash {pct(conc.cashWeight * 100)} · effective number of positions {conc.effectivePositions ? conc.effectivePositions.toFixed(1) : "—"}</p>
            {conc.flags.map((f: string) => <p key={f} className="text-xs text-amber-200">{f}</p>)}
          </>}
        </section>
        <section><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Data coverage</h4>
          {r.positions === 0 ? <Unavailable>No open practice positions.</Unavailable> : <>
            <p className="text-xs">{r.coverage.jointSessions} shared trading days{r.coverage.from ? ` (${r.coverage.from} → ${r.coverage.to})` : ""}; at least {r.config.minSessions} needed.</p>
            <ul className="text-xs text-muted-foreground">{r.coverage.per.map((p: any) => <li key={p.symbol}>{p.symbol}: {p.closes} daily closes {p.first ? `(${p.first} → ${p.last})` : ""}{r.coverage.short.includes(p.symbol) ? " — not enough" : ""}</li>)}</ul>
            {r.problems.map((p: string) => <p key={p} className="text-xs text-amber-200">{p}</p>)}
          </>}
        </section>
        <section><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Simulated {r.config.horizonSessions}-session outcome</h4>
          {sim.status !== "ok" ? <Unavailable>{sim.reason}</Unavailable> : <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div><div className="text-xs text-muted-foreground">VaR {pct(sim.confidence * 100, 0)}</div><div className="text-lg font-semibold tabular-nums">{usd(sim.varUsd)}</div><div className="text-xs text-muted-foreground">{pct(sim.varPct)} of {usd(sim.startUsd)}</div></div>
              <div><div className="text-xs text-muted-foreground">Expected shortfall</div><div className="text-lg font-semibold tabular-nums">{usd(sim.esUsd)}</div><div className="text-xs text-muted-foreground">{pct(sim.esPct)} average in the worst {pct((1 - sim.confidence) * 100, 0)}</div></div>
              <div><div className="text-xs text-muted-foreground">Median path</div><div className="text-lg font-semibold tabular-nums">{usd(sim.percentilesUsd["0.5"])}</div><div className="text-xs text-muted-foreground">5th–95th: {usd(sim.percentilesUsd["0.05"])} to {usd(sim.percentilesUsd["0.95"])}</div></div>
              <div><div className="text-xs text-muted-foreground">Portfolio volatility</div><div className="text-lg font-semibold tabular-nums">{pct(sim.portfolioAnnualisedVolPct)}</div><div className="text-xs text-muted-foreground">annualised, from {sim.history.sessions} days</div></div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{sim.paths.toLocaleString()} paths · seed {sim.seed} · history {sim.history.from} → {sim.history.to} · USD profit/loss on today's positions.</p>
            {sim.correlation.symbols.length > 1 && <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted-foreground">Volatility and correlation used</summary>
              <table className="mt-1 tabular-nums"><thead><tr><th></th>{sim.correlation.symbols.map((s: string) => <th key={s} className="px-2 font-normal">{s}</th>)}<th className="px-2 font-normal">ann. vol</th></tr></thead>
                <tbody>{sim.correlation.symbols.map((s: string, i: number) => <tr key={s}><td className="pr-2">{s}</td>{sim.correlation.matrix[i].map((c: number, j: number) => <td key={j} className="px-2">{Number.isFinite(c) ? c.toFixed(2) : "—"}</td>)}<td className="px-2">{pct(sim.annualisedVolPct[s])}</td></tr>)}</tbody></table></details>}
          </>}
        </section>
        {r.stresses.length > 0 && <section><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Illustrative stresses</h4>
          <ul className="text-xs">{r.stresses.map((s: any) => <li key={s.name}>{s.name}: {s.lossUsd === null ? <span className="text-muted-foreground">unavailable</span> : <span className="font-semibold tabular-nums">−{usd(s.lossUsd)} ({pct(s.lossPct)})</span>} <span className="text-muted-foreground">— {s.note}</span></li>)}</ul></section>}
        <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Assumptions and limits</summary><ul className="mt-1 list-disc pl-5 text-muted-foreground">{r.assumptions.map((a: string) => <li key={a}>{a}</li>)}<li>{r.source}; prices fetched on request and archived.</li></ul></details>
        <p className="text-[11px] text-muted-foreground">{r.note}</p>
      </div>}
    </div>
  );
}
