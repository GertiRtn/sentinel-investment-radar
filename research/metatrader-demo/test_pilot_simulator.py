import math
import unittest
from pilot_simulator import Bar, simulate


class PilotTests(unittest.TestCase):
    def test_signal_executes_next_open_and_costs_are_charged(self):
        bars = [Bar("01", 10, 10), Bar("02", 10, 12),
                Bar("03", 20, 8), Bar("04", 15, 7)]
        result = simulate(bars, lookback=1, starting_cash=100, cost_bps=100)
        self.assertEqual([(o["date"], o["side"], o["signal_date"]) for o in result["orders"]],
                         [("03", "BUY", "02"), ("04", "SELL", "03")])
        self.assertAlmostEqual(result["cash"], 100 / 1.01 / 20 * 15 * .99)

    def test_no_action_without_sufficient_history_or_future_bar(self):
        self.assertEqual(simulate([Bar("01", 1, 1), Bar("02", 1, 2)], lookback=1)["orders"], [])

    def test_invalid_inputs_rejected(self):
        for bars in ([Bar("02", 1, 1), Bar("01", 1, 1)], [Bar("01", 1, math.nan)],
                     [Bar("01", 0, 1)]):
            with self.assertRaises(ValueError):
                simulate(bars)

    def test_no_double_buy_on_persistent_signal(self):
        bars = [Bar(f"{i:02}", i, i) for i in range(1, 7)]
        result = simulate(bars, lookback=1)
        self.assertEqual([o["side"] for o in result["orders"]], ["BUY"])


if __name__ == "__main__":
    unittest.main()
