import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

BRIDGE_PATH = Path(__file__).resolve().parents[1] / "fxga_mt5api_bridge.py"
spec = importlib.util.spec_from_file_location("fxga_mt5api_bridge", BRIDGE_PATH)
bridge = importlib.util.module_from_spec(spec)
assert spec and spec.loader
sys.modules[spec.name] = bridge
spec.loader.exec_module(bridge)


class BridgeTests(unittest.TestCase):
    def test_parse_iso_time(self):
        self.assertEqual(bridge.parse_time_ms("2026-08-21T12:00:00Z"), 1787313600000)

    def test_load_config_accepts_windows_utf8_bom(self):
        payload = {
            "mt5api_base_url": "http://127.0.0.1:8000",
            "fxga_ingress_url": "https://example.run.app",
            "sync_interval_seconds": 300,
            "request_timeout_seconds": 30,
            "symbol_candidates": {"EURUSD": ["EURUSD"]},
            "symbol_map": {},
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "config.json"
            path.write_text(json.dumps(payload), encoding="utf-8-sig")
            config = bridge.load_config(path)
        self.assertEqual(config.mt5api_base_url, "http://127.0.0.1:8000")
        self.assertEqual(config.fxga_ingress_url, "https://example.run.app")

    def test_normalize_rate_row(self):
        row = {
            "time": "2026-08-21T12:00:00Z",
            "open": 1.1000,
            "high": 1.1010,
            "low": 1.0990,
            "close": 1.1005,
            "tick_volume": 100,
            "spread": 12,
            "real_volume": 0,
        }
        normalized = bridge.normalize_rate_row(row)
        self.assertEqual(normalized[0], 1787313600000)
        self.assertEqual(normalized[1:5], [1.1, 1.101, 1.099, 1.1005])
        self.assertEqual(normalized[5:], [100, 12, 0])

    def test_reject_invalid_ohlc(self):
        row = {
            "time": "2026-08-21T12:00:00Z",
            "open": 1.10,
            "high": 1.09,
            "low": 1.08,
            "close": 1.11,
        }
        self.assertIsNone(bridge.normalize_rate_row(row))

    def test_symbol_resolution_exact_and_suffix(self):
        config = bridge.Config(
            mt5api_base_url="http://127.0.0.1:8000",
            fxga_ingress_url="https://example.run.app",
            sync_interval_seconds=300,
            request_timeout_seconds=30,
            symbols={
                "EURUSD": ["EURUSD"],
                "GOLD": ["XAUUSD"],
                "SPX": ["US500"],
            },
            explicit_symbol_map={},
        )
        available = ["EURUSD", "XAUUSD.a", "US500.cash"]
        self.assertEqual(
            bridge.resolve_symbols(config, available),
            {"EURUSD": "EURUSD", "GOLD": "XAUUSD.a", "SPX": "US500.cash"},
        )

    def test_ambiguous_suffix_is_not_guessed(self):
        config = bridge.Config(
            mt5api_base_url="http://127.0.0.1:8000",
            fxga_ingress_url="https://example.run.app",
            sync_interval_seconds=300,
            request_timeout_seconds=30,
            symbols={"GOLD": ["XAUUSD"]},
            explicit_symbol_map={},
        )
        available = ["XAUUSD.a", "XAUUSD.m"]
        self.assertNotIn("GOLD", bridge.resolve_symbols(config, available))

    def test_bootstrap_window_is_bounded_to_one_day(self):
        now = 1787313600000
        original_time = bridge.time.time
        bridge.time.time = lambda: now / 1000
        try:
            start, end = bridge.sync_window(
                {"fullBootstrapRequired": True, "oldestStoredMs": now}
            )
        finally:
            bridge.time.time = original_time
        self.assertLessEqual(end - start, bridge.ONE_DAY_MS)
        self.assertEqual(end, now - bridge.ONE_MINUTE_MS)


if __name__ == "__main__":
    unittest.main()
