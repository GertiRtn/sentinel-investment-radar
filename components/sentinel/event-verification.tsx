"use client";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

/* Event evidence (event-verify-v1): separate from the company match. Never green: "supported" means a filing names the counterparty, nothing more. */

const when = (iso: string | null | undefined) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "unknown");
const TONE: Record<string, string> = { supported: "bg-sky-400/15 text-sky-200", conflicting: "bg-amber-400/15 text-amber-200", wrong_company: "bg-red-400/20 text-red-200" };

export function EventVerification({ caseId }: { caseId: string }) {
  const [v, setV] = useState<any>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    setV(null); setError("");
    fetch(`/api/event-verification?case=${encodeURIComponent(caseId)}`, { cache: "no-store" }).then(r => r.json().then((j: any) => { if (!r.ok) throw new Error(j.error || "Unavailable"); setV(j.verification); })).catch(e => setError(e.message));
  }, [caseId]);
  async function check() {
    setBusy(true); setError("");
    try { const r = await fetch("/api/event-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseId }) }); const j: any = await r.json(); if (!r.ok) throw new Error(j.error || "The check could not run."); setV(j.verification); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  const canCheck = v && !["wrong_company", "not_company_event"].includes(v.state);
  return (
    <div className="mt-1 rounded border border-border p-2">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span><span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${TONE[v?.state] ?? "bg-muted"}`}>Event evidence: {v ? v.label : "loading…"}</span></span>
        {canCheck && <button type="button" onClick={check} disabled={busy} className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50">{busy ? "Reading SEC filings…" : v.state === "not_checked" ? "Check the company’s SEC filings" : "Check again"}</button>}
      </div>
      {error && <p className="mt-1 text-amber-200">{error}</p>}
      {v && <p className="mt-1 text-muted-foreground">{v.reason}</p>}
      {v?.stage && <p className="mt-0.5 text-muted-foreground">Stage: {v.stage.text}</p>}
      {v?.evidence?.length > 0 && <ul className="mt-1 space-y-1">
        {v.evidence.map((e: any) => <li key={e.accession + e.documentName} className="rounded bg-muted/40 p-1.5">
          {e.matched.map((m: any) => <blockquote key={m.kind + m.term} className="border-l-2 border-sky-400/50 pl-2 italic">“{m.span}”</blockquote>)}
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            <a className="inline-flex items-center gap-0.5 underline" href={e.documentUrl} target="_blank" rel="noreferrer">{e.form} {e.accession} · {e.documentName}<ExternalLink size={9} /></a>
            {` · filed ${e.filedAt} · read by Sentinel ${when(e.capturedAt)} · `}
            <span className={e.availableAtAssessment ? "" : "text-amber-200"}>{e.availableAtAssessment ? "public when the case was assessed" : "filed after the case was assessed (later information)"}</span>
          </div>
        </li>)}
      </ul>}
      {v?.checkedAt && <details className="mt-1 text-[10px] text-muted-foreground"><summary className="cursor-pointer">What was examined ({v.examined?.length ?? 0} filing{v.examined?.length === 1 ? "" : "s"}) · checked {when(v.checkedAt)}</summary>
        <ul className="mt-1 space-y-0.5">{(v.examined ?? []).map((f: any) => <li key={f.accession}>{f.form} {f.accession}, filed {f.filedAt}{f.items ? `, items ${f.items}` : ""}{f.later ? " (later filing, timeline only)" : ""}: {f.documents.map((d: any) => `${d.name} ${d.read ? "read" : `unreadable${d.error ? ` (${d.error})` : ""}`}`).join("; ") || "no documents"}{f.error ? ` · ${f.error}` : ""}</li>)}</ul>
        {v.claim && <p className="mt-1">Looked for: {[...(v.claim.counterparties ?? []), ...(v.claim.amounts ?? [])].join(", ") || "nothing checkable in the headline"}.</p>}
        {v.limits && <p className="mt-1">{v.limits}</p>}
      </details>}
    </div>
  );
}
