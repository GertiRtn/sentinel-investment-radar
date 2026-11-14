"use client";

/* Market comparison (market-model-v1): how the stock moved with the market before the event, and its
   market-adjusted move after. Describes the past only: no forecast, no advice, no colour for "good" or "bad". */

const pct = (v: number | null | undefined, d = 1) => (typeof v === "number" && Number.isFinite(v) ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}%` : "—");
const day = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function MarketModel({ m }: { m: any }) {
  if (!m) return null;
  if (m.status !== "ok") return (
    <p className="mt-2"><span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 font-semibold">Unavailable</span>
      <span className="text-muted-foreground">Market comparison: {m.reason} Needed: {m.needed}</span></p>
  );
  const s = m.sensitivity, e = m.event;
  return (
    <div className="mt-2 rounded border border-border p-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">Compared with the market</span>
        <span className="text-[10px] text-muted-foreground">{day(s.from)} – {day(s.to)} · {s.matchedDays} trading days before the report</span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
        <span className="text-lg font-semibold tabular-nums">{s.beta.toFixed(2)}×</span>
        <span className="text-muted-foreground">market sensitivity (beta)</span>
      </div>
      <p className="mt-0.5">{s.betaText}</p>
      <p className="text-muted-foreground">{s.fitText}</p>

      {e.horizons.length ? (
        <table className="mt-2 w-full text-left tabular-nums">
          <caption className="mb-1 text-left text-[10px] text-muted-foreground">After the report, from the close on {day(e.lastCloseBeforeEvent)}</caption>
          <thead className="text-[10px] uppercase text-muted-foreground"><tr><th className="font-medium">Sessions</th><th className="font-medium">{m.symbol}</th><th className="font-medium">Market (SPY)</th><th className="font-medium">Expected from market</th><th className="font-medium">Market-adjusted</th></tr></thead>
          <tbody>{e.horizons.map((h: any) => (
            <tr key={h.sessions} className="border-t border-border">
              <td className="py-1">{h.sessions}{h.laterInformation && <span className="ml-1 rounded bg-amber-400/15 px-1 text-[9px] text-amber-200" title="Closed after Sentinel assessed the case">Later</span>}</td>
              <td>{pct(h.stockPct)}</td><td>{pct(h.marketPct)}</td><td>{pct(h.expectedPct)}</td><td className="font-semibold">{pct(h.adjustedPct)}</td>
            </tr>))}</tbody>
        </table>
      ) : <p className="mt-2 text-muted-foreground">After the report: {e.note}</p>}

      <details className="mt-2 text-[10px] text-muted-foreground">
        <summary className="cursor-pointer">How this is calculated and what it does not show</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>Beta is the slope of a regression of the stock’s daily returns on SPY’s daily returns (with an intercept), using only the {s.matchedDays} matched trading days up to the last close before the report{s.missingSessions ? `; ${s.missingSessions} market session${s.missingSessions === 1 ? "" : "s"} had no stock price and were skipped` : ""}. A rough range is {s.betaLow.toFixed(2)} to {s.betaHigh.toFixed(2)}. Fit (R²): {(s.r2 * 100).toFixed(0)}%.</li>
          <li>“Expected from market” compounds beta × SPY’s daily return over the same sessions. “Market-adjusted” is the stock’s compounded move minus that. The stock’s past average drift (intercept, {s.alphaDailyPct.toFixed(3)}% a day) is not used; including it gives {e.horizons.map((h: any) => `${h.sessions}: ${pct(h.withAlpha.adjustedPct)}`).join(", ") || "—"}.</li>
          <li>Sum of daily differences from the model (CAR): {e.horizons.map((h: any) => `${h.sessions}: ${pct(h.carPct)}`).join(", ") || "—"}. The simple stock-minus-SPY difference shown above is a different measure: {e.horizons.map((h: any) => `${h.sessions}: ${pct(h.simpleVsSpyPct)}`).join(", ") || "—"}.</li>
          <li>{m.basis} Source: {m.source}, adjustment “{m.adjustment}”.</li>
          {m.limits.map((l: string) => <li key={l}>{l}</li>)}
          <li>Peer comparison: unavailable. {m.peers.reason} {m.peers.needed}</li>
        </ul>
      </details>
    </div>
  );
}
