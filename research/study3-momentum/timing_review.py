"""Exploratory one-hour execution sensitivity on the known validation period."""
import csv
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from decimal import Decimal
from io import StringIO
from pathlib import Path
from zipfile import ZipFile
import backtest as b

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
b.WARMUP, b.START, b.END = date(2022, 12, 1), date(2023, 1, 1), date(2024, 6, 30)
periods = [f"{y}-{m:02}" for y in (2023, 2024) for m in range(1, (12 if y == 2023 else 6) + 1)]
b.months = lambda: iter(["2022-12", *periods])


def fetch(symbol, month):
    name = f"{symbol}-1h-{month}.zip"
    url = f"{b.BASE}/{symbol}/1h/{name}"
    path, checksum = DATA / name, DATA / (name + ".CHECKSUM")
    b.fetch_missing(checksum, url + ".CHECKSUM")
    b.fetch_missing(path, url)
    actual = b.digest(path.read_bytes())
    if checksum.read_text().split()[0].lower() != actual:
        raise ValueError(f"Checksum mismatch: {name}")
    prices = {}
    with ZipFile(path) as archive:
        member = name.removesuffix(".zip") + ".csv"
        if archive.getinfo(member).file_size > 4_000_000:
            raise ValueError(f"Unreasonable CSV size: {name}")
        for row in csv.reader(StringIO(archive.read(member).decode())):
            micros = b.timestamp_us(row[0])
            stamp = datetime.fromtimestamp(micros // 1_000_000, timezone.utc)
            if stamp.minute == 0 and stamp.second == 0 and stamp.hour == 1:
                if stamp.date() in prices:
                    raise ValueError(f"Duplicate candle: {name}")
                price = Decimal(row[1])
                if not price.is_finite() or price <= 0:
                    raise ValueError(f"Invalid price: {name}")
                prices[stamp.date()] = price
    return prices, {"url": url, "sha256": actual}


def main():
    result = {}
    for symbol, lookback in (("BTCUSDT", 28), ("ETHUSDT", 14)):
        bars, daily_manifest = b.load(symbol, DATA, False)
        with ThreadPoolExecutor(max_workers=10) as pool:
            files = list(pool.map(lambda month: fetch(symbol, month), periods))
        prices = {}
        for daily_prices, _ in files:
            if prices.keys() & daily_prices.keys():
                raise ValueError("Duplicate hour")
            prices.update(daily_prices)
        expected = {day for day, _, _ in bars if b.START <= day <= b.END}
        if set(prices) != expected:
            raise ValueError(f"Hourly coverage mismatch: {symbol}")
        adjusted = [(day, prices.get(day, opening), close) for day, opening, close in bars]
        result[symbol] = {
            "one_hour": b.simulate(adjusted, "momentum", lookback),
            "baseline": b.simulate(bars, "momentum", lookback),
            "benchmark_same_timing": b.simulate(adjusted, "hold"),
            "daily_manifest": daily_manifest,
            "hourly_manifest": [manifest for _, manifest in files],
        }
    output = ROOT / "timing-review.json"
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    for symbol, values in result.items():
        print(symbol, "base", values["baseline"]["net_return"], "1h", values["one_hour"]["net_return"], "hold", values["benchmark_same_timing"]["net_return"])


if __name__ == "__main__":
    main()
