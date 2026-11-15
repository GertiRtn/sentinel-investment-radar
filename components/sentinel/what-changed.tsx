"use client";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { ThesisPanel } from "./thesis-panel";
import { CaseOverview } from "./case-overview";

/* "What changed?" in the case sheet: event, sourced business changes, risks, valuation, price context, gaps. */

const when = (iso: string | null | undefined) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "unknown");
const pct = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` : "—");
const KIND: Record<string, [string, string]> = {
  reported_claim: ["Reported claim", "bg-amber-400/15 text-amber-200"],
  fact: ["SEC fact", "bg-sky-400/15 text-sky-200"],
  computed: ["Computed", "bg-slate-400/15 text-slate-200"],
  interpretation: ["Rule reading", "bg-violet-400/15 text-violet-200"],
  missing: ["Missing", "bg-muted text-muted-foreground"],
};
function Tag({ kind }: { kind: string }) { const [l, c] = KIND[kind] ?? [kind, "bg-muted"]; return <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${c}`}>{l}</span>; }
function Src({ item }: { item: any }) {
  if (!item) return null;
  return item.source?.url ? <a className="inline-flex items-center gap-0.5 underline" href={item.source.url} target="_blank" rel="noreferrer">{item.source.accession ?? "source"}<ExternalLink size={10} /></a> : <span>{item.source?.name ?? "source unknown"}</span>;
}
function Unavailable({ children }: { children: React.ReactNode }) { return <p className="text-xs"><span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 font-semibold">Unavailable</span><span className="text-muted-foreground">{children}</span></p>; }

function ChangeTable({ rows }: { rows: any[] }) {
  if (!rows.length) return <Unavailable>No sourced SEC figures were recorded for this company by the case time.</Unavailable>;
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-muted-foreground"><tr><th className="py-1 font-normal">Measure</th><th className="font-normal">Latest</th><th className="font-normal">Compared with</th><th className="font-normal">Change</th><th className="font-normal">Source</th></tr></thead>
      <tbody className="divide-y divide-border">{rows.map(r => (
        <tr key={r.latest.id} className="align-top">
          <td className="py-1.5 pr-2">{r.label}{r.latest.stale && <span className="ml-1 rounded bg-amber-400/20 px-1">stale</span>}</td>
          <td className="pr-2 tabular-nums">{r.latest.display}<div className="text-muted-foreground">to {r.latest.period?.end}</div></td>
          <td className="pr-2 tabular-nums">{r.prior ? <>{r.prior.display}<div className="text-muted-foreground">{r.comparison}, to {r.prior.period?.end}</div></> : "—"}</td>
          <td className="pr-2 tabular-nums">{r.changePct !== null ? pct(r.changePct) : <span className="text-muted-foreground" title={r.note ?? ""}>—</span>}{r.note && <div className="text-[10px] text-muted-foreground">{r.note}</div>}</td>
          <td className="text-muted-foreground"><Src item={r.latest} /><div>filed {r.latest.sourceTime ? String(r.latest.sourceTime).slice(0, 10) : "unknown"}</div></td>
        </tr>))}</tbody>
    </table>
  );
}

function PriceWindow({ w, symbol }: { w: any; symbol: string }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="flex items-center justify-between text-xs"><span className="font-medium">{w.label}</span><span className={`rounded px-1.5 py-0.5 text-[10px] ${w.knownAtCaseTime ? "bg-sky-400/15 text-sky-200" : "bg-amber-400/15 text-amber-200"}`}>{w.knownAtCaseTime ? "Known at case time" : "After the case — not part of its assessment"}</span></div>
      <div className="mt-1 grid grid-cols-3 gap-2 text-xs tabular-nums">
        <div>{symbol} <span className="font-semibold">{pct(w.stockPct)}</span><div className="text-muted-foreground">${w.stockFrom.toFixed(2)} → ${w.stockTo.toFixed(2)}</div></div>
        <div>SPY <span className="font-semibold">{pct(w.spyPct)}</span><div className="text-muted-foreground">${w.spyFrom.toFixed(2)} → ${w.spyTo.toFixed(2)}</div></div>
        <div>vs SPY <span className="font-semibold">{pct(w.vsSpyPct)}</span><div className="text-muted-foreground">{w.from} → {w.to} closes</div></div>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">{w.note}</p>
    </div>
  );
}

const TONE: Record<string, string> = { research: "border-sky-400/40 bg-sky-400/10", watch: "border-border bg-muted/40", wait: "border-border bg-muted/40", doubt: "border-amber-400/50 bg-amber-400/10" };
const usd0 = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
function Lines({ items, sign }: { items: any[]; sign: string }) {
  if (!items.length) return <p className="text-xs text-muted-foreground">Nothing supported by the stored records.</p>;
  return <ul className="space-y-1 text-xs">{items.map((l: any, i: number) => <li key={i}><Tag kind={l.kind} /><span className={sign === "+" ? "text-sky-300" : "text-amber-300"}>{sign}</span> {l.text}{l.detail && <span className="text-muted-foreground"> — {l.detail}</span>}</li>)}</ul>;
}
/* The idea in brief: Sentinel's rule-based view, why now, for, against, missing, and fit with Practice holdings. */
export function IdeaCard({ idea }: { idea: any }) {
  const f = idea.fit, m = idea.eventMatch;
  return (
    <div className="space-y-3 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">The idea in brief</h4><span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{idea.ideaType.type} · rules only, no AI</span></div>
      <div className={`rounded-md border p-2.5 ${TONE[idea.view.tone] ?? TONE.wait}`}>
        <div className="font-semibold">Sentinel’s view: {idea.view.label}</div>
        <p className="mt-0.5 text-xs">{idea.view.text}</p>
        <p className="mt-1 text-xs text-muted-foreground">Checklist: {idea.view.uncertainty}</p>
      </div>
      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <div><span className="text-muted-foreground">Security:</span> {idea.security.text}</div>
        <div><span className="text-muted-foreground">Is the news about this company?</span> <span className={m.confirmed ? "" : "text-amber-200"}>{m.label}</span>{!m.confirmed && <span className="text-muted-foreground"> — {m.reason}</span>}</div>
      </div>
      <section><h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Why now</h5>
        <ul className="space-y-1 text-xs">{idea.whyNow.map((l: any, i: number) => <li key={i}><Tag kind={l.kind} />{l.text}{l.detail && <span className="text-muted-foreground"> — {l.detail}</span>}</li>)}</ul></section>
      <div className="grid gap-3 sm:grid-cols-2">
        <section><h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What supports it</h5><Lines items={idea.evidenceFor} sign="+" /></section>
        <section><h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What could be wrong</h5><Lines items={idea.counter} sign="−" /></section>
      </div>
      <section><h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Fit with your portfolio</h5>
        {f.status !== "known" ? <Unavailable>{f.reason}</Unavailable> : <p className="text-xs">
          {f.heldInPractice ? "You already hold this in Practice. " : "Not in your Practice portfolio. "}{f.heldInExperiment ? "The automated experiment holds it. " : ""}
          {f.openPositions} open position{f.openPositions === 1 ? "" : "s"}, {usd0(f.cashCents)} virtual cash.{f.weightIfAddedPct !== null ? ` A ${usd0(f.standardPositionCents)} position would be about ${f.weightIfAddedPct.toFixed(0)}% of the portfolio.` : ""}
          <span className="text-muted-foreground"> {f.note}</span></p>}
      </section>
      <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">What Sentinel does not know ({idea.missing.length})</summary>
        <ul className="mt-1 list-disc pl-5 text-muted-foreground">{idea.missing.map((x: string) => <li key={x}>{x}</li>)}</ul></details>
      <p className="text-[10px] text-muted-foreground">{idea.ideaType.horizon} {idea.ideaType.note} {idea.view.basis}</p>
    </div>
  );
}

export function WhatChanged({ caseId, symbol }: { caseId: string; symbol: string }) {
  const [d, setD] = useState<any>(null), [error, setError] = useState(""), [loadingPrice, setLoadingPrice] = useState(false);
  const load = useCallback(async (prices: boolean) => {
    const r = await fetch(`/api/case-context?case=${encodeURIComponent(caseId)}${prices ? "&prices=1" : ""}`, { cache: "no-store" });
    const j: any = await r.json(); if (!r.ok) throw new Error(j.error || "Case context could not be loaded."); setD(j);
  }, [caseId]);
  useEffect(() => { setD(null); setError(""); load(false).catch(e => setError(e.message)); }, [load]);
  async function loadPrices() { setLoadingPrice(true); try { await load(true); } catch (e: any) { setError(e.message); } finally { setLoadingPrice(false); } }

  if (error) return <div className="rounded-lg border border-border p-3"><h4 className="mb-1 font-semibold">What changed?</h4><Unavailable>{error}</Unavailable></div>;
  if (!d) return <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground">Loading what changed…</div>;
  const ev = d.event, p = d.price, v = d.valuation;
  return (<>
    <CaseOverview d={d} symbol={symbol} />
    {d.thesis && <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer font-semibold">Full investment thesis and price context</summary><div className="mt-3"><ThesisPanel t={d.thesis} onLoadPrices={loadPrices} loadingPrice={loadingPrice} caseId={caseId} marketModel={d.price?.marketModel} /></div></details>}
    {d.idea && <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer font-semibold">Full idea and practice portfolio context</summary><div className="mt-3"><IdeaCard idea={d.idea} /></div></details>}
    <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer font-semibold">Financial figures, sources and missing information</summary><div className="mt-3 space-y-4 text-sm">
      <h4 className="font-semibold">What changed?</h4>

      <section><h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">The event</h5>
        <p><Tag kind="reported_claim" />{ev.headline ?? "No headline recorded"}{ev.url && <a className="ml-1 inline-flex items-center gap-0.5 text-xs underline" href={ev.url} target="_blank" rel="noreferrer">original<ExternalLink size={10} /></a>}</p>
        {ev.summary && <p className="mt-1 text-xs text-muted-foreground">Provider summary: {ev.summary}</p>}
        <p className="mt-1 text-xs text-muted-foreground">{ev.source ?? "Unknown source"} · published {when(ev.publishedAt)} · first seen by Sentinel {when(ev.firstObservedAt)} · assessed {when(ev.assessedAt)} · {ev.readNote}</p>
        <p className="mt-1 text-xs"><span className="font-medium">Company match:</span> {ev.companyMatch.level === "direct_candidate" ? "named in the headline" : "unclear"} — <span className="text-muted-foreground">{ev.companyMatch.note}</span></p>
      </section>

      <section><h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Business — as filed with the SEC by the case time</h5><ChangeTable rows={d.business} /></section>
      {d.position.length > 0 && <section><h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Financial position</h5><ChangeTable rows={d.position} /></section>}

      <section><h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Supports and risks (rule readings of the facts above)</h5>
        {d.supports.length + d.risks.length === 0 ? <p className="text-xs text-muted-foreground">No supported positives or risks — not evidence of safety.</p> : <ul className="space-y-1 text-xs">
          {d.supports.map((s: any, i: number) => <li key={"s" + i}><Tag kind="interpretation" /><span className="text-sky-300">+</span> {s.text} <span className="text-muted-foreground">Must hold: {s.mustHold}</span></li>)}
          {d.risks.map((s: any, i: number) => <li key={"r" + i}><Tag kind="interpretation" /><span className="text-amber-300">−</span> {s.text} <span className="text-muted-foreground">Wrong if: {s.wrongIf}</span></li>)}
        </ul>}
      </section>

      <section><h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Valuation and expectations</h5>
        {v.pe ? <p className="text-xs"><Tag kind="computed" />Indicative P/E <span className="font-semibold tabular-nums">{v.pe.display}</span> <span className="text-muted-foreground">(year to {v.pe.period?.end}; {v.pe.source?.name}; quote {when(v.pe.sourceTime)}). {v.pe.note}</span></p> : <Unavailable>{v.peUnavailable}</Unavailable>}
        <p className="mt-1 text-xs text-muted-foreground">{v.shareBasis}</p>
        <p className="mt-1 text-xs"><span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 font-semibold">Unknown</span>Expectations and guidance. <span className="text-muted-foreground">{v.expectations.reason}</span></p>
      </section>

      <section><h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Price around the event (vs SPY)</h5>
        {p.status === "not_loaded" ? <button onClick={loadPrices} disabled={loadingPrice} className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50">{loadingPrice ? "Loading daily prices…" : "Load price context"}</button>
          : p.status === "unavailable" ? <Unavailable>{p.reason}</Unavailable>
          : <div className="space-y-2">
              {p.before ? <PriceWindow w={p.before} symbol={symbol} /> : <Unavailable>{p.reason}</Unavailable>}
              {p.after ? <PriceWindow w={p.after} symbol={symbol} /> : <Unavailable>No completed session after the event yet.</Unavailable>}
              <p className="text-[10px] text-muted-foreground">{p.source}, adjustment “{p.adjustment}”, fetched {when(p.fetchedAt)}. Last close before the event: {p.lastCloseBeforeEvent}. {p.caveats.join(" ")}</p>
            </div>}
      </section>

      <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Missing information ({d.missing.length}) and what to check next</summary>
        <ul className="mt-1 list-disc pl-5 text-muted-foreground">{d.missing.map((m: string) => <li key={m}><Tag kind="missing" />{m}</li>)}</ul>
        <ul className="mt-2 list-disc pl-5">{d.nextChecks.map((m: string) => <li key={m}>Check: {m}</li>)}</ul>
      </details>
    </div></details>
  </>);
}
