"use client";
import { ExternalLink } from "lucide-react";
import { EventVerification } from "./event-verification";
import { MarketModel } from "./market-model";

/* Investment thesis panel (investment-thesis-v1): five questions about one case, from stored records and fixed rules. */

const when = (iso: string | null | undefined) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "unknown");
const pct = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` : "—");
const H = ({ n, children }: { n: string; children: React.ReactNode }) => <h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-foreground">{n}</span>{children}</h5>;
const MATCH: Record<string, string> = { supported: "bg-sky-400/15 text-sky-200", uncertain: "bg-amber-400/15 text-amber-200", likely_wrong: "bg-red-400/20 text-red-200" };

function Point({ o, sign }: { o: any; sign: "+" | "−" }) {
  const unknown = o.status === "unknown";
  return (
    <li className="rounded border border-border p-2">
      <div>{unknown ? <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase">Unknown</span> : <span className={`mr-1 font-semibold ${sign === "+" ? "text-sky-300" : "text-amber-300"}`}>{sign}</span>}{o.text}</div>
      <div className="mt-0.5 text-muted-foreground">{o.establishes}</div>
      {!unknown && <div className="mt-0.5 text-[10px] text-muted-foreground">
        {o.basis}{o.periods?.latest ? ` · period to ${o.periods.latest}${o.periods.prior ? `, compared with period to ${o.periods.prior}` : ""}` : ""}
        {o.source && (o.source.accession || o.source.url) && <> · {o.source.url ? <a className="inline-flex items-center gap-0.5 underline" href={o.source.url} target="_blank" rel="noreferrer">{o.source.accession ?? "source"}<ExternalLink size={9} /></a> : o.source.accession}{o.source.filed ? `, filed ${o.source.filed}` : ""}</>}
      </div>}
    </li>
  );
}
function Move({ w, symbol }: { w: any; symbol: string }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="flex flex-wrap items-center justify-between gap-1"><span className="font-medium">{w.label}: {w.from} → {w.to} closes</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${w.timing === "known_at_assessment" ? "bg-sky-400/15 text-sky-200" : "bg-amber-400/15 text-amber-200"}`}>{w.timing === "known_at_assessment" ? "Known when the case was assessed" : "Later than the assessment"}</span></div>
      <div className="mt-1 tabular-nums">{symbol} <span className="font-semibold">{pct(w.stockPct)}</span> · SPY <span className="font-semibold">{pct(w.spyPct)}</span> · difference <span className="font-semibold">{pct(w.vsSpyPct)}</span></div>
    </div>
  );
}

export function ThesisPanel({ t, onLoadPrices, loadingPrice, caseId, marketModel }: { t: any; onLoadPrices: () => void; loadingPrice: boolean; caseId?: string; marketModel?: any }) {
  const a = t.appeared, v = t.priceValuation.valuation, m = t.priceValuation.priceMove;
  return (
    <div className="space-y-4 rounded-lg border border-sky-400/40 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">Investment thesis{t.symbol && <a href={`/company?symbol=${encodeURIComponent(t.symbol)}`} className="ml-2 text-[11px] font-normal text-muted-foreground underline">Company page</a>}</h4><span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">Rules only · no AI · not advice</span></div>
      {!t.promoted && <p className="rounded border border-red-400/40 bg-red-400/10 p-2 text-red-100">Sentinel does not put this forward as an idea: the report is probably about a different company.</p>}

      <section><H n="A">Why this case appeared</H>
        <p className="text-sm">{a.headline ?? "No headline recorded"}{a.url && <a className="ml-1 inline-flex items-center gap-0.5 text-xs underline" href={a.url} target="_blank" rel="noreferrer">source<ExternalLink size={10} /></a>}</p>
        <p className="mt-0.5 text-muted-foreground">{a.source ?? "Unknown source"} · published {when(a.publishedAt)} · assessed by Sentinel {when(a.assessedAt)} · {a.readNote}</p>
        <p className="mt-1"><span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${MATCH[a.match.status]}`}>Company match: {a.match.label}</span><span className="text-muted-foreground">{a.match.text}</span></p>
        <p className="mt-1"><span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase">{a.eventType.label}</span><span className="text-muted-foreground">{a.eventType.text}</span></p>
        {caseId && <EventVerification caseId={caseId} />}
      </section>

      <section><H n="B">What supports a thesis</H>
        {t.supports.length > 0 && <ul className="space-y-1.5">{t.supports.map((o: any, i: number) => <Point key={i} o={o} sign="+" />)}</ul>}
        {t.supportsNote && <p className="text-muted-foreground">{t.supportsNote}</p>}
        {t.counts.supports > t.supports.length && <p className="mt-1 text-[10px] text-muted-foreground">{t.counts.supports - t.supports.length} more in “What changed?” below.</p>}
      </section>

      <section><H n="C">What challenges it</H>
        <ul className="space-y-1.5">{t.challenges.map((o: any, i: number) => <Point key={i} o={o} sign="−" />)}</ul>
        {t.challengesNote && <p className="mt-1 text-muted-foreground">{t.challengesNote}</p>}
      </section>

      <section><H n="D">Price and valuation</H>
        {m.status === "not_loaded" ? <button onClick={onLoadPrices} disabled={loadingPrice} className="rounded-md border border-border px-2.5 py-1 hover:bg-accent disabled:opacity-50">{loadingPrice ? "Loading daily prices…" : "Show how the stock moved vs SPY"}</button>
          : m.status === "unavailable" ? <p><span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 font-semibold">Unavailable</span><span className="text-muted-foreground">Price move: {m.reason}</span></p>
          : <div className="space-y-1.5">
              {m.before ? <Move w={m.before} symbol={m.symbol} /> : <p className="text-muted-foreground">Before the report: {m.beforeMissing}</p>}
              {m.after ? <Move w={m.after} symbol={m.symbol} /> : <p className="text-muted-foreground">Since the report: no completed session yet.</p>}
              <p className="text-[10px] text-muted-foreground">{m.source}, adjustment “{m.adjustment}”, fetched {when(m.fetchedAt)}. Stock and SPY use the same dates. Last close before the report: {m.lastCloseBeforeEvent}.</p>
              <MarketModel m={marketModel} />
            </div>}
        <p className="mt-2">{v.status === "indicative" ? <>Indicative P/E <span className="font-semibold tabular-nums">{v.pe.toFixed(1)}</span> <span className="text-muted-foreground">— price: {v.priceBasis}{typeof v.price === "number" ? ` ($${v.price.toFixed(2)})` : ""}, {when(v.priceTime)} · annual diluted EPS{typeof v.eps === "number" ? ` $${v.eps.toFixed(2)}` : ""} for {v.epsPeriod.start ?? "?"} to {v.epsPeriod.end ?? "?"}{v.accession ? ` (${v.accession})` : ""}. {v.limitation}</span></> : <><span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 font-semibold">Unavailable</span><span className="text-muted-foreground">P/E: {v.reason}</span></>}</p>
        <p className="mt-1"><span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 font-semibold">Unknown</span><span className="text-muted-foreground">Expectations: {t.priceValuation.expectations}</span></p>
        <p className="mt-1 text-[10px] text-muted-foreground">{t.priceValuation.caveat}</p>
      </section>

      <section><H n="E">What would change the view</H>
        <ol className="list-decimal space-y-1 pl-5">{t.questions.map((q: any) => <li key={q.question}>{q.question} <span className="text-muted-foreground">{q.why}</span></li>)}</ol>
      </section>
      <p className="text-[10px] text-muted-foreground">{t.basis}</p>
    </div>
  );
}
