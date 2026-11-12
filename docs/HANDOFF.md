
## 2026-11-09 — Codex — simpler starting screen

Added a Start here screen with paths to market updates, the watchlist, research examples and the journal. The future simulated trading pilot is labeled as upcoming. Existing workspace and research functionality are retained.

Verified: all 23 existing fixture tests passed. Managed preview did not finish starting in this environment, so browser interaction remains unverified.

Next: verify the navigation in the deployed site, then design the simulated pilot experience.

## 2026-11-09 — Codex — interactive pilot walkthrough

Replaced the inactive pilot placeholder with a clearly labeled, session-only walkthrough using fictional Bitcoin or Apple prices and a $50 example. The user can step through an illustrative purchase and sale; the UI states that there is no broker connection, automatic monitoring, live data, fees or persistence. No trading, portfolio, brokerage or existing data APIs were added. The 23 existing fixture tests passed. Browser preview service remained starting, so interactive browser verification was unavailable.

Next: validate real paper-trading data capture and a durable simulation ledger separately; never promote walkthrough values as real signals or account balances.

## 2026-11-10 — Codex — SEC quarterly research view

Production SEC runs for Etsy and Apple reported success; Etsy's 2025 revenue displayed by Sentinel was checked against its original 10-K. Added a separate view of directly reported approximately three-month facts, respecting filing and recorded cutoffs and keeping annual criteria unchanged. Year-to-date and instant figures are excluded; missing quarters are not estimated. Automatic monitoring is not active.

Verification: 25 Node tests passed in the site checkout, including fixture tests for historical cutoffs, restatements, and exclusion of non-quarter durations. The deployed quarterly view still needs a real-company comparison after publication. Run markers report processed observations rather than inserted fact counts; total ingest duration and payload sizes were not measured.

## 2026-11-10 — Codex — unattended SEC refresh preparation

Added an authenticated Site MCP tool that checks up to five saved companies per call, prioritizing the oldest prior attempt, and exposes the most recent check status on company files. It uses the caller's verified identity/contact and scopes its query to the caller's own watchlist. Existing SEC caching, rate limits, append-only captures, and failure records remain in use. No trading or background thesis evaluation is enabled.

Local verification: work-order03 tests passed including an actual fixture-backed refresh of three companies, rejection of missing identity, and isolation of another owner's empty watchlist; TypeScript passed. The tool and any proposed schedule require production authorization and independent readback verification; do not claim the schedule is working before then. SEC data may remain cached for 24 hours. One invocation checks at most five companies.

## 2026-11-10 — Codex — plain-language annual company summary

Added a deterministic sourced summary of latest annual revenue, net income and operating cash flow. Previous-period comparisons require the same tag, unit, a year-apart period and similar duration; percentage change is withheld for a nonpositive prior value. The UI identifies missing values, stale captures and reporting-scope caveats and cites both source records. It uses existing as-of-selected figures, does not infer investor recommendations or modify thesis checks. Corrected manual-refresh copy to acknowledge the scheduled check; first scheduled run remains unverified.

Verification: TypeScript passed; 28 tests passed on rerun including two new summary tests. An existing SEC rate timing test failed once under concurrent full-suite load and passed on rerun; timing flakiness remains an open issue. Build and deployed visual verification are tracked separately.

## 2026-11-10 — Codex — executive summary and filing explanation

Added a deterministic executive sentence from the sourced annual revenue, net income and operating cash flow comparisons, preserving unknowns and the selected cutoff. Added an on-demand current-view-only revenue explanation reader: it checks watchlist ownership, constructs a narrow SEC report URL from matched filing metadata, follows no redirects, uses the SEC rate limiter, archives and hashes the raw HTML, and displays only one unambiguous short direct statement. It does not infer causes or generate trading advice. Missing or ambiguous explanations remain unavailable. Historical views cannot use this current-source explanation.

Validation: TypeScript passed. The 30-test suite passed before the additional route integration test; the 11-test work-order suite passed after it, including access isolation, source capture and a synthetic filing statement. Live SEC narrative retrieval, real-world extraction and visual QA remain unverified. Source may contain multiple matching statements; in that case the reader intentionally returns unavailable. The earlier intermittent SEC request-timing test remains an open issue.

## 2026-11-10 — Codex — company summary clarity

Responded to founder feedback that the company summary was visually crowded. Kept the executive sentence and moved the three reported metrics into compact responsive cards; the direct company quote has a dedicated section. Exact figures, provenance, capture and caveats remain available in expandable sections. No calculation, source selection, filing reader, historical cutoff or trading behavior changed. Founder screenshot confirmed the Etsy revenue explanation from the deployed reader; no claim is made for every company.

Verification: 31 existing Node tests and TypeScript passed. The production build and visual review are tracked separately.

## 2026-11-10 — Codex — saved practice portfolio

Added a private, append-only $50 USD practice ledger under Trading pilot. User-entered symbol, quantity, price, source and reason create simulated trades with a 0.1% fee assumption (rounded up, minimum one cent). The server rejects insufficient cash, oversells and stale concurrent writes; retry identifiers make repeat requests idempotent. Portfolio state is rebuilt from immutable paper_trade signal records; no schema migrations or live orders. Original example remains accessible. Manually entered last trade prices are clearly labelled and are not a current valuation.

Verified: 32 Node tests passed, including D1-backed balance, fees, idempotency, oversell, account isolation and stale revision, and TypeScript passed. Build and visual QA tracked separately. This is manual paper trading only: no stock price feed, automated decisions, spread/slippage modelling, current valuation, profit/benchmark report or real broker integration. Scheduled SEC updater and all existing features remain separate.

## 2026-11-10 — Codex — first investment brief

Added a private, rules-based investment brief for SEC watchlist companies. It synthesizes available annual filing figures, identifies missing price, valuation, complete news and validation, and currently returns WAIT for every stock because those inputs are not connected. It does not claim to be a tested buy/sell strategy. Users may append a source-preserving, timestamped brief snapshot and see the last ten saved snapshots. Preserved company-file access, append-only signal_log and paper ledger; no real or simulated orders are placed. Current/previous values retain filing and capture references; stale data is flagged.

Verification: 33 tests passed, including D1-backed watchlist ownership, evidence, missing-price WAIT, snapshot persistence and duplicate retry; TypeScript passed. Live UI and production read/write remain unverified pending deployment. Next: investigate a permitted no-cost stock data source, add price timestamps and valuation evidence, then validate a decision rule in shadow mode; the existing WAIT-only prototype is not a directional recommendation engine.

## 2026-11-10 — Codex — Alpaca IEX stock quote adapter

Prepared a read-only stock-quote connection for saved SEC companies. Server-only credentials are optional; no account, secret or paid plan was added. The authenticated POST endpoint uses Alpaca's IEX latest quote endpoint, limits the symbol to the selected watched company, verifies bid/ask and provider timestamp, records the source and capture time, caches for 60 seconds, and reports stale quotes over five minutes old and provider errors honestly. The brief remains WAIT because a quote alone does not establish valuation or a tested strategy. Existing live and paper trading are not connected.

Verification: 36 Node tests and TypeScript passed, including fixture-backed owner isolation, source capture, secret redaction, caching, malformed/crossed/future data and stale marking. Actual Alpaca authentication, quote access, exchange entitlements, display and costs are unverified because no account/credentials are present. Alpaca's free IEX feed is a single-exchange quote, not the consolidated US market or an execution guarantee.
