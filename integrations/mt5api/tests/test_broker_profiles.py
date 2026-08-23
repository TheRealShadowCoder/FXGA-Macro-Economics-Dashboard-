import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROFILE_PATH = ROOT / "broker-symbol-profiles.json"

CANONICAL = {
    "DXY", "EURUSD", "GBPUSD", "USDJPY", "USDZAR", "US2Y", "US10Y",
    "SPX", "NASDAQ", "DJI", "VIX", "GOLD", "WTI", "BRENT", "BTCUSD", "ETHUSD",
}


class BrokerProfileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))

    def test_profiles_have_all_canonical_assets(self):
        for broker, profile in self.data["brokers"].items():
            with self.subTest(broker=broker):
                self.assertEqual(set(profile["symbols"]), CANONICAL)

    def test_no_known_false_index_matches(self):
        forbidden = {"SPXS.US", "DOW.N"}
        for broker, profile in self.data["brokers"].items():
            aliases = {str(alias).upper() for values in profile["symbols"].values() for alias in values}
            with self.subTest(broker=broker):
                self.assertTrue(forbidden.isdisjoint(aliases))

    def test_account_type_suffixes_are_explicit(self):
        for broker, profile in self.data["brokers"].items():
            with self.subTest(broker=broker):
                self.assertTrue(profile["accountTypes"])
                for name, account in profile["accountTypes"].items():
                    self.assertIn("suffixes", account, f"{broker}/{name}")
                    self.assertIsInstance(account["suffixes"], list)

    def test_treasury_yields_not_mapped_to_bond_futures(self):
        for broker, profile in self.data["brokers"].items():
            with self.subTest(broker=broker):
                self.assertEqual(profile["symbols"]["US2Y"], [])
                self.assertEqual(profile["symbols"]["US10Y"], [])

    def test_known_account_suffixes(self):
        brokers = self.data["brokers"]
        self.assertEqual(brokers["XM"]["accountTypes"]["micro"]["suffixes"], ["micro"])
        self.assertEqual(brokers["XM"]["accountTypes"]["ultra_low_standard"]["suffixes"], ["#"])
        self.assertEqual(brokers["Exness"]["accountTypes"]["standard"]["suffixes"], ["m"])
        self.assertEqual(brokers["Exness"]["accountTypes"]["standard_cent"]["suffixes"], ["c"])
        self.assertEqual(brokers["HFM"]["accountTypes"]["zero"]["suffixes"], ["b"])
        self.assertEqual(brokers["HFM"]["accountTypes"]["pro"]["suffixes"], ["r"])


if __name__ == "__main__":
    unittest.main()
