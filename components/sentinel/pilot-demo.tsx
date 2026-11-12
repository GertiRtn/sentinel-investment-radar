"use client";

import { useState } from "react";

type Asset = "Bitcoin" | "Apple";
type Step = 0 | 1 | 2;

const examples: Record<Asset, { symbol: string; kind: string }> = {
  Bitcoin: { symbol: "BTC", kind: "Crypto" },
  Apple: { symbol: "AAPL", kind: "Stock" },
};

export function PilotDemo() {
  const [asset, setAsset] = useState<Asset>("Bitcoin");
  const [step, setStep] = useState<Step>(0);
  const selected = examples[asset];

  function chooseAsset(next: Asset) {
    setAsset(next);
    setStep(0);
  }

  return (
    <section className="pilot">
      <div className="pilot-heading">
        <div>
          <span className="pilot-kicker">INTERACTIVE WALKTHROUGH</span>
          <h2>Explore your trading pilot</h2>
          <p>See how Sentinel could explain a simulated trade, step by step.</p>
        </div>
        <span className="pilot-badge">Example only · no real money</span>
      </div>

      <div className="pilot-notice">
        <strong>This is a demonstration.</strong> Prices and decisions are made-up examples.
        No brokerage is connected. It doesn’t monitor markets or place orders.
        Your walkthrough resets when you leave or reload this page.
      </div>

      <div className="pilot-layout">
        <div className="pilot-main">
          <div className="pilot-panel">
            <div className="pilot-section-head">
              <div><span className="pilot-kicker">YOUR EXAMPLE PORTFOLIO</span><h3>Your practice balance</h3></div>
              <span className="pilot-badge">Illustrative USD</span>
            </div>
            <div className="pilot-balance">${step === 2 ? "52.00" : "50.00"}</div>
            <p className="pilot-muted">{step === 2 ? "+$2.00 in this example" : "Starting with $50 in pretend money"}</p>
            <div className="pilot-stats">
              <div><span>Available cash</span><strong>${step === 1 ? "30.00" : step === 2 ? "52.00" : "50.00"}</strong></div>
              <div><span>Example investment</span><strong>${step === 1 ? "20.00" : "0.00"}</strong></div>
              <div><span>Example gain</span><strong>{step === 2 ? "+$2.00" : "$0.00"}</strong></div>
            </div>
            <p className="pilot-footnote">This walkthrough assumes zero fees to keep the maths simple. Real costs would reduce the result.</p>
          </div>

          <div className="pilot-panel">
            <span className="pilot-kicker">TRY THE EXPERIENCE</span>
            <h3>Choose an example</h3>
            <p className="pilot-muted">Choose crypto or a stock. Both use the same fictional prices for this walkthrough.</p>
            <div className="pilot-switch" role="group" aria-label="Choose example asset">
              {(Object.keys(examples) as Asset[]).map(name => (
                <button key={name} type="button" aria-pressed={asset === name} className={asset === name ? "selected" : ""} onClick={() => chooseAsset(name)}>
                  {name} <span>{examples[name].symbol}</span>
                </button>
              ))}
            </div>
            <div className="pilot-story">
              <div className="pilot-story-head"><span className="pilot-round">{selected.symbol.slice(0, 1)}</span><div><strong>{asset}</strong><p>{selected.kind} · fictional example</p></div><span className="pilot-step">STEP {step + 1} OF 3</span></div>
              <h3>{step === 0 ? "Start with an idea" : step === 1 ? "See the simulated purchase" : "See the simulated result"}</h3>
              <p>{step === 0
                ? "In this example, imagine Sentinel finds a signal to explore. A real strategy and its evidence would need to be connected and tested."
                : step === 1
                  ? "The example buys $20 at a fictional price of $100 per unit. That gives you 0.20 units and leaves $30 in practice cash."
                  : "The fictional price rises to $110. Selling 0.20 units returns $22, making a $2 example gain before fees."}</p>
              <div className="pilot-explanation"><strong>What Sentinel would explain</strong><span>{step === 0 ? "The signal, the source and what could go wrong." : step === 1 ? "Why it entered, the price used and the size of the trade." : "Why it exited, the costs and how the outcome compares with a benchmark."}</span></div>
              <div className="pilot-actions">
                {step < 2 ? <button type="button" className="primary-button" onClick={() => setStep((step + 1) as Step)}>{step === 0 ? "Show example purchase" : "Show example result"} →</button> : <button type="button" className="primary-button" onClick={() => setStep(0)}>Start again</button>}
                {step > 0 && <button type="button" className="text-button" onClick={() => setStep((step - 1) as Step)}>← Go back</button>}
              </div>
            </div>
          </div>
        </div>
        <aside className="pilot-aside">
          <div className="pilot-panel">
            <span className="pilot-kicker">HOW THE PILOT WILL WORK</span>
            <h3>From idea to evidence</h3>
            <ol className="pilot-steps">
              <li><strong>Watch</strong><span>Collect market information and sources.</span></li>
              <li><strong>Decide</strong><span>Apply a tested rule and explain the result.</span></li>
              <li><strong>Simulate</strong><span>Record practice trades and estimated costs.</span></li>
              <li><strong>Review</strong><span>Compare results with doing nothing or holding.</span></li>
            </ol>
          </div>
          <div className="pilot-panel pilot-connection">
            <span className="pilot-kicker">PLATFORM CONNECTION</span>
            <h3>Not connected yet</h3>
            <p>Binance, Revolut X and other options are being evaluated. A real connection and live trading need separate setup and testing.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
