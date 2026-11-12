"use client";
import { useEffect, useState } from "react";

/* Following: is each thesis still holding, and what changed this week. Quiet when nothing changed. */

const STATUS_STYLE: Record<string, string> = {
  Broken: "border-rose-400/50 bg-rose-400/10 text-rose-300",
  Weakening: "border-amber-400/50 bg-amber-400/10 text-amber-300",
  Holding: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  "Can't check": "border-slate-400/30 bg-slate-400/10 text-slate-300",
  "No thesis": "border-border bg-muted text-muted-foreground",
};
const KIND: Record<string, string> = { filing: "Filing", news: "News", alert: "Alert", case: "Case", evaluation: "Check" };

export function FollowingMonitor() {
  const [d, setD] = useState<any>(null), [error, setError] = useState("");
  useEffect(() => { fetch("/api/following", { cache: "no-store" }).then(async r => { const j: any = await r.json(); if (!r.ok) throw new Error(j.error || "Following could not be loaded."); setD(j); }).catch(e => setError(e.message)); }, []);
  if (error) return <div className="feed-warning" role="alert">{error}</div>;
  if (!d) return <p className="feed-footnote">Loading followed companies…</p>;
  return (
    <section className="mb-8 space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Following</h2>
        <p className="mt-1 text-[15px]">{d.summary}</p>
        <p className="text-xs text-muted-foreground">Status comes only from your own kill criteria: Broken = a criterion tripped · Weakening = a condition is already met but not yet for long enough · Holding = every criterion evaluated and passing · Can’t check = something could not be evaluated (never counted as holding).</p>
      </div>
      {d.rows.length ? (
        <ul className="space-y-3">{d.rows.map((r: any) => (
          <li key={r.entityId} className={`rounded-xl border border-border bg-card p-4 ${r.changed || r.status === "Broken" || r.status === "Weakening" ? "" : "opacity-80"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[r.status]}`}>{r.status}</span>
              <span className="font-semibold">{r.name}</span>{r.ticker && <span className="text-sm text-muted-foreground">{r.ticker}</span>}
              <span className="ml-auto text-xs text-muted-foreground">{r.changed ? `${r.changes.length} change${r.changes.length === 1 ? "" : "s"} this week` : "No change this week"}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{r.why}</p>
            {r.thesis && <p className="mt-1 text-sm"><span className="font-medium">Your thesis: </span><span className="text-muted-foreground">{r.thesis.text.length > 220 ? r.thesis.text.slice(0, 220) + "…" : r.thesis.text}</span></p>}
            {r.changed && <ul className="mt-2 space-y-1 border-t border-border pt-2 text-sm">{r.changes.map((c: any, i: number) => (
              <li key={i}><span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-[11px]">{KIND[c.kind] ?? c.kind}</span>{c.url ? <a className="hover:underline" href={c.url} target="_blank" rel="noreferrer">{c.text}</a> : c.text}{c.at && <span className="text-xs text-muted-foreground"> · {String(c.at).slice(0, 10)}</span>}</li>))}</ul>}
          </li>))}</ul>
      ) : <p className="text-sm text-muted-foreground">You are not following any company yet. Add one in Company files.</p>}
    </section>
  );
}
