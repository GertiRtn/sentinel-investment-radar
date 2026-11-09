"""Run the frozen daily holdout exactly once, preserving input provenance."""
import json
from datetime import date
from decimal import Decimal
from pathlib import Path
import backtest as b

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
OUTPUT = ROOT / "holdout-results.json"
b.WARMUP, b.START, b.END = date(2024, 6, 1), date(2024, 7, 1), date(2026, 10, 31)
months = ["2024-06"] + [f"{year}-{month:02}" for year in (2024, 2025, 2026)
                        for month in range(1, 13)
                        if (year > 2024 or month >= 7) and (year < 2026 or month <= 10)]
b.months = lambda: iter(months)


def main():
    if OUTPUT.exists():
        raise SystemExit("Holdout result already exists. Preserve it and review before any rerun.")
    output = {"stage": "holdout", "protocol_sha256": b.digest((ROOT / "HOLDOUT_PROTOCOL.md").read_bytes()),
              "engine_sha256": b.digest((ROOT / "backtest.py").read_bytes()),
              "runner_sha256": b.digest(Path(__file__).read_bytes()), "results": {}}
    for symbol, lookback in (("BTCUSDT", 28), ("ETHUSDT", 14)):
        bars, manifest = b.load(symbol, DATA, True)
        output["results"][symbol] = {
            "lookback": lookback, "manifest": manifest,
            "strategy": b.simulate(bars, "momentum", lookback),
            "cash": b.simulate(bars, "cash"),
            "buy_and_hold": b.simulate(bars, "hold"),
            "doubled_cost": b.simulate(bars, "momentum", lookback,
                                       fee=Decimal(".002"), friction=Decimal(".001")),
        }
    with OUTPUT.open("x") as file:
        json.dump(output, file, indent=2, sort_keys=True)
        file.write("\n")
    for symbol, result in output["results"].items():
        print(symbol, "strategy", result["strategy"]["net_return"],
              "hold", result["buy_and_hold"]["net_return"],
              "drawdown", result["strategy"]["max_close_drawdown"],
              "double", result["doubled_cost"]["net_return"])


if __name__ == "__main__":
    main()
