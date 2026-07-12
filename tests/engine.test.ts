import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runBacktest } from "../lib/backtest/engine";
import { evaluateCandidates } from "../lib/evaluator";
import { PriceRow, Rules, WatchlistRow } from "../lib/types";

const rules = JSON.parse(readFileSync("config/rules.json", "utf8")) as Rules;

function watchlistRow(code: string, theme: string): WatchlistRow {
  return {
    watchlistKey: `${code}__${theme}`,
    code,
    name: `銘柄${code}`,
    sector: "テスト",
    theme,
    isLeader: true,
    watchPriority: "A"
  };
}

function trendingPrices(code: string, step: number): PriceRow[] {
  return Array.from({ length: 30 }, (_, index) => {
    const close = 100 + index * step;
    return {
      code,
      date: `2026-05-${String(index + 1).padStart(2, "0")}`,
      open: close - 1,
      high: close + 2,
      low: close - 2,
      close,
      volume: 1_000_000
    };
  });
}

test("runBacktest records themeDays per evaluated day matching evaluateCandidates", () => {
  const watchlist = [watchlistRow("9301", "テーマX"), watchlistRow("9302", "テーマY")];
  const prices = [...trendingPrices("9301", 2), ...trendingPrices("9302", 0.5)];

  const result = runBacktest(watchlist, prices, rules, {
    from: "2026-05-27",
    to: "2026-05-30",
    maxHoldDays: 30,
    stopMode: "prev-day",
    statuses: ["buy_candidate"]
  });

  assert.equal(result.evaluatedDays.length, 4);
  assert.equal(result.themeDays.length, result.evaluatedDays.length * 2);

  // 各評価日のthemeDaysが、その日までの価格で評価したthemeScoresと一致する
  for (const day of result.evaluatedDays) {
    const expected = evaluateCandidates(
      watchlist,
      prices.filter((row) => row.date <= day),
      rules,
      day
    ).themeScores;
    const recorded = result.themeDays.filter((record) => record.date === day);

    assert.equal(recorded.length, expected.length);
    for (const theme of expected) {
      const record = recorded.find((row) => row.theme === theme.theme);
      assert.ok(record !== undefined);
      assert.equal(record.themeScore, theme.themeScore);
      assert.equal(record.status, theme.status);
      assert.equal(record.rank, theme.rank);
    }
  }
});
