from datetime import date, timedelta
from decimal import Decimal
import unittest
from unittest.mock import patch

import backtest as b


class TimingTests(unittest.TestCase):
    def test_one_hour_execution_uses_prior_close_signal(self):
        days = [date(2020, 1, 1) + timedelta(days=i) for i in range(4)]
        # The first upward close creates a buy signal. Changing the next
        # opening price must affect the entry price, not the signal date.
        bars = [(days[0], Decimal(10), Decimal(10)),
                (days[1], Decimal(10), Decimal(12)),
                (days[2], Decimal(20), Decimal(12)),
                (days[3], Decimal(20), Decimal(12))]
        adjusted = list(bars)
        adjusted[2] = (days[2], Decimal(25), Decimal(12))
        with patch.object(b, 'START', days[1]), patch.object(b, 'END', days[3]):
            regular = b.simulate(bars, 'momentum', 1, fee=Decimal(0), friction=Decimal(0))
            delayed = b.simulate(adjusted, 'momentum', 1, fee=Decimal(0), friction=Decimal(0))
        self.assertEqual(regular['fills'], 2)
        self.assertEqual(delayed['fills'], 2)
        self.assertEqual(Decimal(regular['equity']), Decimal(50))
        self.assertEqual(Decimal(delayed['equity']), Decimal(40))
