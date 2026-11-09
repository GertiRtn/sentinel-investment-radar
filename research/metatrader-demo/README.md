# Sentinel — MetaTrader 5 demo research monitor

Status: draft source, not compiled or tested in MetaTrader. This is the first connection experiment and does not place, simulate or recommend trades. It refuses initialization unless the terminal reports a connected demo account and pauses observations if that changes.

## What this does

On the chart you choose, the monitor compares the most recently completed daily close with the close a specified number of completed daily bars earlier. The default is 28, corresponding to the BTC research hypothesis. The earlier ETH experiment used 14. Broker symbols, session times, missing days, price feeds and products can differ from the Binance spot dataset, so this is not a validated transfer of that backtest.

The monitor displays its status and logs changes in the terminal. It does not save a persistent research ledger, connect to Sentinel, read news, run AI or submit orders. Missing/stale quotes and insufficient history show UNKNOWN. Terminal and quote clocks can become stale during connectivity outages, so this simple screen must not be treated as a complete monitoring safeguard.

## Later setup

1. Confirm MetaTrader **5**, broker, demo account and the exact instrument name and product type.
2. Compile this source in MetaEditor and resolve any compilation errors before attaching it to a demo chart.
3. On a demo chart, test sufficient/insufficient history, live/demo account switching, disconnected quotes, terminal restart and broker clock/session behavior.
4. Compare observations with independently calculated daily closes before considering any order capability.
5. Build a separate demo-only order component with account checks immediately before every submission, broker-specific position sizing, duplicate-order recovery, restart reconciliation, auditable logs and controls. Test first in Strategy Tester and on a demo account.
6. Integrate a reliable account/decision display with Sentinel and choose the system that remains online. Reassess data, spreads and other costs on the actual demo instruments.
7. Review live-account permissions, jurisdiction, isolated capital and safeguards separately before considering live operation.

The program must remain restricted to demo accounts. Never paste passwords, API keys or other secrets into chat.
