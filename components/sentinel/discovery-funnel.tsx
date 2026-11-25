"use client";
import { useState } from "react";

/* Discovery funnel (discovery-funnel-v1): counts of stored records, loaded only on request. Read-only. */
export function DiscoveryFunnel() {
  const [d, setD] = useState<any>(null), [hours, setHours] = useState(96), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function load(h: number) { setHours(h); setBusy(true); setError(""); try { const r = await fetch(`/api/discovery-funnel?hours=${h}`, { cache: "no-store" }); const j: any = await r.json(); if (!r.ok) throw new Error(j.error || "Could not load the counts."); setD(j); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }
  const Row = ({ label, value, def }: { label: string; value: React.ReactNode; def?: string }) => <tr className="border-t border-border align-top"><td className="py-1 pr-3">{label}</td><td className="pr-3 tabular-nums">{value}</td><td className="text-muted-foreground">{def}</td></tr>;
  return (
    <details className="coverage-panel" onToggle={e => { if ((e.target as HTMLDetailsElement).open && !d && !busy) load(96); }}>
      <summary>From reports found to cases assessed (counts)</summary>
      <div className="mt-2 flex gap-2 text-xs">{[[24, "24 hours"], [96, "96 hours"], [168, "7 days"]].map(([h, l]) => <button key={h} type="button" onClick={() => load(h as number)} disabled={busy} className={`rounded-md border border-border px-2 py-1 ${hours === h ? "bg-muted" : ""}`}>{l}</button>)}</div>
      {error && <p role="alert">{error}</p>}{busy && <p>Counting…</p>}
      {d && <>
        <table className="mt-2 w-full text-xs"><tbody>
          <Row label="Found" value={`${d.found.reports} reports · ${d.found.pairs} report × symbol`} def={d.found.definition} />
          <Row label="Deduplicated" value="not recorded" def={d.deduplicated.text} />
          <Row label="Eligible" value={`${d.eligible.reports} · ${d.eligible.pairs}`} def={d.eligible.definition} />
          <Row label="Not eligible" value={`${d.notEligible.reports} · ${d.notEligible.pairs}`} def={d.notEligible.definition} />
          <Row label="Assessed" value={<>{d.assessed.pairs}<br />meets rules {d.assessed.byConclusion.meetsRules} · watch {d.assessed.byConclusion.watch} · not enough data {d.assessed.byConclusion.notEnoughData}<br />good {d.assessed.byNewsDirection.good} · neutral {d.assessed.byNewsDirection.neutral} · mixed {d.assessed.byNewsDirection.mixed} · bad {d.assessed.byNewsDirection.bad}{typeof d.assessed.byNewsDirection.notCompanyNews === "number" ? <> · not company news {d.assessed.byNewsDirection.notCompanyNews}</> : null}</>} def={d.assessed.definition} />
          <Row label="Pending" value={d.pending.pairs} def={d.pending.definition} />
          <Row label="Cooling down" value={d.coolingDown.pairs} def={d.coolingDown.definition} />
          <Row label="Aged out" value={d.agedOut.pairs} def={d.agedOut.definition} />
          <Row label="Rejected" value={<>no topic match {d.rejected.notEligible}<br />different company {d.rejected.wrongCompany}<br />bad or mixed news {d.rejected.badOrMixedNews}</>} def={d.rejected.definition} />
        </tbody></table>
        <p className="feed-footnote">{d.capacity.text} {d.reconciliation.ok ? "The counts reconcile." : "The counts do not reconcile:"}</p>
        {!d.reconciliation.ok && <ul>{d.reconciliation.checks.filter((c: any) => !c.ok).map((c: any) => <li key={c.name}>{c.name}: {c.left} against {c.right} (difference {c.difference})</li>)}</ul>}
        <p className="feed-footnote">{d.note}</p>
      </>}
    </details>
  );
}
