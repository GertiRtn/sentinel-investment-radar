"""One-hour holdout execution sensitivity; never changes the frozen strategy."""
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
import backtest as b
import timing_review as timing

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "holdout-timing-results.json"
b.WARMUP, b.START, b.END = date(2024, 6, 1), date(2024, 7, 1), date(2026, 10, 31)
periods = [f"{y}-{m:02}" for y in (2024, 2025, 2026) for m in range(1, 13)
           if (y > 2024 or m >= 7) and (y < 2026 or m <= 10)]
b.months = lambda: iter(["2024-06", *periods])


def main():
    if OUTPUT.exists():
        raise SystemExit("Holdout timing result already exists")
    result = {"protocol_sha256": b.digest((ROOT / "HOLDOUT_PROTOCOL.md").read_bytes()),
              "runner_sha256": b.digest(Path(__file__).read_bytes()), "assets": {}}
    for symbol, lookback in (("BTCUSDT", 28), ("ETHUSDT", 14)):
        bars, daily_manifest = b.load(symbol, ROOT / "data", False)
        with ThreadPoolExecutor(max_workers=10) as pool:
            inputs = list(pool.map(lambda month: timing.fetch(symbol, month), periods))
        prices = {}
        for part, _ in inputs:
            if prices.keys() & part.keys():
                raise ValueError("Duplicate hourly date")
            prices.update(part)
        if set(prices) != {day for day, _, _ in bars if b.START <= day <= b.END}:
            raise ValueError(f"Incomplete hourly coverage: {symbol}")
        adjusted = [(day, prices.get(day, opening), close) for day, opening, close in bars]
        result["assets"][symbol] = {"strategy": b.simulate(adjusted, "momentum", lookback),
             "buy_and_hold": b.simulate(adjusted, "hold"),
             "daily_manifest": daily_manifest, "hourly_manifest": [entry for _, entry in inputs]}
    with OUTPUT.open("x") as output:
        json.dump(result, output, indent=2, sort_keys=True)
        output.write("\n")
    for symbol, entry in result["assets"].items():
        print(symbol, entry["strategy"]["net_return"], entry["buy_and_hold"]["net_return"])


if __name__ == "__main__":
    main()
