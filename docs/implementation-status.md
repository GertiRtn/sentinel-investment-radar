# Sentinel build standard: implementation record

Applied against the supplied v2.0 standard on 16 September 2026.

## Delivered in this change

- Managed D1 SQLite persistence on the existing private Site. A separate VPS/WAL file would not fit this hosting runtime; no local file is used as the authoritative database.
- Append-only raw responses, facts, collector runs, workspace revisions, research records and prediction resolutions, protected by database triggers. Source-health state is intentionally mutable. Resolutions are separate records, so original predictions are never rewritten.
- Original decoded HTTP payload and SHA-256 content dedup; raw data is persisted before derived information is served. Original source publication times remain null when unavailable.
- Signed-in, owner-scoped workspace and journal APIs, same-origin writes, idempotent request IDs, optimistic revision checks. Legacy browser data is imported with a current migration timestamp; old creation dates are unknown. The original browser copy is retained.
- Three-attempt maximum retry with exponential backoff and jitter for transient failures; last-good values retained as stale, a five-minute circuit pause after three failed requested runs, and append-only operational incidents.
- Point-in-time history endpoint and UI, using only raw captures and completed runs known by the selected time. No artificial pre-installation history.
- Manual thesis, decision and prediction journal. Prediction probability is user-entered; a future resolution date and objective rule are required. Resolution is allowed once, no earlier than the chosen date, with evidence. Brier arithmetic is shown for resolved predictions, with no skill claim.
- Arbitrary manually entered research entities with stable internal IDs and explicit unverified identity. Canonical ticker/CIK/ISIN resolution remains pending. Revolut availability requires a user verification note before “confirmed.” This is not broker-verified.
- Full retrieved news pool available through “show more”; per-topic coverage description and counts of items published within 30 days in the retrieved feed window (not an invented complete 30-day count).
- Explicit topic-background label, without pretending this is full-release interpretation. Policy certainty remains unclassified rather than inferred from a headline.
- Connections relabelled Roadmap; setup-navigation glyph removed; sample alert timestamp added; duplicate path slashes normalized.

## Acceptance gates still open

The code is deployed for use; it has not passed a 48-hour continuous-run trial, 30 days of predictions, or any long-term return benchmark. Current collection remains request-triggered while the desk is open, so there is no always-on coverage and no “missing expected scheduled runs” metric yet. Feed outage incidents only describe actual requested runs.

The history view can answer retrospective questions only from its first real capture onwards. It cannot reconstruct yesterday before that start time.

## Next phases, not silently simulated

- A configured scheduler, delivery credentials, verified recipient and measured end-to-end notification latency. No Telegram message or paid subscription was initiated.
- SEC EDGAR integration with a proper contact user agent, canonical entity resolution and as-filed financial reconstruction for three companies.
- Structured investment memos, machine-evaluable thesis predicates, policy limits, cooling-off and a pre-trade gate. A journal entry is not a substitute for these and does not grant trade approval.
- Independent price-source reconciliation, corporate-action-aware history and international stock/gold providers. Current crypto values are single-source indicative references with reconciliation explicitly unknown, not approved decision inputs.
- Full-release text ingestion and grounded span-cited extraction; exposure evidence; event certainty and price-response checks. No headline-only AI analysis was introduced.
- Continuous feed-health monitoring, notification dedup/quiet hours/corrections, alert rate limits, outcome benchmarks, annual calibration and strategy evaluation.

## Corrections to assumptions in the supplied standard

- Companyfacts is valuable but does not by itself supply every requested ten-year metric, maintenance-capex estimate, debt covenant detail or qualitative moat assessment. Source coverage and derivation must be established per company.
- A cooling-off period can reduce impulsive decisions; it cannot guarantee protection from loss or market manipulation. The eventual flow must distinguish entering/adding to risk from urgent risk-reducing actions.
- An empty topic can sometimes be improved through additional primary sources. It is not proof that only a paid newswire could cover it.
- A source reference URL must reach the browser to support provenance. Credentials remain server-side; source links are intentionally visible.


## Work order 03 update — 17 September 2026
See work-order-03-verification.md for implemented additions, all nine verification results and remaining acceptance gates. The earlier pending lists above describe the previous release.
