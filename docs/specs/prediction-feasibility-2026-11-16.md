# Prediction feasibility: findings (2026-11-16)

Question: is a *tested* outperformance model feasible for Sentinel? This is an investigation, not a model. Nothing here is in the app: no predictive number, probability or ranking reaches the UI or any API. Code: `scripts/research/` (offline only).

**Short answer:** feasible in principle for fundamentals, **blocked today on historical prices**. The harness exists and is tested on synthetic data; no real performance figure exists and none is claimed.

## What was checked, with evidence

| # | Question | Finding | Evidence |
|---|---|---|---|
| 1 | Historical daily prices | **Blocker.** This sandbox has no Alpaca key and cannot reach `data.alpaca.markets` (proxy 403); two free public price hosts are also refused. Not verified here: how far back the free Alpaca plan's IEX daily bars go, and whether the free plan serves full-market (SIP) data older than 15 minutes. Both must be read from Alpaca's current documentation and confirmed with one real request from the Site. | `curl` to `data.alpaca.markets`, `stooq.com`, `query1.finance.yahoo.com`: all refused by the network policy on 2026-11-16 |
| 2 | Point-in-time fundamentals | **Workable, with one trap.** `companyfacts` (per company) carries `filed` on every fact, which is what Sentinel stores as `known_from`. The bulk **frames** API (one request per tag and period, about 6,200 companies for CY2024 cash flow, under 1 s, about 1 MB) carries **no filing date** and only the latest value per period, so it silently includes restatements. Frames can list the universe; the point-in-time values must come from `companyfacts` (or the SEC's quarterly bulk "financial statement data sets", not tested). | Frames rows fetched 2026-11-16: keys `accn, cik, entityName, loc, start, end, val`, no `filed` |
| 3 | Other records that need a date | Prices (adjusted series change after every split or dividend: store the fetch time, as the archive does); share counts (cover-page date and filing date, now stored); index membership and "tradable at the time" (not stored anywhere); SIC code (today's only). | Code reading |
| 4 | Survivorship bias | **Fundamentals: not biased.** Of 6,946 companies with CY2012 operating cash flow in frames, 4,633 (67%) are no longer in SEC's current ticker list, so delisted and acquired filers are present. **Prices: unknown and probably biased.** Whether Alpaca serves bars for delisted symbols was not testable. If it does not, a backtest keeps only survivors and overstates returns (the losers that delisted are missing). | `frames/…/CY2012.json` against `company_tickers.json` (7,997 CIKs) |
| 5 | Benchmark | SPY history is needed for every window; same price blocker as row 1. | — |
| 6 | Volume and rate limits | SEC: 10 requests/s ceiling (Sentinel uses 2/s). A 1,000-company universe is 1,000 `companyfacts` files of about 3.6 MB each: about 10 minutes and 3.6 GB uncompressed, so it belongs offline, not in the Worker or D1. Alpaca's free-plan rate limit was not verified here. | Two real files fetched: 3.66 MB and 3.64 MB |
| 7 | Reproducible harness | **Built.** `scripts/research/harness.mjs`: time-ordered train / validation / test split with an embargo, 15 bp costs per side, an equal-weight baseline, bootstrap by decision date (seeded), and a test set that can only be read through `finalTest` with a rule frozen beforehand. | `tests/research-harness.test.mjs` (3 tests, synthetic data: a planted 3% effect passes the gate, no effect does not) |

## Blockers, in order
1. **Historical prices offline**, including delisted symbols, with the fetch time recorded. Until then nothing can be tested on real data.
2. **A point-in-time universe**: which companies were listed and liquid on each decision date. Without it, the test picks from companies that only look investable in hindsight.
3. **Sample size**: Sentinel's own cases are days old. A news-driven rule cannot be tested historically without historical news; a fundamentals-only rule can.

## What a first real test would be (not started)
One transparent signal fixed in advance (for example: reported CFO − capex growth, known by the filing date), liquid US common shares, 60-session forward return against SPY, costs included, baselines first. It passes only if the frozen rule clears the gate on the untouched test set. A pass is still not a buy or sell signal: invariants 5–7 stay in force until the founder changes them.

## Not done
No real data was loaded into the harness. No claim about performance is made.
