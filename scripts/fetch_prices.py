#!/usr/bin/env python3
"""Fetch daily Japanese stock prices from Yahoo Finance via yfinance."""

from __future__ import annotations

import csv
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WATCHLIST_PATH = ROOT / "data" / "watchlist.csv"
PRICES_PATH = ROOT / "data" / "prices.csv"


def normalize_code(code: str) -> str:
    raw = str(code).strip()
    return raw.zfill(4) if raw.isdigit() else raw


def read_watchlist() -> list[dict[str, str]]:
    with WATCHLIST_PATH.open("r", encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


def unique_codes(stocks: list[dict[str, str]]) -> list[str]:
    codes: list[str] = []
    seen: set[str] = set()

    for stock in stocks:
        code = normalize_code(stock["code"])
        if code in seen:
            continue

        seen.add(code)
        codes.append(code)

    return codes


def main() -> int:
    try:
        import pandas as pd
        import yfinance as yf
    except ImportError:
        print("yfinance が見つかりません。先に `python3 -m pip install -r requirements.txt` を実行してください。", file=sys.stderr)
        return 1

    rows: list[dict[str, str | int | float]] = []

    for code in unique_codes(read_watchlist()):
        ticker = f"{code}.T"
        try:
            data = yf.download(ticker, period="1y", interval="1d", auto_adjust=False, progress=False)
        except Exception as exc:  # noqa: BLE001 - command-line fetch should continue per ticker.
            print(f"warning: {ticker} の取得に失敗しました: {exc}", file=sys.stderr)
            continue

        if data.empty:
            print(f"warning: {ticker} の価格データが空でした", file=sys.stderr)
            continue

        if isinstance(data.columns, pd.MultiIndex):
            data.columns = data.columns.get_level_values(0)

        for date, price in data.iterrows():
            values = {
                "open": price.get("Open"),
                "high": price.get("High"),
                "low": price.get("Low"),
                "close": price.get("Close"),
                "volume": price.get("Volume"),
            }

            if any(pd.isna(value) for value in values.values()):
                continue

            rows.append(
                {
                    "code": code,
                    "date": date.strftime("%Y-%m-%d"),
                    "open": round(float(values["open"]), 2),
                    "high": round(float(values["high"]), 2),
                    "low": round(float(values["low"]), 2),
                    "close": round(float(values["close"]), 2),
                    "volume": int(values["volume"]),
                }
            )

    PRICES_PATH.parent.mkdir(parents=True, exist_ok=True)
    with PRICES_PATH.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=["code", "date", "open", "high", "low", "close", "volume"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"saved {len(rows)} rows to {PRICES_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
