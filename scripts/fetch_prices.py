#!/usr/bin/env python3
"""Fetch daily Japanese stock prices from Yahoo Finance via yfinance."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import date, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WATCHLIST_PATH = ROOT / "data" / "watchlist.csv"
PRICES_PATH = ROOT / "data" / "prices.csv"
AS_OF_PATH = ROOT / "data" / "prices_as_of.json"
RULES_PATH = ROOT / "config" / "rules.json"

JST = timezone(timedelta(hours=9))


def normalize_code(code: str) -> str:
    raw = str(code).strip()
    return raw.zfill(4) if raw.isdigit() else raw


def read_watchlist() -> list[dict[str, str]]:
    with WATCHLIST_PATH.open("r", encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


def read_rules() -> dict:
    with RULES_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


def unique_codes(stocks: list[dict[str, str]], market_index_code: str | None = None) -> list[str]:
    """ウォッチリストのユニークcode一覧。market_index_code が指定され、まだ含まれていなければ末尾に追加する。
    "^"始まりのcode(例 ^N225)はyfinanceティッカーそのまま扱うためnormalize_codeを通さない。
    """
    codes: list[str] = []
    seen: set[str] = set()

    for stock in stocks:
        code = normalize_code(stock["code"])
        if code in seen:
            continue

        seen.add(code)
        codes.append(code)

    if market_index_code:
        index_code = market_index_code if market_index_code.startswith("^") else normalize_code(market_index_code)
        if index_code not in seen:
            seen.add(index_code)
            codes.append(index_code)

    return codes


def fetch_today_row(ticker: str, code: str) -> tuple[dict, str] | None:
    """当日の分足データからOHLCVを集計して返す。(row, as_of_iso) のタプル。データがなければ None。"""
    import pandas as pd
    import yfinance as yf

    try:
        data = yf.download(ticker, period="1d", interval="1m", auto_adjust=False, progress=False)
    except Exception:
        return None

    if data.empty:
        return None

    if isinstance(data.columns, pd.MultiIndex):
        data.columns = data.columns.get_level_values(0)

    today = date.today()
    today_data = data[data.index.date == today]

    if today_data.empty:
        return None

    open_price = today_data["Open"].iloc[0]
    high_price = today_data["High"].max()
    low_price = today_data["Low"].min()
    close_price = today_data["Close"].iloc[-1]
    volume = today_data["Volume"].sum()

    if any(pd.isna(v) for v in [open_price, high_price, low_price, close_price, volume]):
        return None

    # 最終バーの時刻をJSTに変換
    last_ts = today_data.index[-1]
    if last_ts.tzinfo is not None:
        jst_time = last_ts.astimezone(JST)
    else:
        jst_time = last_ts.replace(tzinfo=JST)
    as_of = jst_time.isoformat()

    row = {
        "code": code,
        "date": today.strftime("%Y-%m-%d"),
        "open": round(float(open_price), 2),
        "high": round(float(high_price), 2),
        "low": round(float(low_price), 2),
        "close": round(float(close_price), 2),
        "volume": int(volume),
    }
    return row, as_of


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch daily prices for the watchlist via yfinance.")
    parser.add_argument("--period", default="1y", help="yfinanceの取得期間(例: 1y, 2y)。デフォルト: 1y")
    parser.add_argument(
        "--output",
        default=str(PRICES_PATH),
        help=f"出力先CSV。デフォルト: {PRICES_PATH.relative_to(ROOT)}(デフォルト以外を指定すると prices_as_of.json は更新しない)",
    )
    parser.add_argument(
        "--no-intraday",
        action="store_true",
        help="当日分足の集計・追記をスキップする(バックテスト用の確定日足のみ取得)",
    )
    parser.add_argument(
        "--auto-adjust",
        action="store_true",
        help="株式分割調整済みOHLCで取得する(バックテスト用。本番の prices.csv は未調整)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = ROOT / output_path
    is_default_output = output_path.resolve() == PRICES_PATH.resolve()

    try:
        import pandas as pd
        import yfinance as yf
    except ImportError:
        print("yfinance が見つかりません。先に `python3 -m pip install -r requirements.txt` を実行してください。", file=sys.stderr)
        return 1

    rules = read_rules()
    market_index_code = rules.get("marketIndexCode")

    rows: list[dict[str, str | int | float]] = []
    prices_as_of: str | None = None

    for code in unique_codes(read_watchlist(), market_index_code):
        ticker = code if code.startswith("^") else f"{code}.T"
        try:
            data = yf.download(
                ticker, period=args.period, interval="1d", auto_adjust=args.auto_adjust, progress=False
            )
        except Exception as exc:
            print(f"warning: {ticker} の取得に失敗しました: {exc}", file=sys.stderr)
            continue

        if data.empty:
            print(f"warning: {ticker} の価格データが空でした", file=sys.stderr)
            continue

        if isinstance(data.columns, pd.MultiIndex):
            data.columns = data.columns.get_level_values(0)

        today_str = date.today().strftime("%Y-%m-%d")
        daily_rows: list[dict] = []

        for dt, price in data.iterrows():
            values = {
                "open": price.get("Open"),
                "high": price.get("High"),
                "low": price.get("Low"),
                "close": price.get("Close"),
                "volume": price.get("Volume"),
            }

            if any(pd.isna(value) for value in values.values()):
                continue

            daily_rows.append(
                {
                    "code": code,
                    "date": dt.strftime("%Y-%m-%d"),
                    "open": round(float(values["open"]), 2),
                    "high": round(float(values["high"]), 2),
                    "low": round(float(values["low"]), 2),
                    "close": round(float(values["close"]), 2),
                    "volume": int(values["volume"]),
                }
            )

        # 当日の基準時刻が未確定なら分足から取得（日足の途中バーには時刻情報がないため）
        if not args.no_intraday:
            has_today = any(r["date"] == today_str for r in daily_rows)
            if prices_as_of is None:
                result = fetch_today_row(ticker, code)
                if result:
                    today_row, as_of = result
                    prices_as_of = as_of
                    if not has_today:
                        daily_rows.append(today_row)

        rows.extend(daily_rows)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=["code", "date", "open", "high", "low", "close", "volume"])
        writer.writeheader()
        writer.writerows(rows)

    if is_default_output:
        with AS_OF_PATH.open("w", encoding="utf-8") as file:
            json.dump({"as_of": prices_as_of}, file)

    try:
        display_path = output_path.relative_to(ROOT)
    except ValueError:
        display_path = output_path
    print(f"saved {len(rows)} rows to {display_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
