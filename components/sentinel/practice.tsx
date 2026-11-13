"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { newId } from "@/lib/sentinel/client-id";
import { PaperPortfolio } from "./paper-portfolio";
import { PracticeRisk } from "./practice-risk";
import { AutoPractice } from "./auto-practice";

/* Practice v2: $10,000 virtual, live IEX prices, every position benchmarked against SPY. */

const money = (c: number | null | undefined) => (typeof c === "number" ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100) : "—");
const pct = (v: number | null | undefined) => (typeof v === "number" ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "unknown");
const tone = (v: number | null | undefined) => (typeof v !== "number" ? "text-muted-foreground" : v > 0 ? "text-sky-300" : v < 0 ? "text-amber-300" : "");
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "unknown");
const REFRESH_MS = 60000;

function Curve({ history, now }: { history: { date: string; equityCents: number; benchmarkCents: number }[]; now: { equityCents: number | null; benchmarkCents: number | null } }) {
  const pts = [...history];
  if (now.equityCents !== null && now.benchmarkCents !== null) pts.push({ date: "now", equityCents: now.equityCents, benchmarkCents: now.benchmarkCents });
  if (pts.length < 2) return <p className="text-xs text-muted-foreground">The chart starts after the first daily mark (recorded by the hourly run).</p>;
  const all = pts.flatMap(p => [p.equityCents, p.benchmarkCents]), lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const W = 600, H = 120, x = (i: number) => (i / (pts.length - 1)) * W, y = (v: number) => H - ((v - lo) / span) * (H - 10) - 5;
  const line = (k: "equityCents" | "benchmarkCents") => pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" role="img" aria-label="Practice portfolio value versus the same dollars in SPY">
        <path d={line("benchmarkCents")} fill="none" stroke="currentColor" className="text-slate-500" strokeWidth="1.5" strokeDasharray="4 3" />
        <path d={line("equityCents")} fill="none" stroke="currentColor" className="text-sky-300" strokeWidth="2" />
      </svg>
      <div className="mt-1 flex gap-4 text-xs text-muted-foreground"><span><span className="text-sky-300">━</span> Your practice portfolio</span><span><span className="text-slate-500">┅</span> Same dollars in SPY</span><span>{pts[0].date} → today</span></div>
    </div>
  );
}

function Stat({ label, value, sub, className = "" }: { label: string; value: string; sub?: string; className?: string }) {
  return <div><div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div><div className={`mt-1 text-2xl font-semibold tabular-nums ${className}`}>{value}</div>{sub && <div className="text-xs text-muted-foreground">{sub}</div>}</div>;
}

function readHash() {
  if (typeof window === "undefined" || !window.location.hash.startsWith("#practice")) return null;
  const q = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  return { caseId: q.get("case"), symbol: q.get("symbol") };
}

export function Practice() {
  const [s, setS] = useState<any>(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ symbol: "", amount: "1000", conviction: 50, thesis: "", exitPlan: "", killCondition: "", caseId: null as string | null });
  const pending = useRef<{ key: string; id: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await fetch("/api/practice", { cache: "no-store" }); const j: any = await r.json(); if (!r.ok) throw new Error(j.error || "Practice portfolio unavailable."); setS(j); setError(""); }
    catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, REFRESH_MS);
    const fromHash = () => { const h = readHash(); if (h?.symbol) setForm(f => ({ ...f, symbol: h.symbol!.toUpperCase(), caseId: h.caseId })); };
    fromHash(); window.addEventListener("hashchange", fromHash);
    return () => { clearInterval(t); window.removeEventListener("hashchange", fromHash); };
  }, [load]);

  async function send(payload: any, key: string, ok: string) {
    if (pending.current?.key !== key) pending.current = { key, id: newId() };
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch("/api/practice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, requestId: pending.current.id }) });
      const j: any = await r.json();
      if (!r.ok) { if (r.status === 409) { pending.current = null; await load(); } throw new Error(j.error || "Could not record this."); }
      setS(j); pending.current = null; setNotice(ok); return true;
    } catch (e: any) { setError(e.message); return false; } finally { setBusy(false); }
  }

  async function open(e: React.FormEvent) {
    e.preventDefault(); if (!s) return;
    if (!/^\d+(\.\d{1,2})?$/.test(form.amount)) { setError("Enter a dollar amount, e.g. 1000."); return; }
    const payload = { action: "open", expectedSequence: s.sequence, symbol: form.symbol.trim().toUpperCase(), amountCents: Math.round(Number(form.amount) * 100), conviction: form.conviction, thesis: form.thesis, exitPlan: form.exitPlan, killCondition: form.killCondition, caseId: form.caseId };
    if (await send(payload, JSON.stringify(payload), `Practice position opened in ${payload.symbol} at the live IEX price. No real order was placed.`)) {
      setForm(f => ({ ...f, symbol: "", thesis: "", exitPlan: "", killCondition: "", caseId: null }));
      if (window.location.hash.startsWith("#practice")) history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }
  async function close(p: any) {
    const reason = window.prompt(`Why are you closing ${p.symbol}? (kept in the record)`); if (!reason || reason.trim().length < 5) return;
    await send({ action: "close", expectedSequence: s.sequence, positionId: p.positionId, reason }, "close:" + p.positionId, `${p.symbol} closed at the live IEX price.`);
  }
  async function review(p: any, decision: "keep" | "close" | "pass") {
    const note = window.prompt(`${p.reviewDue.label} review of ${p.symbol}: is the thesis holding? What changed?`); if (!note || note.trim().length < 3) return;
    const ok = await send({ action: "review", positionId: p.positionId, milestone: p.reviewDue.days, decision, note }, `review:${p.positionId}:${p.reviewDue.days}:${decision}`, "Review recorded.");
    if (ok && decision === "close") await close(p);
  }

  const vsSpy = s && typeof s.returnPct === "number" && typeof s.benchmarkReturnPct === "number" ? s.returnPct - s.benchmarkReturnPct : null;
  const input = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

  return (
    <section className="mx-auto max-w-6xl space-y-6 py-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-xl font-semibold">Practice</h2><p className="text-sm text-muted-foreground">$10,000 of virtual money. Live IEX prices. Every position is compared with the same dollars in SPY.</p></div>
        <button onClick={load} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><RefreshCw size={14} className={loading ? "animate-spin" : ""} />Updates every minute</button>
      </div>
      {error && <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200" role="alert">{error}</div>}
      {notice && <div className="rounded-lg border border-sky-400/40 bg-sky-400/10 p-3 text-sm text-sky-200" role="status">{notice}</div>}

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <Stat label="Portfolio value" value={s ? money(s.equityCents) : "Loading…"} sub={s && s.equityCents === null ? "A position has no live price right now" : "Cash + open positions at live prices"} />
          <Stat label="Your return" value={pct(s?.returnPct)} className={tone(s?.returnPct)} sub={`since start (${money(s?.startCents)})`} />
          <Stat label="vs SPY" value={pct(vsSpy)} className={tone(vsSpy)} sub={`SPY with the same dollars: ${pct(s?.benchmarkReturnPct)}`} />
          <Stat label="Cash" value={money(s?.cashCents)} sub={`${s?.open?.length ?? 0} open · ${s?.closed?.length ?? 0} closed`} />
        </div>
        <div className="mt-6">{s && <Curve history={s.history} now={s} />}</div>
      </div>

      {s?.reviewsDue?.length > 0 && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/5 p-5">
          <h3 className="mb-3 font-semibold">Reviews due</h3>
          <ul className="space-y-3">{s.reviewsDue.map((p: any) => (
            <li key={p.positionId} className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span><span className="font-semibold">{p.symbol}</span> · {p.reviewDue.label} · {pct(p.returnPct)} ({pct(p.vsSpyPct)} vs SPY) · <span className="text-muted-foreground">Thesis: {p.thesis}</span> · <span className="text-muted-foreground">Wrong if: {p.killCondition}</span></span>
              <span className="flex gap-2">{(["keep", "close"] as const).map(d => <button key={d} disabled={busy} onClick={() => review(p, d)} className="rounded-md border border-border px-3 py-1 hover:bg-accent">{d === "keep" ? "Still holding" : "Thesis broken — close"}</button>)}</span>
            </li>))}</ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-3 font-semibold">Open positions</h3>
            {s?.open?.length ? (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-2">Symbol</th><th>Invested</th><th>Now</th><th>Return</th><th>vs SPY</th><th>Days</th><th>Conviction</th><th>Evidence</th><th></th></tr></thead>
                <tbody className="divide-y divide-border">{s.open.map((p: any) => (
                  <tr key={p.positionId} className="align-top">
                    <td className="py-2"><div className="font-semibold">{p.symbol}</div><div className="text-xs text-muted-foreground">in {money(p.entry.priceCents)} · {when(p.openedAt)}</div></td>
                    <td className="py-2 tabular-nums">{money(p.amountCents)}</td>
                    <td className="py-2 tabular-nums">{money(p.valueCents)}<div className="text-xs text-muted-foreground">{p.exit ? `${money(p.exit.priceCents)} · ${when(p.exit.at)}${p.priceStale ? " · market closed or delayed" : ""}` : "No live price"}</div></td>
                    <td className={`py-2 tabular-nums ${tone(p.returnPct)}`}>{pct(p.returnPct)}</td>
                    <td className={`py-2 tabular-nums ${tone(p.vsSpyPct)}`}>{pct(p.vsSpyPct)}</td>
                    <td className="py-2 tabular-nums">{p.ageDays}</td>
                    <td className="py-2 tabular-nums">{p.conviction}</td>
                    <td className="py-2 tabular-nums">{p.evidenceScore ?? "—"}</td>
                    <td className="py-2 text-right"><button disabled={busy} onClick={() => close(p)} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent">Close</button></td>
                  </tr>))}</tbody>
              </table></div>
            ) : <p className="text-sm text-muted-foreground">No open practice positions. Open one from a case in the Brief (“Practice-trade this”) or with the form.</p>}
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-1 font-semibold">What works for you</h3>
            <p className="mb-3 text-xs text-muted-foreground">Your trades grouped by Sentinel’s evidence score and by your own conviction. Median shown from 5 trades per group; fewer is too few to judge.</p>
            <div className="grid gap-4 md:grid-cols-2">{(["byEvidence", "byConviction"] as const).map(k => (
              <div key={k}><h4 className="mb-2 text-sm font-medium">{k === "byEvidence" ? "By evidence score" : "By your conviction"}</h4>
                {s?.scorecard?.[k]?.length ? <ul className="space-y-1 text-sm">{s.scorecard[k].map((b: any) => <li key={b.band} className="flex justify-between gap-2"><span>{b.band}</span><span className="tabular-nums text-muted-foreground">{b.trades} trades · {b.beatSpy} beat SPY · {b.enough ? <span className={tone(b.medianVsSpyPct)}>median {pct(b.medianVsSpyPct)}</span> : "too few"}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">No priced trades yet.</p>}
              </div>))}</div>
          </div>

          <PracticeRisk />

          <AutoPractice />

          {s?.closed?.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="mb-3 font-semibold">Closed</h3>
              <ul className="divide-y divide-border text-sm">{[...s.closed].reverse().map((p: any) => (
                <li key={p.positionId} className="py-2"><span className="font-semibold">{p.symbol}</span> · {money(p.amountCents)} → {money(p.valueCents)} · <span className={tone(p.returnPct)}>{pct(p.returnPct)}</span> · <span className={tone(p.vsSpyPct)}>{pct(p.vsSpyPct)} vs SPY</span> · {p.ageDays} days<div className="text-xs text-muted-foreground">Thesis: {p.thesis} · Closed because: {p.closeReason}</div></li>))}</ul>
            </div>
          )}
        </div>

        <form onSubmit={open} className="space-y-3 rounded-xl border border-border bg-card p-5 lg:col-span-4">
          <h3 className="font-semibold">Open a practice position</h3>
          {form.caseId && <p className="rounded-md bg-muted px-2 py-1 text-xs">From a Sentinel case; its evidence score is recorded with the trade.</p>}
          <label className="block text-sm">Symbol<input className={input} value={form.symbol} onChange={e => setForm({ ...form, symbol: e.target.value, caseId: null })} placeholder="e.g. MSFT" required /></label>
          <label className="block text-sm">Amount ($)<input className={input} inputMode="decimal" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required /><span className="text-xs text-muted-foreground">Available {money(s?.cashCents)}. Price is the live IEX midpoint, set by the server.</span></label>
          <label className="block text-sm">Your conviction: <span className="font-semibold tabular-nums">{form.conviction}</span>/100<input type="range" min={0} max={100} step={5} value={form.conviction} onChange={e => setForm({ ...form, conviction: Number(e.target.value) })} className="w-full" /><span className="text-xs text-muted-foreground">How sure are you? Recorded now so you can check later whether your confidence was right.</span></label>
          <label className="block text-sm">Thesis — why should this work?<textarea className={input} rows={2} value={form.thesis} onChange={e => setForm({ ...form, thesis: e.target.value })} required /></label>
          <label className="block text-sm">Exit plan — when do you take the gain or stop?<input className={input} value={form.exitPlan} onChange={e => setForm({ ...form, exitPlan: e.target.value })} placeholder="e.g. +15% or after Q1 results" required /></label>
          <label className="block text-sm">What would prove you wrong?<input className={input} value={form.killCondition} onChange={e => setForm({ ...form, killCondition: e.target.value })} placeholder="e.g. guidance cut, revenue falls" required /></label>
          <button disabled={busy || !s} className="w-full rounded-md bg-[#cbf47b] px-3 py-2 text-sm font-semibold text-black disabled:opacity-50">{busy ? "Recording…" : "Open practice position"}</button>
          <p className="text-xs text-muted-foreground">{s?.notes ?? "Practice only. No real orders."}</p>
        </form>
      </div>

      <Collapsible>
        <CollapsibleTrigger className="text-sm text-muted-foreground hover:text-foreground">Earlier $50 practice ledger (manual prices) ▾</CollapsibleTrigger>
        <CollapsibleContent className="pt-3"><PaperPortfolio /></CollapsibleContent>
      </Collapsible>
    </section>
  );
}
