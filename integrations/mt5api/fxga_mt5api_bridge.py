#!/usr/bin/env python3
"""FXGA bridge for dceoy/mt5api.

This process is intentionally read-only against MetaTrader 5. It pulls canonical
M1 OHLCV data from the local mt5api REST service and pushes it to the existing
FXGA Google Cloud MT5 price-cache ingress.

Secrets are read from environment variables only:
  MT5API_SECRET_KEY
  FXGA_MT5_TOKEN

The JSON config contains no credentials.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

LOG = logging.getLogger("fxga.mt5api.bridge")
SCHEMA = "fxga.mt5.price-cache.v2"
SOURCE = "MetaTrader5"
ONE_MINUTE_MS = 60_000
ONE_DAY_MS = 86_400_000
MAX_BARS_PER_POST = 2_000

DEFAULT_SYMBOL_CANDIDATES: dict[str, list[str]] = {
    "DXY": ["DXY", "USDX", "USDIDX", "DX"],
    "EURUSD": ["EURUSD"],
    "GBPUSD": ["GBPUSD"],
    "USDJPY": ["USDJPY"],
    "USDZAR": ["USDZAR"],
    "US2Y": ["US2Y", "US02Y", "UST2Y"],
    "US10Y": ["US10Y", "UST10Y"],
    "SPX": ["SPX", "US500", "SP500"],
    "NASDAQ": ["NASDAQ", "NAS100", "US100", "USTEC"],
    "DJI": ["DJI", "US30", "DJ30", "DOW"],
    "VIX": ["VIX"],
    "GOLD": ["GOLD", "XAUUSD"],
    "WTI": ["WTI", "USOIL", "XTIUSD"],
    "BRENT": ["BRENT", "UKOIL", "XBRUSD"],
    "BTCUSD": ["BTCUSD"],
    "ETHUSD": ["ETHUSD"],
}


@dataclass(frozen=True)
class Config:
    mt5api_base_url: str
    fxga_ingress_url: str
    sync_interval_seconds: int
    request_timeout_seconds: int
    symbols: dict[str, list[str]]
    explicit_symbol_map: dict[str, str]


class HttpError(RuntimeError):
    """HTTP transport error with status context."""


def _strip_url(value: str) -> str:
    return value.strip().rstrip("/")


def load_config(path: Path) -> Config:
    # utf-8-sig accepts both BOM-free UTF-8 and Windows PowerShell 5.1 UTF-8 BOM files.
    raw = json.loads(path.read_text(encoding="utf-8-sig"))
    candidates = dict(DEFAULT_SYMBOL_CANDIDATES)
    for key, values in (raw.get("symbol_candidates") or {}).items():
        canonical = str(key).upper()
        if isinstance(values, str):
            values = [values]
        candidates[canonical] = [str(value) for value in values if str(value).strip()]
    explicit = {
        str(key).upper(): str(value).strip()
        for key, value in (raw.get("symbol_map") or {}).items()
        if str(value).strip()
    }
    return Config(
        mt5api_base_url=_strip_url(
            str(raw.get("mt5api_base_url") or "http://127.0.0.1:8000")
        ),
        fxga_ingress_url=_strip_url(str(raw["fxga_ingress_url"])),
        sync_interval_seconds=max(60, int(raw.get("sync_interval_seconds") or 300)),
        request_timeout_seconds=max(
            5, int(raw.get("request_timeout_seconds") or 30)
        ),
        symbols=candidates,
        explicit_symbol_map=explicit,
    )


def request_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    payload: Any | None = None,
    timeout: int = 30,
) -> Any:
    body = None
    request_headers = {
        "Accept": "application/json",
        "User-Agent": "FXGA-dceoy-mt5api-bridge/1.0",
    }
    if headers:
        request_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        url=url, data=body, headers=request_headers, method=method.upper()
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            text = response.read().decode("utf-8", errors="replace")
            return json.loads(text) if text else None
    except urllib.error.HTTPError as error:
        body_text = error.read().decode("utf-8", errors="replace")[:1500]
        raise HttpError(f"{method} {url} -> HTTP {error.code}: {body_text}") from error
    except urllib.error.URLError as error:
        raise HttpError(f"{method} {url} -> {error.reason}") from error


def mt5api_headers() -> dict[str, str]:
    key = os.getenv("MT5API_SECRET_KEY", "").strip()
    return {"X-API-Key": key} if key else {}


def fxga_headers() -> dict[str, str]:
    token = os.getenv("FXGA_MT5_TOKEN", "").strip()
    if not token:
        raise RuntimeError("FXGA_MT5_TOKEN is not configured")
    return {"X-FXGA-MT5-Token": token}


def mt5_get(config: Config, path: str, query: dict[str, Any] | None = None) -> Any:
    suffix = path if path.startswith("/") else f"/{path}"
    url = f"{config.mt5api_base_url}{suffix}"
    if query:
        url = f"{url}?{urllib.parse.urlencode(query)}"
    return request_json(
        "GET",
        url,
        headers=mt5api_headers(),
        timeout=config.request_timeout_seconds,
    )


def fxga_get(config: Config, path: str, query: dict[str, Any] | None = None) -> Any:
    suffix = path if path.startswith("/") else f"/{path}"
    url = f"{config.fxga_ingress_url}{suffix}"
    if query:
        url = f"{url}?{urllib.parse.urlencode(query)}"
    return request_json("GET", url, timeout=config.request_timeout_seconds)


def fxga_post(config: Config, path: str, payload: Any) -> Any:
    suffix = path if path.startswith("/") else f"/{path}"
    return request_json(
        "POST",
        f"{config.fxga_ingress_url}{suffix}",
        headers=fxga_headers(),
        payload=payload,
        timeout=max(60, config.request_timeout_seconds),
    )


def unwrap_data(response: Any) -> list[Any]:
    if isinstance(response, dict) and isinstance(response.get("data"), list):
        return response["data"]
    if isinstance(response, list):
        return response
    return []


def discover_available_symbols(config: Config) -> list[str]:
    response = mt5_get(config, "/symbols", {"group": "*"})
    rows = unwrap_data(response)
    names: list[str] = []
    for row in rows:
        if isinstance(row, str):
            name = row
        elif isinstance(row, dict):
            name = row.get("name") or row.get("symbol")
        else:
            name = None
        if name:
            names.append(str(name))
    return sorted(set(names))


def _safe_suffix_match(candidate: str, symbol: str) -> bool:
    candidate = candidate.upper()
    symbol = symbol.upper()
    if not symbol.startswith(candidate):
        return False
    suffix = symbol[len(candidate) :]
    if not suffix:
        return True
    return len(suffix) <= 6 and all(ch.isalnum() or ch in "._-" for ch in suffix)


def resolve_symbols(config: Config, available: list[str]) -> dict[str, str]:
    upper_to_original = {symbol.upper(): symbol for symbol in available}
    resolved: dict[str, str] = {}
    for canonical, candidates in config.symbols.items():
        if canonical in config.explicit_symbol_map:
            chosen = config.explicit_symbol_map[canonical]
            if chosen.upper() not in upper_to_original:
                LOG.warning(
                    "%s explicit broker symbol %s is not available", canonical, chosen
                )
                continue
            resolved[canonical] = upper_to_original[chosen.upper()]
            continue

        found = None
        for candidate in candidates:
            exact = upper_to_original.get(candidate.upper())
            if exact:
                found = exact
                break
        if found:
            resolved[canonical] = found
            continue

        safe_matches: list[str] = []
        for candidate in candidates:
            safe_matches.extend(
                symbol for symbol in available if _safe_suffix_match(candidate, symbol)
            )
        safe_matches = sorted(set(safe_matches))
        if len(safe_matches) == 1:
            resolved[canonical] = safe_matches[0]
        elif len(safe_matches) > 1:
            LOG.warning(
                "%s has ambiguous broker candidates %s; set symbol_map explicitly",
                canonical,
                safe_matches,
            )
        else:
            LOG.info("%s is not offered by this broker/terminal", canonical)
    return resolved


def parse_time_ms(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        if number > 1e17:
            number /= 1_000_000
        elif number > 1e14:
            number /= 1_000
        elif number < 1e11:
            number *= 1_000
        return int(number)
    text = str(value).strip()
    if not text:
        return None
    try:
        return parse_time_ms(float(text))
    except ValueError:
        pass
    try:
        normalized = text.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return int(dt.timestamp() * 1000)
    except ValueError:
        return None


def finite_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def normalize_rate_row(row: Any) -> list[Any] | None:
    if isinstance(row, dict):
        time_value = row.get("time") or row.get("time_msc") or row.get("timestamp")
        values = [
            parse_time_ms(time_value),
            finite_float(row.get("open")),
            finite_float(row.get("high")),
            finite_float(row.get("low")),
            finite_float(row.get("close")),
            int(finite_float(row.get("tick_volume")) or 0),
            int(finite_float(row.get("spread")) or 0),
            int(finite_float(row.get("real_volume")) or 0),
        ]
    elif isinstance(row, list) and len(row) >= 5:
        values = [
            parse_time_ms(row[0]),
            finite_float(row[1]),
            finite_float(row[2]),
            finite_float(row[3]),
            finite_float(row[4]),
            int(finite_float(row[5]) or 0) if len(row) > 5 else 0,
            int(finite_float(row[6]) or 0) if len(row) > 6 else 0,
            int(finite_float(row[7]) or 0) if len(row) > 7 else 0,
        ]
    else:
        return None

    time_ms, open_, high, low, close, *_ = values
    if time_ms is None or None in (open_, high, low, close):
        return None
    if high < max(open_, close) or low > min(open_, close) or high < low:
        return None
    return values


def ms_to_iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=UTC).isoformat().replace("+00:00", "Z")


def fetch_m1_range(
    config: Config, broker_symbol: str, from_ms: int, to_ms: int
) -> list[list[Any]]:
    if to_ms <= from_ms:
        return []
    response = mt5_get(
        config,
        "/rates/range",
        {
            "symbol": broker_symbol,
            "timeframe": "M1",
            "date_from": ms_to_iso(from_ms),
            "date_to": ms_to_iso(to_ms),
        },
    )
    bars = []
    for row in unwrap_data(response):
        normalized = normalize_rate_row(row)
        if normalized is not None and from_ms <= normalized[0] <= to_ms:
            bars.append(normalized)
    return sorted({int(row[0]): row for row in bars}.values(), key=lambda row: row[0])


def latest_tick(config: Config, broker_symbol: str) -> dict[str, Any] | None:
    response = mt5_get(config, f"/symbols/{urllib.parse.quote(broker_symbol)}/tick")
    rows = unwrap_data(response)
    if not rows:
        return None
    row = rows[-1]
    return row if isinstance(row, dict) else None


def sync_window(plan: dict[str, Any]) -> tuple[int, int]:
    now = int(time.time() * 1000)
    if plan.get("fullBootstrapRequired"):
        oldest = int(plan.get("oldestStoredMs") or 0)
        end_ms = oldest - ONE_MINUTE_MS if oldest else now
        start_ms = max(now - 60 * ONE_DAY_MS, end_ms - ONE_DAY_MS + ONE_MINUTE_MS)
        return start_ms, end_ms

    from_ms = int(plan.get("fromMs") or max(0, now - ONE_DAY_MS))
    to_ms = int(plan.get("toMs") or now)
    return from_ms, to_ms


def post_bars(
    config: Config,
    canonical: str,
    broker_symbol: str,
    bars: list[list[Any]],
    *,
    dry_run: bool,
) -> int:
    accepted = 0
    for offset in range(0, len(bars), MAX_BARS_PER_POST):
        chunk = bars[offset : offset + MAX_BARS_PER_POST]
        if not chunk:
            continue
        if dry_run:
            LOG.info(
                "DRY RUN %s <- %s: %d bars %s .. %s",
                canonical,
                broker_symbol,
                len(chunk),
                ms_to_iso(chunk[0][0]),
                ms_to_iso(chunk[-1][0]),
            )
            accepted += len(chunk)
            continue
        payload = {
            "schema": SCHEMA,
            "source": SOURCE,
            "symbol": canonical,
            "broker_symbol": broker_symbol,
            "timeframe": "M1",
            "producer": "dceoy/mt5api",
            "producer_version": "1.0",
            "collected_at": datetime.now(tz=UTC).isoformat(),
            "bars": chunk,
        }
        response = fxga_post(config, "/api/mt5/price-cache", payload)
        accepted += int(
            response.get("acceptedBars")
            or response.get("accepted")
            or len(chunk)
        )
        LOG.info(
            "%s <- %s: posted=%d accepted=%s mode=%s",
            canonical,
            broker_symbol,
            len(chunk),
            response.get("acceptedBars", response.get("accepted")),
            (response.get("syncPlan") or {}).get("mode"),
        )
    return accepted


def sync_symbol(
    config: Config,
    canonical: str,
    broker_symbol: str,
    *,
    dry_run: bool,
) -> dict[str, Any]:
    plan = fxga_get(config, "/api/mt5/price-cache/plan", {"symbol": canonical})
    from_ms, to_ms = sync_window(plan)
    bars = fetch_m1_range(config, broker_symbol, from_ms, to_ms)
    tick = latest_tick(config, broker_symbol)
    if not bars:
        LOG.warning(
            "%s <- %s returned no M1 bars for %s .. %s",
            canonical,
            broker_symbol,
            ms_to_iso(from_ms),
            ms_to_iso(to_ms),
        )
        return {
            "symbol": canonical,
            "brokerSymbol": broker_symbol,
            "bars": 0,
            "mode": plan.get("mode"),
            "tick": tick,
        }
    posted = post_bars(
        config, canonical, broker_symbol, bars, dry_run=dry_run
    )
    return {
        "symbol": canonical,
        "brokerSymbol": broker_symbol,
        "bars": len(bars),
        "posted": posted,
        "mode": plan.get("mode"),
        "from": ms_to_iso(from_ms),
        "to": ms_to_iso(to_ms),
        "tick": tick,
    }


def health(config: Config) -> dict[str, Any]:
    return {
        "mt5api": mt5_get(config, "/health"),
        "fxga": fxga_get(config, "/api/mt5/health"),
    }


def run_cycle(config: Config, *, dry_run: bool) -> dict[str, Any]:
    available = discover_available_symbols(config)
    resolved = resolve_symbols(config, available)
    LOG.info(
        "MT5 terminal exposes %d symbols; %d/%d FXGA symbols resolved",
        len(available),
        len(resolved),
        len(config.symbols),
    )
    results = []
    failures = []
    for canonical, broker_symbol in resolved.items():
        try:
            results.append(
                sync_symbol(
                    config,
                    canonical,
                    broker_symbol,
                    dry_run=dry_run,
                )
            )
        except Exception as error:
            LOG.exception("%s sync failed: %s", canonical, error)
            failures.append({"symbol": canonical, "error": str(error)})
    return {
        "generatedAt": datetime.now(tz=UTC).isoformat(),
        "resolvedSymbols": resolved,
        "results": results,
        "failures": failures,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read-only dceoy/mt5api -> FXGA M1 bridge"
    )
    parser.add_argument(
        "--config",
        default=os.getenv("FXGA_MT5API_CONFIG", "config.json"),
        help="Path to non-secret JSON configuration",
    )
    parser.add_argument("--once", action="store_true", help="Run one sync cycle")
    parser.add_argument(
        "--discover", action="store_true", help="Print broker symbols and exit"
    )
    parser.add_argument(
        "--doctor", action="store_true", help="Check both API endpoints and exit"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read MT5 data but do not post bars to FXGA",
    )
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    config = load_config(Path(args.config))

    if args.doctor:
        print(json.dumps(health(config), indent=2, default=str))
        return 0

    if args.discover:
        available = discover_available_symbols(config)
        print(
            json.dumps(
                {
                    "available": available,
                    "resolved": resolve_symbols(config, available),
                },
                indent=2,
            )
        )
        return 0

    if args.once:
        result = run_cycle(config, dry_run=args.dry_run)
        print(json.dumps(result, indent=2, default=str))
        return 1 if result["failures"] else 0

    while True:
        started = time.monotonic()
        try:
            result = run_cycle(config, dry_run=args.dry_run)
            LOG.info(
                "cycle complete: %d assets, %d failures",
                len(result["results"]),
                len(result["failures"]),
            )
        except KeyboardInterrupt:
            return 0
        except Exception as error:
            LOG.exception("bridge cycle failed: %s", error)
        elapsed = time.monotonic() - started
        delay = max(5, config.sync_interval_seconds - elapsed)
        try:
            time.sleep(delay)
        except KeyboardInterrupt:
            return 0


if __name__ == "__main__":
    sys.exit(main())
