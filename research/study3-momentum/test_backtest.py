from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from backtest import CAPITAL, digest, load, months, simulate, timestamp_us


class BaselineTests(unittest.TestCase):
    def setUp(self):
        self.bars = [
            (date(2019, 12, 30) + timedelta(days=i), Decimal(o), Decimal(c))
            for i, (o, c) in enumerate([(10, 10), (10, 10), (10, 12), (20, 8), (10, 10)])
        ]

    def test_signal_uses_prior_close_and_delay_changes_first_fill(self):
        base = simulate(self.bars, "momentum", 1, fee=Decimal(0), friction=Decimal(0))
        delayed = simulate(self.bars, "momentum", 1, delay=1, fee=Decimal(0), friction=Decimal(0))
        self.assertEqual(Decimal(base["equity"]), Decimal(25))
        self.assertEqual(base["fills"], 2)
        self.assertEqual(Decimal(delayed["equity"]), CAPITAL)
        self.assertEqual(delayed["fills"], 1)

    def test_round_trip_costs(self):
        result = simulate(self.bars, "momentum", 1)
        self.assertAlmostEqual(Decimal(result["equity"]), Decimal("24.92511236889048"), places=12)
        self.assertEqual(result["exposed_days"], 1)

    def test_archive_months_and_timestamp_units(self):
        self.assertEqual(len(list(months())), 37)
        self.assertEqual(list(months())[-1], "2022-12")
        self.assertEqual(timestamp_us("1735689600000"), timestamp_us("1735689600000000"))

    def test_archive_rejects_bad_checksum_and_gap(self):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            archive = folder / "BTCUSDT-1d-2020-01.zip"
            sidecar = archive.with_suffix(".zip.CHECKSUM")
            candle = "1577836800000,10,11,9,10,1,1577923199999,10,1,1,1,0"
            with ZipFile(archive, "w") as output:
                output.writestr("BTCUSDT-1d-2020-01.csv", candle)
            with patch("backtest.months", return_value=["2020-01"]):
                sidecar.write_text("invalid")
                with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
                    load("BTCUSDT", folder, False)
                sidecar.write_text(digest(archive.read_bytes()))
                with self.assertRaisesRegex(ValueError, "Missing, duplicate"):
                    load("BTCUSDT", folder, False)
                with patch("backtest.WARMUP", date(2020, 1, 1)), patch("backtest.END", date(2020, 1, 1)):
                    bars, manifest = load("BTCUSDT", folder, False)
                self.assertEqual(bars, [(date(2020, 1, 1), Decimal(10), Decimal(10))])
                self.assertEqual(manifest[0]["sha256"], digest(archive.read_bytes()))
