"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { newId } from "@/lib/sentinel/client-id";

/* Research team panel: bull / bear / missing / editor for one case, with every source linked. */

const STATUS_TEXT: Record<string, string> = {
  ok: "Model answered; every statement passed the source checks.",
  partial: "Model answered; some statements failed the source checks and were dropped.",
  invalid: "The model's answer was unusable, so the rules template is shown instead.",
  unavailable: "The model could not be used, so the rules template is shown instead.",
  timeout: "The model did not answer in time, so the rules template is shown instead.",
  disabled: "The AI model is switched off. This is the rules template; no AI model ran.",
};
const when = (iso: string | null | undefined) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "unknown");

function Cites({ ids, pack }: { ids: string[]; pack: any }) {
  const items = ids.map(id => pack.items.find((i: any) => i.id === id)).filter(Boolean);
  return <span className="ml-1 text-[11px] text-muted-foreground">[{items.map((i: any, n: number) => <span key={i.id}>{n ? ", " : ""}{i.source.url ? <a className="underline" href={i.source.url} target="_blank" rel="noreferrer">{i.label}</a> : i.label}</span>)}]</span>;
}

export function ResearchTeamPanel({ caseId }: { caseId: string }) {
  const [state, setState] = useState<any>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const pending = useRef<string | null>(null);
  const load = useCallback(async () => {
    try { const r = await fetch(`/api/research-team?case=${encodeURIComponent(caseId)}`, { cache: "no-store" }); const j: any = await r.json(); if (!r.ok) throw new Error(j.error || "Research runs could not be loaded."); setState(j); }
    catch (e: any) { setError(e.message); }
  }, [caseId]);
  useEffect(() => { setState(null); setError(""); pending.current = null; load(); }, [load]);

  async function run() {
    if (busy) return; // a second click while running does nothing
    pending.current ??= newId(); // the same id is reused if this attempt is retried after a network error
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/research-team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: pending.current, caseId }) });
      const j: any = await r.json();
      if (!r.ok) { if (r.status !== 503) pending.current = null; throw new Error(j.error || "The research run failed."); }
      pending.current = null; await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  const latest = state?.runs?.[0], f = state?.feature;
  const pack = latest?.pack, out = latest?.output;
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="font-semibold">Research team</h4>
        <button onClick={run} disabled={busy || !state} className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50">{busy ? "Running… (up to 20 s)" : latest ? "Run again" : "Run research team"}</button>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        {f ? (f.enabled ? (f.keyConfigured && f.modelAllowed ? `AI model available: ${f.model}. One call per run; output is checked against the sources below.` : "AI model is switched on but not usable (missing key or model not allowed); runs will use the rules template.") : "AI model is off. Runs use a rules template built from the same sources; no AI model runs.") : "Loading…"}
      </p>
      {error && <p className="mb-2 rounded bg-amber-400/10 px-2 py-1 text-xs text-amber-200" role="alert">{error}</p>}
      {!latest && state && <p className="text-xs text-muted-foreground">No research run for this case yet.</p>}
      {latest && out && (
        <div className="space-y-3 text-sm">
          <div className="rounded bg-muted px-2 py-1 text-xs"><span className="font-semibold">{latest.mode === "model" ? "Model-assisted research (unvalidated)" : "Rules template — no AI model ran"}</span> · {STATUS_TEXT[latest.status] ?? latest.status}{latest.failure ? ` ${latest.failure}` : ""} · run {when(latest.createdAt)} · evidence as Sentinel held it on {when(latest.asOf)}</div>
          <div><h5 className="text-xs font-semibold uppercase tracking-wide text-sky-300">Possible positives</h5>
            {out.bull.length ? <ul className="mt-1 space-y-1.5">{out.bull.map((b: any, i: number) => <li key={i}>{b.point}<Cites ids={b.cites} pack={pack} /><div className="text-xs text-muted-foreground">Must hold: {b.must_hold}</div></li>)}</ul> : <p className="text-xs text-muted-foreground">None supported by the evidence.</p>}</div>
          <div><h5 className="text-xs font-semibold uppercase tracking-wide text-amber-300">Risks and counterarguments</h5>
            {out.bear.length ? <ul className="mt-1 space-y-1.5">{out.bear.map((b: any, i: number) => <li key={i}>{b.point}<Cites ids={b.cites} pack={pack} /><div className="text-xs text-muted-foreground">Would be wrong if: {b.invalidation}</div></li>)}</ul> : <p className="text-xs text-muted-foreground">None supported by the evidence — that is not evidence of safety.</p>}</div>
          <div><h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Missing information</h5>
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{[...new Set([...(out.evidence?.missing ?? []), ...(pack?.missing ?? [])])].slice(0, 10).map((m: any) => <li key={m}>{m}</li>)}</ul></div>
          <div><h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Editor</h5>
            {out.editor.synthesis ? <p>{out.editor.synthesis}<Cites ids={out.editor.cites} pack={pack} /></p> : <p className="text-xs text-muted-foreground">No synthesis passed the checks.</p>}
            {out.editor.disagreements.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs">{out.editor.disagreements.map((d: string, i: number) => <li key={i}>Open: {d}</li>)}</ul>}
            {out.editor.next_checks.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{out.editor.next_checks.map((d: string, i: number) => <li key={i}>Check: {d}</li>)}</ul>}</div>
          <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Sources ({pack?.items?.length ?? 0}), checks and dropped statements</summary>
            <ul className="mt-2 space-y-1.5">{pack?.items?.map((i: any) => <li key={i.id}><span className="font-medium">{i.label}</span>: {i.text ?? "—"}{i.stale ? <span className="ml-1 rounded bg-amber-400/20 px-1">stale</span> : null}{!i.shareable && <span className="ml-1 rounded bg-muted px-1">not sent to any model</span>}<div className="text-muted-foreground">{i.source.name}{i.source.accession ? ` · ${i.source.accession}` : ""} · source time {when(i.sourceTime)} · recorded {when(i.capturedAt)} · {i.confidence}{i.source.url && <> · <a className="inline-flex items-center gap-0.5 underline" href={i.source.url} target="_blank" rel="noreferrer">open <ExternalLink size={10} /></a></>}{i.note ? ` · ${i.note}` : ""}</div></li>)}</ul>
            {latest.dropped?.length > 0 && <div className="mt-2"><p className="font-medium">Dropped by the checks:</p><ul className="list-disc pl-5">{latest.dropped.map((d: any, i: number) => <li key={i}>{d.role}: {d.reason}</li>)}</ul></div>}
            <p className="mt-2 text-muted-foreground">Prompt {latest.promptVersion} · model {latest.model ?? "none"} · {latest.latencyMs} ms · {state.runs.length} run(s) kept for this case.</p>
          </details>
          <p className="text-[11px] text-muted-foreground">{latest.label} The screen result and evidence score above are unchanged by this panel.</p>
        </div>
      )}
    </div>
  );
}
