# Final historical test

The protocol was committed before holdout data was accessed. This is one previously unseen period, 1 July 2024 to 31 October 2026. BTC uses the selected 28-day rule and ETH the selected 14-day rule. Each starts independently with 50 USDT. No portfolio allocation between them is implied.

| Metric | BTC rule | BTC buy-and-hold | ETH rule | ETH buy-and-hold |
|---|---:|---:|---:|---:|
| Simulated return | +7.90% | +23.41% | +30.17% | -34.49% |
| Maximum daily-close drawdown | 31.44% | 52.97% | 44.91% | 67.55% |
| Filled entries/exits | 84 | 1 | 102 | 1 |
| Modeled fees, USDT | 4.11 | 0.05 | 5.84 | 0.05 |

Both end balances are marked at the final close and do not include hypothetical exit costs for a position still open. Fees are in a compounding balance and do not include the assumed spread/slippage allowance. Drawdowns are based on daily closing values, so intraday declines can be larger.

Under doubled fee and spread/slippage assumptions, BTC returned -4.88% and ETH +11.70%. Under the separately specified one-hour execution-price proxy, BTC returned +15.84% and ETH +30.40%; matching one-hour buy-and-hold benchmarks returned +23.09% and -34.58%. These are sensitivities, not precise predictions. Actual order fills, exchange minimums, rounding, taxation, quote-token risks and data/inference service costs remain unmodeled.

The BTC rule lagged buy-and-hold on return but had a lower daily-close drawdown. ETH outperformed its hold benchmark in this period, while its 44.91% drawdown is substantial. Neither outcome establishes a statistically reliable edge. Both strategies remain hypotheses for prospective shadow observation, and the test period is now used up.

Sources, per-file SHA-256 checksums, engine/protocol hashes and complete metrics are recorded in holdout-results.json and holdout-timing-results.json. The BTC and ETH monthly daily and hourly inputs were checked against their published checksum sidecars and continuity requirements. Both simulations used only the requested holdout window and June 2024 warm-up. Input files are not tracked in Git.
