"use client";
import { useEffect, useState } from "react";
import { ArrowRight, ChevronDown, ExternalLink, CircleHelp, Radar, LayoutGrid } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { friendlyLabel, screenLabel } from "@/lib/sentinel/screen-label";
import { caseEvidenceScore, SCORE_MEANING } from "@/lib/sentinel/evidence-score";
import { ResearchTeamPanel } from "./research-team-panel";
import { WhatChanged } from "./what-changed";
import { IdeaList } from "./idea-list";

/* Morning brief dashboard: bottom line first, takes, radar, watchlist; everything else folded. */

type Fact = { label: string; value: string; source: string } | null;
type Take = { caseId: string; symbol: string; company: string | null; label: string; statement: string; url: string | null; source: string | null; publishedAt: string | null; assessedAt: string; whyItMatters: string | null; checkFirst: string | null; keyFact: Fact; reason?: string; evidence?: { score: number | null; band: string | null; status: string; coverage: number; passed: string[]; failed: string[]; unknown: string[] } };

const london = (iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" }) =>
  iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", ...opts }) : "unknown";
const dayTime = (iso: string | null | undefined) => london(iso, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const LABEL_STYLE: Record<string, string> = {
  INVESTIGATE: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  MONITOR: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  WAIT: "border-slate-400/30 bg-slate-400/10 text-slate-300",
};
function Chip({ label }: { label: string }) {
  const base = label.split(" ")[0];
  return <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${LABEL_STYLE[base] ?? LABEL_STYLE.WAIT}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{friendlyLabel(label)}</span>;
}
function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-border bg-card p-5 ${className}`}><h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h2>{children}</section>;
}
function KeyFact({ f }: { f: Fact }) {
  return f ? <p className="text-xs leading-relaxed text-muted-foreground"><span className="font-semibold tabular-nums text-foreground">{f.label} {f.value}</span> · {f.source}</p> : <p className="text-xs text-muted-foreground"><span className="rounded bg-muted px-1.5 py-0.5">Unknown</span> No sourced figure available</p>;
}

const BAND_STYLE: Record<string, string> = { "Strong evidence": "text-sky-300", "Mixed evidence": "text-amber-300", "Weak evidence": "text-slate-300" };
/** Evidence score badge. Never blank: an unscored case says so. Not a probability. */
function ScoreBadge({ e, size = "md" }: { e?: Take["evidence"]; size?: "md" | "sm" }) {
  if (!e) return null;
  if (e.score === null) return <span title={SCORE_MEANING} className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">Not enough data to score</span>;
  return (
    <span title={SCORE_MEANING} className="inline-flex items-baseline gap-1.5 rounded-md border border-border bg-background/40 px-2 py-1">
      <span className={`font-semibold tabular-nums ${size === "md" ? "text-2xl" : "text-base"} ${BAND_STYLE[e.band ?? ""] ?? ""}`}>{e.score}</span>
      <span className="text-xs text-muted-foreground">/100 · {e.band}</span>
    </span>
  );
}

function TakeCard({ t, onOpen }: { t: Take; onOpen: () => void }) {
  return (
    <article className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-lg font-semibold leading-snug">{t.statement}</h3>
        <ScoreBadge e={t.evidence} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <Chip label={t.label} /><span className="font-semibold text-foreground">{t.symbol}</span><span>{t.company ?? "Company unverified"}</span><span>· {t.source ?? "Unknown source"} · {dayTime(t.publishedAt)}</span>
      </div>
      <dl className="mt-4 space-y-2 text-[15px] leading-relaxed">
        <div><dt className="inline font-medium">Why it may matter: </dt><dd className="inline text-muted-foreground">{t.whyItMatters ?? "No rule template for this event type; read the original report."}</dd></div>
        {t.evidence && (t.evidence.failed.length > 0 || t.evidence.unknown.length > 0) && <div><dt className="inline font-medium">Holding the score back: </dt><dd className="inline text-muted-foreground">{[...t.evidence.failed.map(x => x + " (no)"), ...t.evidence.unknown.map(x => x + " (unknown)")].join(" · ")}</dd></div>}
        <div><dt className="inline font-medium">Check before acting: </dt><dd className="inline text-muted-foreground">{t.checkFirst}</dd></div>
      </dl>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-t border-border pt-4">
        <KeyFact f={t.keyFact} />
        <button onClick={onOpen} className="inline-flex items-center gap-1 text-sm font-medium text-sky-300 hover:underline">Open case, what changed &amp; research team <ArrowRight size={14} /></button>
      </div>
    </article>
  );
}

function ScoreChecklist({ c }: { c: any }) {
  const e = caseEvidenceScore(c);
  const mark = { pass: ["✓", "text-sky-300"], fail: ["✕", "text-amber-300"], unknown: ["?", "text-muted-foreground"] } as const;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between"><h4 className="font-semibold">Evidence score</h4>
        {e.score === null ? <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Not enough data to score</span> : <span className="tabular-nums"><span className="text-lg font-semibold">{e.score}</span><span className="text-xs text-muted-foreground">/100 · {e.band}</span></span>}
      </div>
      <ul className="space-y-1.5">{e.checks.map(x => <li key={x.id} className="flex gap-2"><span className={mark[x.state][1]}>{mark[x.state][0]}</span><span className="flex-1"><span className="font-medium">{x.label}</span> <span className="text-xs text-muted-foreground">({x.points} pts)</span><div className="text-xs text-muted-foreground">{x.detail}{x.source ? ` · ${x.source}` : ""}</div></span></li>)}</ul>
      <p className="mt-2 text-xs text-muted-foreground">{e.meaning} Checks known: {e.coverage}/100 points{e.score === null ? " (at least 60 needed to score)" : ""}. Rules {e.version}; weights are untested and will be judged by outcomes per score band.</p>
    </div>
  );
}

export function CaseSheet({ c, onClose }: { c: any | null; onClose: () => void }) {
  return (
    <Sheet open={!!c} onOpenChange={o => !o && onClose()}>
      <SheetContent className="sentinel-case-sheet w-full overflow-y-auto sm:max-w-2xl">
        {c && <>
          <SheetHeader>
            <div className="flex items-center gap-2"><Chip label={c.decision?.version === "research-screen-v2" ? (c.conclusion ?? "WAIT") : screenLabel(c)} /><span className="text-sm text-muted-foreground">{c.decision?.version ?? "earlier screen"}</span></div>
            <SheetTitle className="sentinel-case-title text-left">{c.symbol}<span>{c.identity?.name ?? "Company unverified"}</span></SheetTitle>
            <SheetDescription className="sr-only">{c.event?.headline ?? "Company research case"}</SheetDescription>
          </SheetHeader>
          <div className="space-y-6 px-4 pb-8 text-sm">
            <p className="text-muted-foreground">{c.event?.source ?? "Unknown source"} · published {dayTime(c.event?.publishedAt)} · assessed {dayTime(c.createdAt)}{c.event?.url && <> · <a className="inline-flex items-center gap-1 text-sky-300 hover:underline" href={c.event.url} target="_blank" rel="noreferrer">original <ExternalLink size={12} /></a></>}</p>
            {c.id && <WhatChanged caseId={c.id} symbol={c.symbol} />}
            <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer font-semibold">Checklist, screening rules and sources</summary><div className="mt-4 space-y-5"><ScoreChecklist c={c} />
            <div><h4 className="mb-2 font-semibold">Screening rules</h4>
              {c.rules?.length ? <ul className="space-y-1.5">{c.rules.map((r: any) => <li key={r.id} className="flex gap-2"><span className={r.passed ? "text-sky-300" : "text-amber-300"}>{r.passed ? "✓" : "✕"}</span><span><span className="font-medium">{r.id}</span> {r.detail}{r.passed ? "" : " — not met"}</span></li>)}</ul> : <p className="text-muted-foreground">Rules were not evaluated (earlier screen version or data incomplete).</p>}
            </div>
            <div><h4 className="mb-2 font-semibold">Data readiness</h4>
              {c.readiness?.blockers?.length ? <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{c.readiness.blockers.map((b: string) => <li key={b}>{b}</li>)}</ul> : <p className="text-muted-foreground">{c.readiness?.status === "DATA_READY" ? "Screening data is complete. Further investment research is still needed." : "Unknown"}</p>}
            </div>
            <div><h4 className="mb-2 font-semibold">Figures and sources</h4>
              <ul className="space-y-2">
                {c.price?.status === "indicative" && <li><span className="font-medium tabular-nums">P/E {c.price.ratio.toFixed(1)}</span><div className="text-xs text-muted-foreground">{c.price.basis === "last_close" ? `${c.price.priceLabel} (last close, not a live price)` : `IEX midpoint ${dayTime(c.price.quoteTime)}`} ÷ annual diluted EPS (year to {c.price.periodEnd}). {c.price.limitations}</div></li>}
                {c.price && c.price.status !== "indicative" && <li><span className="rounded bg-muted px-1.5 py-0.5 text-xs">Unknown</span> P/E: {c.price.reason}</li>}
                {(c.evidence ?? []).map((e: any) => <li key={e.label}><span className="font-medium">{e.label}</span> {typeof e.value === "number" ? <span className="tabular-nums">{e.value.toLocaleString("en-US")} {e.unit}</span> : <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Unknown</span>}<div className="text-xs text-muted-foreground">Period ending {e.periodEnd ?? "unknown"} · filed {e.filed ?? "unknown"}{e.accession ? ` · ${e.accession}` : ""}</div></li>)}
              </ul>
            </div>
            <div><h4 className="mb-2 font-semibold">What to verify next</h4>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{[...(c.event?.analysis?.questions ?? []), ...(c.missing ?? [])].slice(0, 8).map((q: string, i: number) => <li key={i}>{q}</li>)}</ul>
            </div>
            </div></details>
            {c.id && <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer font-semibold">Research team</summary><div className="mt-3"><ResearchTeamPanel caseId={c.id} /></div></details>}
            {c.id && c.symbol && <a href={`/#practice?case=${encodeURIComponent(c.id)}&symbol=${encodeURIComponent(c.symbol)}`} onClick={onClose} className="inline-flex w-full items-center justify-center rounded-md bg-[#cbf47b] px-3 py-2 text-sm font-semibold text-black">Practice-trade this with virtual money</a>}
            <p className="text-xs text-muted-foreground">Research record, not investment advice.</p>
          </div>
        </>}
      </SheetContent>
    </Sheet>
  );
}

export function MorningBriefView({ embedded = false }: { embedded?: boolean }) {
  const [data, setData] = useState<any>(null), [error, setError] = useState(""), [open, setOpen] = useState<string | null>(null);
  useEffect(() => { fetch("/api/morning-brief", { cache: "no-store" }).then(async r => { const j: any = await r.json().catch(() => null); if (!r.ok) throw new Error(j?.error || "The morning brief could not be loaded."); return j; }).then(setData).catch(e => setError(e.message)); }, []);
  const statusDot = data?.status.level === "ok" ? "bg-sky-400" : data?.status.level === "attention" ? "bg-amber-400" : "bg-red-400";

  return (
    <div className={embedded ? "text-foreground" : "min-h-screen bg-background text-foreground"}>
      {!embedded && <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
          <div className="flex items-center gap-2"><Radar size={18} className="text-primary" /><span className="font-semibold tracking-wide">SENTINEL</span><span className="text-muted-foreground">· Morning brief</span></div>
          <div className="flex items-center gap-4 text-muted-foreground">
            {data && <span>{london(data.preparedAt, { weekday: "short", day: "numeric", month: "short" })} · prepared {london(data.preparedAt)}</span>}
            <a href="/" className="inline-flex items-center gap-1 hover:text-foreground"><LayoutGrid size={14} /> Full workspace</a>
          </div>
        </div>
      </header>}

      <main className={embedded ? "space-y-6 py-2" : "mx-auto max-w-7xl space-y-6 px-5 py-8"}>
        {error && <p role="alert" className="rounded-xl border border-border bg-card p-5">{error}</p>}
        {!data && !error && <p className="text-muted-foreground">Preparing your brief…</p>}
        {data && <>
          {/* Row 1: the bottom line */}
          <section className="grid gap-6 rounded-2xl border border-border bg-card p-7 lg:grid-cols-[1fr_auto] lg:items-center">
            <div><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-300">Your daily perspective · last {data.windowHours} hours</p><h1 className="mb-3 text-2xl font-semibold sm:text-3xl">Your Sentinel brief</h1><p className="text-xl leading-relaxed sm:text-2xl sm:leading-relaxed">{data.bottomLine}</p></div>
            <div className="flex gap-3 lg:flex-col">
              {[["investigate", "meet research rules", "text-sky-300"], ["monitor", "to watch", "text-amber-300"], ["waiting", "not enough data", "text-slate-300"]].map(([k, t, cls]) => (
                <div key={k} className="flex min-w-36 items-baseline gap-2 rounded-lg border border-border px-4 py-2.5"><span className={`text-2xl font-semibold tabular-nums ${cls}`}>{data.counts[k]}</span><span className="text-sm text-muted-foreground">{t}</span></div>
              ))}
            </div>
          </section>

          {data.status.lastScanAt && !data.status.scanCompleted && <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">The latest market scan was partial; some reports may still be missing. {data.status.pendingCount != null ? `${data.status.pendingCount} are queued for assessment.` : "Queue size is unavailable."}</p>}

          {/* Where to look first: selected cases with the reasons, or why nothing was selected */}
          <IdeaList Sheet={CaseSheet} />

          {/* Row 2: takes + side column */}
          <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer font-semibold">More research and scan details</summary><div className="mt-5 grid gap-6 lg:grid-cols-12">
            <section id="takes" className="space-y-4 lg:col-span-8">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Meet research rules</h2>
              {data.takes.length ? data.takes.map((t: Take) => <TakeCard key={t.caseId} t={t} onOpen={() => setOpen(t.caseId)} />) :
                <p className="rounded-xl border border-dashed border-border p-6 leading-relaxed text-muted-foreground">No case met all three rules in the last 24 hours. That is normal: Sentinel only flags cases with complete data, a direct company role and a qualifying event.</p>}
              {data.moreTakes > 0 && <p className="text-sm text-muted-foreground">+{data.moreTakes} more in the full workspace.</p>}
            </section>
            <div className="space-y-6 lg:col-span-4">
              <Panel title="Watch">
                <div id="radar" />
                {data.radar.length ? <ul className="-mx-2 divide-y divide-border">{data.radar.map((r: Take) => (
                  <li key={r.caseId}><button onClick={() => setOpen(r.caseId)} className="w-full rounded-md px-2 py-3 text-left hover:bg-accent">
                    <div className="flex items-start gap-2"><Chip label={r.label} /><span className="flex-1 text-sm"><span className="font-semibold">{r.symbol}</span> {r.statement}</span><ScoreBadge e={r.evidence} size="sm" /></div>
                    <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>
                  </button></li>))}</ul> : <p className="text-sm text-muted-foreground">Nothing with complete data missed by a single rule.</p>}
                {data.moreRadar > 0 && <p className="mt-2 text-xs text-muted-foreground">+{data.moreRadar} more</p>}
              </Panel>
              <Panel title="Watchlist — what changed">
                {data.watchlist.changes.length ? <ul className="space-y-3 text-sm">{data.watchlist.changes.map((w: any) => (
                  <li key={w.entityId}><span className="font-semibold">{w.name}</span>
                    {w.filings.map((f: any) => <div key={f.accession} className="text-muted-foreground">New {f.form} filed {f.filedAt}</div>)}
                    {w.headlines.map((h: any, i: number) => <div key={i} className="text-muted-foreground">{h.url ? <a href={h.url} target="_blank" rel="noreferrer" className="hover:underline">{h.headline}</a> : h.headline}</div>)}
                  </li>))}</ul>
                  : <p className="text-sm text-muted-foreground">{data.watchlist.tracked.length ? `No new filings or headlines for ${data.watchlist.tracked.join(", ")} in the last 24 hours.` : "Your watchlist is empty."}</p>}
              </Panel>
              <Panel title="System status">
                <Collapsible>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${statusDot}`} />
                      {data.status.lastScanAt ? `Scan ${data.status.scanCompleted ? "complete" : "partial"} · ${data.status.pendingCount ?? "unknown"} queued · ${dayTime(data.status.lastScanAt)}` : "No scan recorded yet"}</span>
                    <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground">Details</CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                    <dl className="mt-3 space-y-1.5 border-t border-border pt-3 text-xs">
                      {[["Last market scan", dayTime(data.status.lastScanAt)], ["Scan window", data.status.scanCompleted === null ? "Unknown" : data.status.scanCompleted ? "Complete" : "Partial — resumes next run"], ["Queued for assessment", data.status.pendingCount ?? "Unknown"], ["Last outcome check", data.status.lastOutcomeAt ? dayTime(data.status.lastOutcomeAt) : "Not yet run"], ["Shadow AI reader", data.status.shadowReader]].map(([k, v]) => (
                        <div key={k as string} className="flex justify-between gap-4"><dt className="flex items-center gap-1 text-muted-foreground">{k}{k === "Shadow AI reader" && <span title="An evaluation-only AI that reads headlines in the background. It never changes any decision."><CircleHelp size={12} /></span>}</dt><dd className="text-right">{v}</dd></div>))}
                    </dl>
                  </CollapsibleContent>
                </Collapsible>
              </Panel>
            </div>
          </div>

          </details>

          {/* Row 3: waiting on data, folded */}
          <Collapsible id="waiting" className="rounded-xl border border-border bg-card">
            <CollapsibleTrigger className="group flex w-full items-center justify-between px-5 py-4 text-left">
              <span className="text-sm font-semibold">Not enough data <span className="ml-1 font-normal text-muted-foreground">{data.counts.waiting}</span></span>
              <ChevronDown size={16} className="text-muted-foreground transition group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="divide-y divide-border border-t border-border">{data.waiting.map((w: any) => (
                <li key={w.caseId}><button onClick={() => setOpen(w.caseId)} className="grid w-full gap-x-4 gap-y-0.5 px-5 py-2.5 text-left text-sm hover:bg-accent md:grid-cols-[70px_1.2fr_1.6fr_1.6fr]">
                  <span className="font-semibold">{w.symbol}</span><span className="truncate text-muted-foreground">{w.company ?? "Unverified"}</span><span className="truncate">{w.statement}</span><span className="text-muted-foreground">{w.missing}</span>
                </button></li>))}</ul>
              {data.moreWaiting > 0 && <p className="px-5 pb-3 text-xs text-muted-foreground">+{data.moreWaiting} more</p>}
            </CollapsibleContent>
          </Collapsible>

          {/* Row 4: outcomes */}
          <Panel title="Outcomes tracker · vs SPY">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{data.outcomes.horizons.map((h: any) => (
              <div key={h.horizon} className="rounded-lg border border-border px-4 py-3"><div className="text-xs text-muted-foreground">{h.horizon} trading days</div><div className="mt-1 text-sm">{h.observed ? `${h.observed} observed` : <span className="text-muted-foreground">Too early</span>}</div></div>))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{data.outcomes.note}</p>
          </Panel>
          <p className="pb-4 text-center text-xs text-muted-foreground">Research records, not investment advice.</p>
        </>}
      </main>
      <CaseSheet c={open && data ? data.caseDetails[open] : null} onClose={() => setOpen(null)} />
    </div>
  );
}
