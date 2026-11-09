# Demo pilot: working specification

Status: an offline reference simulator and an uncompiled MT5 Strategy Tester-only
prototype exist. The prototype rejects use outside the Strategy Tester; it cannot
place demo-account trades in the normal terminal. Neither prototype has been
verified in MT5 and no real or demo-account order has been submitted.

## Tester prototype

`SentinelTesterPilot.mq5` is a separate experimental expert advisor. It evaluates
the 28-bar rule on the first available tick of a new daily bar, attempts a long
entry or closes its own long position, and caps size at 0.01 lots. It requires
the terminal to report a demo account and Strategy Tester mode. It has a test
stop, spread limit and conservative halt on unexpected or uncertain order status.
The spread rule can delay exits; gaps can exceed the stop price. The 500-point
stop and 30-point maximum spread are arbitrary test inputs, not optimized or
recommended values. Fill-or-kill support, tester account mode, fill response,
stops, logs and compilation all remain unverified. The Strategy Tester execution
model and costs differ from the Python cash simulator. This is not AI or news
analysis, and is not connected to the Sentinel platform.

The observed MetaQuotes-Demo EURUSD specification has a 100,000 EUR contract
size and 0.01 minimum and step, so 0.01 lot represents 1,000 EUR exposure. The
user explicitly requested testing a larger virtual account. Account leverage,
currency, margin and final test settings must still be confirmed.

## Hypothesis to test

As a simple baseline, compare the most recent completed daily close with the
close 28 completed bars earlier. When the first is higher, hold a long
position; otherwise hold no position. Execute no earlier than the next bar's
open. This is a test rule, not a prediction, recommendation, or demonstrated
edge. The existing EURUSD demo quote does not establish that the broker's
product is a cash instrument; forex and CFDs can be leveraged.

The Python reference simulator uses an illustrative $50 cash balance, fractional
units, no leverage, and a configurable symmetric transaction-cost assumption
(default 10 basis points per side). The 10 bps is an assumption, not a broker
quote. It records signal and execution dates and marks open positions to a
hypothetical net liquidation value. It does not model spread changes, slippage,
market gaps, financing, taxes, broker minimum order size, missing sessions or
instrument-specific contract specifications. It is not an MT5 backtest, and it
cannot establish that a $50 account can trade a specific broker product.

Run offline checks with `python3 -m unittest discover -s research/metatrader-demo -p 'test_*.py'`.

## Before a demo order-capable component is used

1. Identify the exact demo symbol, product type, contract size, account currency,
   minimum volume, margin and trading session. If the broker minimum exceeds
   the intended exposure, skip the order rather than silently increase it.
2. Specify a fixed exposure cap, protective stop behavior and emergency stop,
   with clear limitations: market gaps and slippage can exceed a stop price.
   Avoid using account-wide controls to interfere with unrelated positions.
3. Build a separate MT5 expert advisor that rejects non-demo accounts at startup
   and immediately before every order, and fails closed on disconnection,
   stale data, missing history, unexpected positions or uncertain order status.
   Never act on another strategy's or a manual position.
4. Reconcile positions, open orders and fills after restart or uncertain broker
   replies before allowing new requests. Use stable identifiers and avoid
   duplicate submissions, including after partial fills or rejected requests.
5. Record each decision, data time, intended action, broker response, fill,
   costs and errors. Use the MT5 Strategy Tester for reproducible historical
   runs and fault tests before a demo-account trial. Compilation alone is not
   evidence that these controls work.
6. Compare results with a no-trade baseline, include costs, and distinguish a
   limited demo trial from a reliable profitability assessment. The program does
   not currently use news, sentiment or AI and is not connected to Sentinel.
