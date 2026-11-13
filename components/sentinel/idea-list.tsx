"use client";
import { useEffect, useState, type ComponentType } from "react";
import { ExternalLink } from "lucide-react";

/* Ideas to look at first (Brief and Discover). Rules and stored records only: no AI text, no forecasts. */

const pct = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` : "—");
const when = (iso: string | null | undefined) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "time unknown");
const TONE: Record<string, string> = { research: "border-sky-400/50", watch: "border-border", wait: "border-border", doubt: "border-amber-400/50" };
const Label = ({ children }: { children: React.ReactNode }) => <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</div>;

function PriceMove({ caseId, symbol }: { caseId: string; symbol: string }) {
  const [p, setP] = useState<any>(null);
  useEffect(() => { let on = true; fetch(`/api/ideas?price=${encodeURIComponent(caseId)}`, { cache: "no-store" }).then(r => r.json()).then(j => on && setP(j)).catch(() => on && setP({ status: "unavailable", reason: "Price data could not be loaded." })); return () => { on = false; }; }, [caseId]);
  if (!p) return <span className="text-muted-foreground">Loading daily prices…</span>;
  if (p.status !== "ok") return <span className="text-muted-foreground"><span className="mr-1 rounded bg-muted px-1 py-0.5 font-semibold text-foreground">Unavailable</span>{p.reason}</span>;
  const row = (w: any, name: string) => w ? <div>{name}: {symbol} <span className="font-semibold tabular-nums">{pct(w.stockPct)}</span>, SPY <span className="tabular-nums">{pct(w.spyPct)}</span>, difference <span className="font-semibold tabular-nums">{pct(w.vsSpyPct)}</span> <span className="text-muted-foreground">({w.from} → {w.to})</span></div> : <div className="text-muted-foreground">{name}: not enough completed sessions.</div>;
  return <div>{row(p.before, "20 sessions before the news")}{row(p.after, p.after ? `${p.after.sessions} session${p.after.sessions === 1 ? "" : "s"} since` : "Since the news")}<div className="text-[10px] text-muted-foreground">IEX daily closes, one exchange. A move around a report does not show the report caused it.</div></div>;
}

function Card({ i, onOpen }: { i: any; onOpen: (id: string) => void }) {
  return (
    <article className={`rounded-xl border bg-card p-4 ${TONE[i.view.tone] ?? "border-border"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><span className="text-base font-semibold">{i.symbol}</span>{i.company && <span className="text-sm text-muted-foreground"> · {i.company}</span>}
          <div className="mt-0.5 text-xs">{i.identity.confirmed ? <span className="text-sky-300">✓ {i.identity.label}</span> : <span className="text-amber-200">⚠ {i.identity.label}</span>}<span className="text-muted-foreground"> · {i.kind.label}</span></div></div>
        <div className="text-right"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${i.tier === "meets_rules" ? "bg-sky-400/15 text-sky-200" : "bg-muted"}`}>{i.tier === "meets_rules" ? "Meets research rules" : "Close, not selected"}</span>
          <div className="mt-1 text-xs text-muted-foreground" title={i.score.meaning}>Evidence {i.score.score === null ? "not scored" : `${i.score.score}/100`}</div></div>
      </div>
      <p className="mt-2 text-sm">{i.event.url ? <a className="hover:underline" href={i.event.url} target="_blank" rel="noreferrer">{i.event.headline}<ExternalLink size={11} className="ml-1 inline" /></a> : i.event.headline}</p>
      <p className="text-xs text-muted-foreground">Reported by {i.event.source ?? "unknown source"}, {when(i.event.publishedAt)} · assessed {when(i.event.assessedAt)} · headline only, article not read</p>
      <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
        <div><Label>Why look</Label><p>{i.view.label}. {i.view.text}</p></div>
        <div><Label>Strongest counterpoint</Label><p>{i.counterpoint ? <>{i.counterpoint.text}{i.counterpoint.detail && <span className="text-muted-foreground"> — {i.counterpoint.detail}</span>}</> : <span className="text-muted-foreground">None supported by the stored records. That is not evidence of safety.</span>}</p></div>
        <div><Label>Financial changes (SEC filings)</Label>
          {i.changes.length ? <ul>{i.changes.map((c: any) => <li key={c.label}>{c.label} <span className="font-semibold tabular-nums">{pct(c.changePct)}</span> <span className="text-muted-foreground">vs {c.comparison}, to {c.periodEnd} · {c.url ? <a className="underline" href={c.url} target="_blank" rel="noreferrer">filed {c.filed}</a> : `filed ${c.filed ?? "unknown"}`}</span></li>)}</ul> : <p className="text-muted-foreground">{i.changesNote}</p>}</div>
        <div><Label>Price since the news (vs SPY)</Label><PriceMove caseId={i.caseId} symbol={i.symbol} /></div>
        <div><Label>Valuation and expectations</Label>
          <p>{i.valuation.status === "indicative" ? <>P/E <span className="font-semibold tabular-nums">{i.valuation.value.toFixed(1)}</span> <span className="text-muted-foreground">({i.valuation.label}{i.valuation.lastClose ? ", last close, not live" : ""} ÷ annual EPS to {i.valuation.periodEnd}). {i.valuation.note}</span></> : <span className="text-muted-foreground">P/E unavailable: {i.valuation.reason}</span>}</p>
          <p className="text-muted-foreground">{i.expectations}</p></div>
        <div><Label>Missing, and what to check next</Label>
          <ul className="text-muted-foreground">{i.missing.map((m: string) => <li key={m}>• {m}</li>)}</ul>{i.nextCheck && <p>Next: {i.nextCheck}</p>}</div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs"><button onClick={() => onOpen(i.caseId)} className="rounded-md border border-border px-2.5 py-1 hover:bg-accent">Open full case</button><span className="text-muted-foreground">{i.kind.note}</span></div>
    </article>
  );
}

export function IdeaList({ Sheet, compact = false }: { Sheet: ComponentType<{ c: any | null; onClose: () => void }>; compact?: boolean }) {
  const [d, setD] = useState<any>(null), [error, setError] = useState(""), [openCase, setOpenCase] = useState<any>(null);
  useEffect(() => { fetch("/api/ideas", { cache: "no-store" }).then(async r => { const j: any = await r.json(); if (!r.ok) throw new Error(j.error || "Ideas could not be loaded."); setD(j); }).catch(e => setError(e.message)); }, []);
  async function open(id: string) { try { const r = await fetch(`/api/ideas?case=${encodeURIComponent(id)}`, { cache: "no-store" }); const j: any = await r.json(); if (r.ok) setOpenCase(j.case); } catch { /* the card stays as it is */ } }
  const c = d?.counts;
  return (
    <section id="ideas" className="space-y-3">
      <div><h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Where to look first · last {d?.windowDays ?? 7} days</h2>
        {error && <p role="alert" className="mt-1 text-sm text-amber-200">{error}</p>}
        {!d && !error && <p className="mt-1 text-sm text-muted-foreground">Selecting cases…</p>}
        {d && <><p className="mt-1 text-lg">{d.headline}</p>
          <p className="mt-1 text-xs text-muted-foreground">{c.assessed} assessed: {c.meetsRules} meet the rules, {c.watch} to watch, {c.notEnoughData} without enough data{c.wrongCompany ? `, ${c.wrongCompany} probably about a different company` : ""}{c.olderScreen ? `, ${c.olderScreen} from the older screen` : ""}.
            {d.topBlockers.length > 0 && <> Most common gap: {d.topBlockers.map((b: any) => `${b.reason} (${b.cases})`).join("; ")}.</>} {d.note}</p></>}
      </div>
      {d && d.ideas.length > 0 && <div className={compact ? "grid gap-3" : "grid gap-3"}>{d.ideas.map((i: any) => <Card key={i.caseId} i={i} onOpen={open} />)}</div>}
      {d && d.ideas.length === 0 && <div className="rounded-xl border border-border bg-card p-4 text-sm">
        <p>Nothing to put in front of you yet.</p>
        <p className="mt-1 text-xs text-muted-foreground">{c.assessed === 0 ? "The hourly scan has not produced any cases in this period. Check the scan status on Discover." : "You can still review every assessed case, ranked by evidence, on Discover."}</p>
        <a href="/#discover" className="mt-2 inline-block rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent">Review all assessed cases</a>
      </div>}
      <Sheet c={openCase} onClose={() => setOpenCase(null)} />
    </section>
  );
}
