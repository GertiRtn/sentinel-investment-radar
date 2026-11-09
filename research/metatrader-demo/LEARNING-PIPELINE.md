# Learning pipeline — initial design

Status: proposal. No automated learning, model training, experiment tracking,
candidate promotion or MT5 demo trading is implemented. The Strategy Tester
prototype is a fixed rule, not AI. Record initial observations as reported,
preserving the original evidence and uncertainty.

## Baseline observed from user screenshots, 2026-11-09

- `SentinelTesterPilot` v1.00 compiled with zero errors and warnings.
- Strategy Tester: EURUSD, H1, 2026-01-01 to 2026-11-08 as displayed,
  $10,000 deposit, 1:100 leverage, every-tick model, ideal execution,
  optimization disabled. Tick model is not labeled real-tick in the screenshot.
- Report: net -$22.45, 9 trades, 2 winners, 7 losers, maximum equity drawdown
  $52.17 (0.52%). End of journal: final balance $9,977.55; at least four
  checks skipped for an unknown member of volume/settings/spread conditions.
- Screenshot evidence only: the entire log, actual inputs, detailed trade
  ledger, data provenance and fees have not been independently verified.
  History quality 100% is the tester's report, not proof of correct inputs.

## Proposed pipeline

1. Capture immutable experiment metadata: exact strategy source/hash and inputs,
   data source and timestamp, price history, costs, symbol specifications and
   test environment. Export the full journal and trade report.
2. Log each decision and trade, including prices, spread, skip reason, fill,
   position, charges and outcome, and keep records in timestamp order.
3. Generate explicitly versioned candidate changes using only information
   available at the time. Record every trial, including failures; do not choose
   changes because they fit one trade or retrospectively adjust the baseline.
4. Validate on chronological training and later untouched test periods; use
   walk-forward and multiple market regimes, realistic costs, no-trade and
   relevant market baselines. Preserve a final holdout. Track drawdown, turnover,
   exposure, trade count, uncertainty and results rather than one score.
5. Evaluate approved candidates in shadow mode and then demo trading, recording
   all revisions. Define explicit risk limits and manual review before any
   promotion; never silently alter a real-money strategy from recent trades.
6. Monitor drift, repeated errors and outages, and pause on missing data or
   uncertain execution. No learning process can guarantee profits.

The user asked about learning before every trade; per-trade adaptation is a
research idea, not yet a validated requirement. One trade is weak evidence,
and continuously changing rules can fit noise and invalidate comparison. Start
with fixed versions and scheduled evaluations. Real-account operation requires
separate design, permissions and validation.
