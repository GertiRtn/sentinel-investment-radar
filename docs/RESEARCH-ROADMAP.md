# Research roadmap (written 2026-11-12, research-team-v1 session)

This is a plan, not a set of features. Nothing here is live. Each item lists the data it needs before it is worth building, because a sophisticated model on poor data proves nothing.

## Done in this session

- **Research team v1.** An on-demand bull / bear / editor reading of one case (`lib/sentinel/research-team.ts`), built from a point-in-time evidence pack (`lib/sentinel/evidence-pack.ts`). It is off by default; a rules template runs instead.
- **Event backtest v1, offline only** (`lib/sentinel/event-backtest.ts`). Delayed fills at the next open after signal + latency, explicit spread, fee and slippage, an SPY comparator that pays the same costs, rejected fills when bars are missing, and determinism. It runs on fixtures only and makes no profitability claim.

## Next, in order

1. **Real integration check of the research team** (after the founder approves enabling it). Check whether the NVIDIA free tier's terms allow this use (it is described as prototyping/evaluation). Measure latency and the 429 rate. Label about 30 runs as useful / misleading / wrong before any wider use. The model must not feed rankings, labels or alerts.
2. **Backtest on Sentinel's own prospective cases.** Use stored case times and Alpaca daily bars. Add a market calendar, split/dividend handling (one adjustment basis), and delisting handling. Split the data chronologically into train / validation / untouched test, and log every variant tried. Compare with buy-and-hold SPY and a random-case baseline. Historical news timestamps from before Sentinel started are not verified, so no retrospective claims.
3. **Market regimes, transparent first.** Trailing SPY trend (e.g. price vs 200-day average), realised volatility and drawdown, all lagged one session, with versioned thresholds and an explicit "insufficient history" state. Report outcomes per regime, horizon and screen version without pooling. Clustering (e.g. K-means) comes later and offline, with scaling fitted on training data only and walk-forward assignment. Clusters describe; they do not forecast crises.
4. **Practice portfolio risk** (simulated positions only). *v1 prototype built 2026-11-12 (`practice-risk-v1`): concentration, coverage, a seeded historical bootstrap for VaR/ES, volatility, correlation and stresses. Still open: block bootstrap for volatility clustering, SPY beta, cost and slippage, and a horizon chosen by the user.* Concentration, pairwise correlation and trailing SPY beta from timestamped adjusted histories, with coverage and missing-history shown. Scenario stresses (wider spreads, simultaneous drawdowns, correlation to 1, unavailable fills). Monte Carlo VaR/ES only with a fixed seed and stated distribution, explaining that VaR is a threshold, not a maximum loss. Any hedge illustration includes borrow, financing, rebalancing and basis risk, and never implies protection.
5. **Three statements and peers.** Show sourced balance-sheet, income and cash-flow history with matching periods and explicit gaps. Peers are chosen by a human, with traceable identities, price, share class, currency and period. EV, debt, shares and EBITDA are never invented. A valuation range or margin of safety is allowed only with explicit user-entered or sourced assumptions, labelled hypothetical, with a sensitivity table.
6. **Earnings-call text.** Blocked until a licensed source with publication timestamps exists. Any sentiment label is qualitative and tested against a dictionary baseline out of sample.
7. **Deferred:** pairs trading, ML alpha, options and IV surfaces, order-book and RL work. These need licensed, timestamped data we don't have, and cost models we haven't built.

## Reference projects reviewed (2026-11-12)

| Project | Licence | What we take | What we don't |
|---|---|---|---|
| TauricResearch/TradingAgents | Apache-2.0 (Python, LangGraph) | Role pattern: separate bull and bear researchers, then a synthesiser; debate rounds kept short | Its trader/decision stage, multi-provider keys, yfinance/Alpha Vantage data defaults; nothing imported into the Worker |
| OpenBB-finance/OpenBB (ODP) | Apache-2.0 from v5 (earlier releases AGPL-3.0); licence covers software, not provider data | Provider-abstraction idea: one interface, per-provider entitlements recorded | Python service; each data provider has its own terms |
| microsoft/qlib | MIT (Python) | Offline experiment discipline: recorded configs, chronological splits, baselines | Its datasets (official download disabled; Yahoo-based fallback, unclear licence and not point-in-time) |

(The brief's OpenBB link has a typo: the repository is `OpenBB-finance/OpenBB`.)

## How the three books shaped v1 (design interpretations, not a trading system)

- **Margin of Safety (Klarman).** The pack separates the observed price (IEX quote, P/E) from value. "Intrinsic value estimate" is always listed as missing. The bear stage looks for permanent-loss mechanisms (losses, negative cash flow, dilution, debt above cash with negative cash flow) only where the figures show them. An empty result is allowed: waiting is a valid outcome.
- **Reminiscences of a Stock Operator (Lefèvre).** Headline, company figures and price are kept separate, each with its own time. Nothing claims a headline caused a move. Each point carries what must hold or what would make it wrong, stored append-only. A quote is labelled as not a guaranteed fill.
- **When Genius Failed (Lowenstein).** Dissent is preserved: bull and bear are not merged, and the editor lists open disagreements. Common-exposure, stress and leverage analysis are planned for the portfolio-risk item, not built.
