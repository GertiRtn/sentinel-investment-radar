# Study 3 momentum baseline

Frozen development protocol. BTCUSDT and ETHUSDT daily Binance spot candles, independently funded with 50 USDT each. Development is January 2020 through December 2022, with December 2019 warm-up. Validation is January 2023 through June 2024 and holdout is July 2024 through October 2026. This runner accepts only the development archive months and warm-up.

Compare 7, 14 and 28 completed-bar momentum. Positive momentum targets full exposure, otherwise cash. Fill at the following open, with an additional one-bar delay as sensitivity. The next open is an idealized proxy. Each side pays 10 bps in quote fees, 2.5 bps half-spread and 2.5 bps adverse slippage. Costs are modeled, and the simulation allows fractional units without venue-specific order filters. Start flat, use warm-up for the first signal, and mark any final position at the last close without forced liquidation. Buy-and-hold enters at the first development open and uses the same accounting. Select the highest base net return per asset, breaking ties by shortest lookback.

Requires Python 3.10+. From this directory:

    python3 -m unittest -v
    python3 backtest.py --download --data data --output development.json
    python3 backtest.py --data data --output development-rerun.json

Download mode uses public archives and published checksum sidecars. Offline mode uses existing ZIPs and sidecars in the data directory. Keep these files with the result for reproduction. A missing or malformed input halts the run. JSON includes the complete input manifest and code/spec hashes. Keep generated archives and results outside commits.
