"use client";
import { useCallback, useEffect, useState } from "react";
import { CaseSheet } from "./morning-brief";

/* Automated Practice experiment: Sentinel follows published rules with virtual money. No broker, no real orders. */

const money = (c: number | null | undefined) => (typeof c === "number" ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100) : "unknown");
const pct = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "—");
const tone = (v: number | null | undefined) => (typeof v !== "number" ? "text-muted-foreground" : v > 0 ? "text-sky-300" : v < 0 ? "text-amber-300" : "");
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "unknown");
const H = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</h4>;

/** Regular US session by the New York clock (weekdays 09:30–16:00). Market holidays are not checked. */
function usMarketOpen(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map(x => [x.type, x.value]));
  const mins = Number(p.hour) * 60 + Number(p.minute);
  return !["Sat", "Sun"].includes(p.weekday) && mins >= 570 && mins < 960;
}

export function AutoPractice() {
  const [d, setD] = useState<any>(null), [busy, setBusy] = useState(""), [error, setError] = useState(""), [sheet, setSheet] = useState<any>(null);
  async function openCase(id: string) { try { const r = await fetch(`/api/ideas?case=${encodeURIComponent(id)}`, { cache: "no-store" }); const j: any = await r.json(); if (r.ok) setSheet(j.case); else setError(j.error || "That research case could not be opened."); } catch { setError("That research case could not be opened."); } }
  const CaseLink = ({ id }: { id?: string | null }) => (id && id.startsWith("discovery-case:") ? <button onClick={() => openCase(id)} className="ml-1 underline hover:text-foreground">research case</button> : null);
  const load = useCallback(async () => { const r = await fetch("/api/auto-practice", { cache: "no-store" }); const j: any = await r.json(); if (!r.ok) throw new Error(j.error || "Could not load the experiment."); setD(j); }, []);
  useEffect(() => { load().catch(e => setError(e.message)); }, [load]);
  async function act(action: "start" | "stop" | "run") {
    if (action === "start" && !window.confirm("Start the automated experiment? Sentinel will open and close virtual positions by the rules shown. No real money is involved.")) return;
    setBusy(action); setError("");
    try {
      const r = await fetch("/api/auto-practice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, requestId: crypto.randomUUID() }) });
      const j: any = await r.json(); if (!r.ok) throw new Error(j.error || "Request failed."); setD(j);
    } catch (e: any) { setError(e.message); } finally { setBusy(""); }
  }
  const s = d?.state, run = d?.run, last = d?.lastRun;
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="font-semibold">Automated experiment (virtual)</h3>
          <p className="text-xs text-muted-foreground">Sentinel picks cases, opens and closes virtual positions by fixed rules, and records every choice, including the ones it skipped. Separate from your own practice trades above.</p></div>
        {d && <div className="flex gap-2">
          {d.status !== "active" && <button onClick={() => act("start")} disabled={!!busy} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">{busy === "start" ? "Starting…" : d.status === "stopped" ? "Start a new experiment" : "Start experiment"}</button>}
          {d.status !== "not_started" && <button onClick={() => act("run")} disabled={!!busy} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">{busy === "run" ? "Checking…" : "Run a check now"}</button>}
          {d.status === "active" && <button onClick={() => act("stop")} disabled={!!busy} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">{busy === "stop" ? "Stopping…" : "Stop new positions"}</button>}
        </div>}
      </div>
      {error && <p className="text-sm text-amber-200" role="alert">{error}</p>}
      {!d && !error && <p className="text-xs text-muted-foreground">Loading…</p>}
      {d && <div className="space-y-4 text-sm">
        <p className="text-xs"><span className={`mr-1.5 rounded px-1.5 py-0.5 font-semibold ${d.status === "active" ? "bg-sky-400/15 text-sky-200" : "bg-muted"}`}>{d.status === "active" ? "Running" : d.status === "stopped" ? "Stopped" : "Not started"}</span>
          {d.experiment ? <>Started {when(d.experiment.startedAt)}{d.experiment.stoppedAt ? `, stopped ${when(d.experiment.stoppedAt)} (open positions still close on schedule)` : ""}. Checked once an hour by the scheduled run, and when you click.</> : <>Nothing happens until you start it.</>}</p>
        {d.experiment && <div className="rounded-md border border-border p-2.5 text-xs">
          <div><span className="font-semibold">Last check:</span> {(run?.at || last?.at) ? <>{when((run ?? last).at)} ({(run ?? last).trigger === "manual" ? "you clicked" : "hourly run"}) — opened {(run ?? last).opened?.length ? (run ?? last).opened.join(", ") : "nothing"}, closed {(run ?? last).closed?.length ? (run ?? last).closed.join(", ") : "nothing"}, skipped {(run ?? last).skipped?.length ?? 0}, {(run ?? last).waiting?.length ?? 0} waiting. It looked at {(run ?? last).counts?.candidates ?? 0} case{(run ?? last).counts?.candidates === 1 ? "" : "s"} assessed since the start; {(run ?? last).counts?.notMeetingRules ?? 0} did not meet the research rules.{(run ?? last).note ? ` ${(run ?? last).note}` : ""}</> : <span className="text-amber-200">no check has been recorded since the start. The hourly run may not have happened yet; click “Run a check now”.</span>}</div>
          <div className="mt-1 text-muted-foreground">{usMarketOpen() ? "The US market is open now, so positions can be opened or closed at the next check." : "The US market is closed now (it trades weekdays 14:30–21:00 UK time; holidays not checked). Eligible cases wait; nothing is opened or closed until it reopens."}</div>
        </div>}

        {s && <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div><div className="text-xs text-muted-foreground">Value after costs</div><div className="text-lg font-semibold tabular-nums">{money(s.equityCents)}</div><div className={`text-xs ${tone(s.returnPct)}`}>{pct(s.returnPct)} from {money(s.startCents)}</div></div>
            <div><div className="text-xs text-muted-foreground">Same money in SPY</div><div className="text-lg font-semibold tabular-nums">{money(s.benchmarkCents)}</div><div className={`text-xs ${tone(s.benchmarkReturnPct)}`}>{pct(s.benchmarkReturnPct)}, same costs</div></div>
            <div><div className="text-xs text-muted-foreground">Cash</div><div className="text-lg font-semibold tabular-nums">{money(s.cashCents)}</div><div className="text-xs text-muted-foreground">{s.open.length} of {d.rules.policy.maxPositions} positions</div></div>
            <div><div className="text-xs text-muted-foreground">Simulated costs paid</div><div className="text-lg font-semibold tabular-nums">{money(s.costsCents)}</div><div className="text-xs text-muted-foreground">{s.record.closedTrades} closed · {s.record.beatSpy} beat SPY</div></div>
          </div>
          <p className="text-xs text-muted-foreground">{s.record.note}{s.equityCents === null ? " Value is unknown because a position has no current IEX price (the market may be closed)." : ""}</p>

          <section><H>Open positions</H>
            {s.open.length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : <ul className="divide-y divide-border text-xs">{s.open.map((p: any) => (
              <li key={p.positionId} className="py-1.5"><span className="font-semibold">{p.symbol}</span> · {money(p.amountCents)} → {money(p.valueCents)} · <span className={tone(p.returnPct)}>{pct(p.returnPct)}</span> · <span className={tone(p.vsSpyPct)}>{pct(p.vsSpyPct)} vs SPY</span> · day {p.ageDays} of {d.rules.policy.holdDays}
                <div className="text-muted-foreground">Opened {when(p.openedAt)} at {money(p.entry.priceCents)} ({p.entry.source}, quote {when(p.entry.at)}). {p.reason} Exit: {p.exitRule} “{p.case.headline}”<CaseLink id={p.caseId} /></div></li>))}</ul>}
          </section>
          {s.closed.length > 0 && <section><H>Closed positions</H><ul className="divide-y divide-border text-xs">{[...s.closed].reverse().map((p: any) => (
            <li key={p.positionId} className="py-1.5"><span className="font-semibold">{p.symbol}</span> · {money(p.amountCents)} → {money(p.valueCents)} · <span className={tone(p.returnPct)}>{pct(p.returnPct)}</span> · <span className={tone(p.vsSpyPct)}>{pct(p.vsSpyPct)} vs SPY</span> · {p.ageDays} days · {p.closeReason}<CaseLink id={p.caseId} /></li>))}</ul></section>}

          <section><H>Waiting ({d.waiting.length})</H>
            {d.waiting.length === 0 ? <p className="text-xs text-muted-foreground">No eligible case is waiting. Since the start Sentinel assessed {d.considered?.candidates ?? 0} recent case{d.considered?.candidates === 1 ? "" : "s"}; {d.considered?.notMeetingRules ?? 0} did not meet the research rules and were not considered.</p>
              : <ul className="text-xs">{d.waiting.map((w: any, i: number) => <li key={i}><span className="font-semibold">{w.symbol}</span> <span className="text-muted-foreground">— {w.reason}<CaseLink id={w.caseId} /></span></li>)}</ul>}
          </section>
          <section><H>Skipped for good ({s.skipped.length})</H>
            {s.skipped.length === 0 ? <p className="text-xs text-muted-foreground">None yet. Only cases that met the research rules but could not be opened are listed here; every assessed case still gets its own outcome record in Discover.</p>
              : <ul className="text-xs">{s.skipped.slice(0, 20).map((k: any) => <li key={k.caseId} className="py-0.5"><span className="font-semibold">{k.symbol}</span> · {when(k.at)} <span className="text-muted-foreground">— {k.reason} “{k.case.headline}”<CaseLink id={k.caseId} /></span></li>)}</ul>}
          </section>
        </>}

        <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">The rules ({d.rules.version})</summary>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">{d.rules.text.map((t: string) => <li key={t}>{t}</li>)}</ul></details>
        <p className="text-[11px] text-muted-foreground">{d.rules.disclaimer}</p>
      </div>}
      <CaseSheet c={sheet} onClose={() => setSheet(null)} />
    </div>
  );
}
