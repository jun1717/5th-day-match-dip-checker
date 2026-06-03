#!/usr/bin/env python3
"""Generate deterministic sample daily prices for local UI and evaluator checks."""

from __future__ import annotations

import csv
from datetime import date, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WATCHLIST_PATH = ROOT / "data" / "watchlist.csv"
PRICES_PATH = ROOT / "data" / "prices.csv"
END_DATE = date(2026, 5, 29)
ROW_COUNT = 70


THEME_CONFIG = {
    "電線・データセンター": {"start": 4100, "slope": 25, "peak_boost": 330, "tail": [0.00, -0.015, -0.027, -0.040, -0.050, -0.057, -0.061, -0.062, -0.060, -0.056]},
    "商社": {"start": 2650, "slope": 11, "peak_boost": 130, "tail": [-0.025, -0.018, -0.012, -0.006, 0.000, 0.006, 0.010, 0.014, 0.019, 0.024]},
    "銀行": {"start": 1900, "slope": -4, "peak_boost": 80, "tail": [-0.015, -0.024, -0.030, -0.037, -0.045, -0.051, -0.058, -0.063, -0.068, -0.073]},
    "重工・防衛": {"start": 3150, "slope": 23, "peak_boost": 390, "tail": [-0.015, -0.025, -0.033, -0.040, -0.047, -0.052, -0.055, -0.056, -0.053, -0.049]},
}
DEFAULT_THEME_CONFIG = {
    "start": 2400,
    "slope": 14,
    "peak_boost": 180,
    "tail": [-0.020, -0.015, -0.010, -0.005, 0.000, 0.004, 0.008, 0.011, 0.014, 0.017],
}


def weekdays_ending(end_date: date, count: int) -> list[date]:
    days: list[date] = []
    current = end_date
    while len(days) < count:
        if current.weekday() < 5:
            days.append(current)
        current -= timedelta(days=1)
    return list(reversed(days))


def normalize_code(code: str) -> str:
    raw = str(code).strip()
    return raw.zfill(4) if raw.isdigit() else raw


def read_watchlist() -> list[dict[str, str]]:
    with WATCHLIST_PATH.open("r", encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


def unique_stocks(stocks: list[dict[str, str]]) -> list[dict[str, str]]:
    unique: list[dict[str, str]] = []
    seen: set[str] = set()

    for stock in stocks:
        code = normalize_code(stock["code"])
        if code in seen:
            continue

        seen.add(code)
        unique.append({**stock, "code": code})

    return unique


def close_for(theme: str, index: int, code_offset: int) -> float:
    config = THEME_CONFIG.get(theme, DEFAULT_THEME_CONFIG)
    trend_value = config["start"] + code_offset + index * config["slope"]
    wave = ((index % 7) - 3) * 5

    if index < ROW_COUNT - 10:
        return trend_value + wave

    peak = config["start"] + code_offset + (ROW_COUNT - 11) * config["slope"] + config["peak_boost"]
    tail_index = index - (ROW_COUNT - 10)
    return peak * (1 + config["tail"][tail_index]) + wave


def main() -> int:
    dates = weekdays_ending(END_DATE, ROW_COUNT)
    rows: list[dict[str, str | int | float]] = []

    for stock_index, stock in enumerate(unique_stocks(read_watchlist())):
        code = stock["code"]
        theme = stock["theme"]
        offset = (stock_index % 4) * 55

        for index, trade_date in enumerate(dates):
            close = close_for(theme, index, offset)
            open_price = close * (1 - 0.003)
            high = close * (1.012 if index == ROW_COUNT - 10 else 1.006)
            low = close * 0.986
            volume = 1_200_000 + stock_index * 140_000 + index * 8_000

            rows.append(
                {
                    "code": code,
                    "date": trade_date.isoformat(),
                    "open": round(open_price, 2),
                    "high": round(high, 2),
                    "low": round(low, 2),
                    "close": round(close, 2),
                    "volume": volume,
                }
            )

    with PRICES_PATH.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=["code", "date", "open", "high", "low", "close", "volume"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"saved {len(rows)} sample rows to {PRICES_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
