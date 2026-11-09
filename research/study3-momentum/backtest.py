"""Standalone, development-only Study 3 simulator."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from hashlib import sha256
from io import StringIO
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.request import urlopen
from zipfile import BadZipFile, ZipFile

SYMBOLS = ("BTCUSDT", "ETHUSDT")
LOOKBACKS = (7, 14, 28)
START = date(2020, 1, 1)
END = date(2022, 12, 31)
WARMUP = date(2019, 12, 1)
DAY = timedelta(days=1)
BASE = "https://data.binance.vision/data/spot/monthly/klines"
CAPITAL = Decimal("50")
FEE = Decimal(".001")
FRICTION = Decimal(".0005")


def digest(data):
    return sha256(data).hexdigest()


def timestamp_us(raw):
    value = int(raw)
    return value if value >= 10**15 else value * 1000


def months():
    yield "2019-12"
    for year in range(2020, 2023):
        for month in range(1, 13):
            yield f"{year}-{month:02}"


def fetch_missing(path, url):
    if not path.exists():
        with urlopen(url, timeout=20) as response:
            data = response.read(1_000_001)
        if len(data) > 1_000_000:
            raise ValueError(f"Oversized input: {url}")
        with NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
            temp_path = Path(temporary.name)
            try:
                temporary.write(data)
                temporary.close()
                temp_path.replace(path)
            finally:
                temp_path.unlink(missing_ok=True)


def download_month(symbol, directory, month):
    name = f"{symbol}-1d-{month}.zip"
    url = f"{BASE}/{symbol}/1d/{name}"
    fetch_missing(directory / (name + ".CHECKSUM"), url + ".CHECKSUM")
    fetch_missing(directory / name, url)


def load(symbol, directory, download):
    if download:
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda month: download_month(symbol, directory, month), months()))
    bars, manifest = [], []
    for month in months():
        name = f"{symbol}-1d-{month}.zip"
        url = f"{BASE}/{symbol}/1d/{name}"
        archive = directory / name
        sidecar = directory / (name + ".CHECKSUM")
        actual = digest(archive.read_bytes())
        if actual != sidecar.read_text().split()[0].lower():
            raise ValueError(f"Checksum mismatch: {name}")
        manifest.append({"url": url, "sha256": actual})
        with ZipFile(archive) as zipped:
            member = name.removesuffix(".zip") + ".csv"
            if zipped.getinfo(member).file_size > 1_000_000:
                raise ValueError(f"Oversized CSV: {name}")
            for row in csv.reader(StringIO(zipped.read(member).decode("utf-8"))):
                if len(row) != 12:
                    raise ValueError(f"Malformed candle: {name}")
                micros = timestamp_us(row[0])
                day = datetime.fromtimestamp(micros // 1_000_000, timezone.utc).date()
                if (micros % 86_400_000_000 or not day.isoformat().startswith(month)
                    or timestamp_us(row[6]) // 1000 != micros // 1000 + 86_399_999):
                    raise ValueError(f"Invalid daily candle timestamps: {name} {day}")
                opening, high, low, close = map(Decimal, row[1:5])
                if not all(x.is_finite() and x > 0 for x in (opening, high, low, close)):
                    raise ValueError(f"Invalid prices: {name} {day}")
                if low > min(opening, close) or high < max(opening, close):
                    raise ValueError(f"Inconsistent OHLC: {name} {day}")
                bars.append((day, opening, close))
    expected = [WARMUP + DAY * i for i in range((END - WARMUP).days + 1)]
    if [bar[0] for bar in bars] != expected:
        raise ValueError(f"Missing, duplicate or out-of-order daily candles: {symbol}")
    return bars, manifest


def simulate(bars, mode, lookback=7, delay=0, fee=FEE, friction=FRICTION):
    cash, units, paid, turnover = CAPITAL, Decimal(0), Decimal(0), Decimal(0)
    peak, drawdown = CAPITAL, Decimal(0)
    fills, exposed, sessions = 0, 0, 0
    equity = CAPITAL
    for i, (day, opening, close) in enumerate(bars):
        if not START <= day <= END:
            continue
        sessions += 1
        signal = i - 1 - delay
        desired = mode == "hold" or (
            mode == "momentum" and signal >= lookback
            and bars[signal][2] > bars[signal - lookback][2]
        )
        if desired and not units:
            value = cash / (1 + fee)
            units = value / (opening * (1 + friction))
            paid += value * fee
            turnover += value
            cash = Decimal(0)
            fills += 1
        elif not desired and units:
            value = units * opening * (1 - friction)
            cash = value * (1 - fee)
            paid += value * fee
            turnover += value
            units = Decimal(0)
            fills += 1
        exposed += bool(units)
        equity = cash + units * close
        peak = max(peak, equity)
        drawdown = max(drawdown, 1 - equity / peak)
    if not sessions:
        raise ValueError("No development sessions")
    return {"equity": str(equity), "net_return": str(equity / CAPITAL - 1),
            "max_close_drawdown": str(drawdown), "fees": str(paid),
            "turnover": str(turnover), "fills": fills, "exposed_days": exposed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    args.data.mkdir(parents=True, exist_ok=True)
    inputs, results = [], {}
    try:
        for symbol in SYMBOLS:
            bars, manifest = load(symbol, args.data, args.download)
            inputs.extend(manifest)
            candidates = {n: simulate(bars, "momentum", n) for n in LOOKBACKS}
            chosen = max(LOOKBACKS, key=lambda n: Decimal(candidates[n]["net_return"]))
            results[symbol] = {
                "candidates": candidates, "selected_lookback": chosen,
                "cash": simulate(bars, "cash"), "buy_and_hold": simulate(bars, "hold"),
                "delay_one_bar": {n: simulate(bars, "momentum", n, delay=1) for n in LOOKBACKS},
            }
    except (OSError, ValueError, ArithmeticError, IndexError, KeyError, BadZipFile) as error:
        parser.exit(1, f"Incomplete development data: {error}\n")
    record = {
        "version": 1, "stage": "development",
        "code_sha256": digest(Path(__file__).read_bytes()),
        "spec_sha256": digest(Path(__file__).with_name("README.md").read_bytes()),
        "manifest_sha256": digest(json.dumps(inputs, sort_keys=True).encode()),
        "inputs": inputs,
        "splits": {"development": [str(START), str(END)],
                   "validation_reserved": ["2023-01-01", "2024-06-30"],
                   "holdout_reserved": ["2024-07-01", "2026-10-31"]},
        "lookbacks": LOOKBACKS,
        "initial_usdt_per_asset": str(CAPITAL),
        "cost_bps_per_side": {"fee": 10, "half_spread": 2.5, "slippage": 2.5},
        "results": results,
    }
    args.output.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
