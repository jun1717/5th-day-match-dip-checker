import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { movingAverageAt } from "../lib/indicators";
import { evaluateCandidates } from "../lib/evaluator";
import { scoreIndividual } from "../lib/scoring";
import { PriceRow, Rules, WatchlistRow } from "../lib/types";

const rules = JSON.parse(readFileSync("config/rules.json", "utf8")) as Rules;

test("movingAverageAt calculates the requested trailing window", () => {
  assert.equal(movingAverageAt([1, 2, 3, 4, 5], 4, 5), 3);
  assert.equal(movingAverageAt([1, 2, 3], 1, 3), null);
});

test("scoreIndividual is driven by rules weights", () => {
  const score = scoreIndividual(
    {
      ma25TrendUp: true,
      closeAboveMa25: true,
      ma5DeviationInRange: true,
      ma5TrendUpOrFlat: true,
      yearHighDeviationInRange: true,
      expectedLossWithinLimit: true
    },
    rules
  );

  assert.equal(score, 100);
});

test("evaluateCandidates creates candidate and theme records from local rows", () => {
  const watchlist: WatchlistRow[] = [
    {
      watchlistKey: "8002__商社",
      code: "8002",
      name: "丸紅",
      sector: "卸売業",
      theme: "商社",
      isLeader: true,
      watchPriority: "A"
    }
  ];
  const prices = samplePrices("8002");
  const result = evaluateCandidates(watchlist, prices, rules, "2026-05-29T00:00:00.000Z");

  assert.equal(result.candidates.length, 1);
  assert.equal(result.themeScores.length, 1);
  assert.equal(result.themeScores[0].theme, "商社");
  assert.ok(result.candidates[0].individualScore >= 0);
  assert.equal(result.candidates[0].themeScore, result.themeScores[0].themeScore);
});

test("evaluateCandidates keeps duplicate codes separate by theme", () => {
  const watchlist: WatchlistRow[] = [
    {
      watchlistKey: "7011__重工・防衛",
      code: "7011",
      name: "三菱重工",
      sector: "機械",
      theme: "重工・防衛",
      isLeader: true,
      watchPriority: "A"
    },
    {
      watchlistKey: "7011__宇宙・衛星",
      code: "7011",
      name: "三菱重工",
      sector: "機械",
      theme: "宇宙・衛星",
      isLeader: true,
      watchPriority: "B"
    }
  ];
  const result = evaluateCandidates(watchlist, samplePrices("7011"), rules, "2026-05-29T00:00:00.000Z");

  assert.equal(result.candidates.length, 2);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.watchlistKey).sort(),
    ["7011__宇宙・衛星", "7011__重工・防衛"]
  );
  assert.equal(result.themeScores.length, 2);
  assert.deepEqual(
    result.themeScores.map((theme) => `${theme.priority}:${theme.theme}`).sort(),
    ["A:重工・防衛", "B:宇宙・衛星"]
  );
});

function samplePrices(code: string): PriceRow[] {
  const closes = [
    100, 102, 104, 106, 108, 110, 112, 114, 116, 118,
    120, 122, 124, 126, 128, 130, 132, 134, 136, 138,
    142, 146, 150, 154, 158, 162, 166, 170, 168, 167
  ];

  return closes.map((close, index) => ({
    code,
    date: `2026-05-${String(index + 1).padStart(2, "0")}`,
    open: close - 1,
    high: close + (index === 27 ? 8 : 2),
    low: close - 2,
    close,
    volume: 1_000_000 + index
  }));
}
