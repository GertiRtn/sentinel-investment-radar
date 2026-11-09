"""Offline, long-only research simulation. Does not connect to MT5 or trade.

Daily bars are supplied in chronological order. A signal calculated at a close
is executed at the following bar's open. Costs are charged on both sides.
"""
from dataclasses import dataclass
import math


@dataclass(frozen=True)
class Bar:
    date: str
    open: float
    close: float


def simulate(bars, *, lookback=28, starting_cash=50.0, cost_bps=10.0):
    if not isinstance(lookback, int) or isinstance(lookback, bool) or lookback < 1:
        raise ValueError("lookback must be a positive integer")
    if not math.isfinite(starting_cash) or starting_cash <= 0:
        raise ValueError("starting_cash must be positive and finite")
    if not math.isfinite(cost_bps) or not 0 <= cost_bps < 10000:
        raise ValueError("cost_bps must be finite and between 0 and 10000")
    previous = None
    for bar in bars:
        if not bar.date or (previous is not None and bar.date <= previous):
            raise ValueError("dates must be unique and in chronological order")
        if any(not math.isfinite(p) or p <= 0 for p in (bar.open, bar.close)):
            raise ValueError("prices must be positive and finite")
        previous = bar.date

    cash, units = starting_cash, 0.0
    fee = cost_bps / 10000
    orders, equity = [], []
    for i, bar in enumerate(bars):
        # The most recent available close is i-1; the comparison close is
        # lookback bars before it, so neither includes today's closing price.
        if i >= lookback + 1:
            signal = bars[i - 1].close > bars[i - 1 - lookback].close
            if signal and units == 0:
                units = cash / (bar.open * (1 + fee))
                paid = cash
                cash = 0.0
                orders.append({"date": bar.date, "side": "BUY", "price": bar.open,
                               "units": units, "cash_amount": paid,
                               "signal_date": bars[i - 1].date})
            elif not signal and units > 0:
                proceeds = units * bar.open * (1 - fee)
                orders.append({"date": bar.date, "side": "SELL", "price": bar.open,
                               "units": units, "cash_amount": proceeds,
                               "signal_date": bars[i - 1].date})
                cash += proceeds
                units = 0.0
        equity.append({"date": bar.date, "value": cash + units * bar.close * (1 - fee)})
    return {"orders": orders, "equity": equity, "cash": cash, "units": units}
