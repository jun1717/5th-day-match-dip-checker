import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { averageTrueRangeAt, movingAverageAt } from "../lib/indicators";
import { evaluateCandidates, expectedLossFor, suggestedSharesFor } from "../lib/evaluator";
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

// ---- ATR ----

test("averageTrueRangeAt averages true ranges including gaps", () => {
  const bars: PriceRow[] = [
    { code: "X", date: "2026-05-01", open: 100, high: 105, low: 95, close: 100, volume: 1 },
    { code: "X", date: "2026-05-02", open: 101, high: 110, low: 100, close: 108, volume: 1 }, // TR=10
    { code: "X", date: "2026-05-03", open: 106, high: 112, low: 104, close: 105, volume: 1 }, // TR=8
    { code: "X", date: "2026-05-04", open: 122, high: 130, low: 120, close: 125, volume: 1 } // ギャップ: TR=|130-105|=25
  ];

  assert.equal(averageTrueRangeAt(bars, 3, 3), 43 / 3);
  assert.equal(averageTrueRangeAt(bars, 2, 2), 9);
  // prevCloseが必要なため endIndex-period < 0 は計算不能
  assert.equal(averageTrueRangeAt(bars, 3, 4), null);
  assert.equal(averageTrueRangeAt(bars, 4, 2), null);
});

// ---- リスクベース建玉 ----

const riskRules: Rules = { ...rules, sizingMode: "risk", lotSize: 100, allowFractionalShares: false, maxPositionYen: null };

test("suggestedSharesFor sizes position from risk budget with lot constraint", () => {
  assert.equal(suggestedSharesFor(1000, 30, riskRules), 400);
  assert.equal(suggestedSharesFor(1000, 120, riskRules), 100); // 境界: riskR = maxLossYen / lotSize
  assert.equal(suggestedSharesFor(1000, 121, riskRules), 0);
  assert.equal(suggestedSharesFor(1000, 0, riskRules), null);
  assert.equal(suggestedSharesFor(1000, -5, riskRules), null);
  assert.equal(suggestedSharesFor(null, 30, riskRules), null);
});

test("suggestedSharesFor supports fractional shares and position cap", () => {
  assert.equal(suggestedSharesFor(1000, 121, { ...riskRules, allowFractionalShares: true }), 99);
  assert.equal(suggestedSharesFor(5000, 30, { ...riskRules, maxPositionYen: 100_000 }), 0); // 単元だと20株しか買えない
  assert.equal(suggestedSharesFor(5000, 30, { ...riskRules, maxPositionYen: 100_000, allowFractionalShares: true }), 20);
});

test("suggestedSharesFor returns defaultShares in fixed mode", () => {
  assert.equal(suggestedSharesFor(1000, 121, { ...riskRules, sizingMode: "fixed" }), riskRules.defaultShares);
  assert.equal(suggestedSharesFor(null, null, { ...riskRules, sizingMode: "fixed" }), riskRules.defaultShares);
});

test("expectedLossFor matches sizing mode semantics", () => {
  assert.equal(expectedLossFor(1000, 970, 30, 400, riskRules), 12000);
  assert.equal(expectedLossFor(1000, 1121, null, null, riskRules), null); // stop >= entry
  assert.equal(expectedLossFor(1000, 970, 30, 100, { ...riskRules, sizingMode: "fixed" }), 3000);
  assert.equal(expectedLossFor(1000, 1100, null, null, { ...riskRules, sizingMode: "fixed" }), 0);
});

test("sizing parity: fixed and risk yield identical status and score (lot=100, no cap)", () => {
  const watchlist: WatchlistRow[] = [
    watchlistRow("8002", "標準"),
    watchlistRow("9101", "タイト損切り"),
    watchlistRow("9102", "損切り幅超過"),
    watchlistRow("9103", "損切りがエントリー上")
  ];
  const prices = [
    ...samplePrices("8002"),
    ...samplePrices("9101"), // riskR≈1.4円 → riskモードでは8300株になるが判定は不変
    ...pricesWithPrevLow("9102", 40), // riskR≈127円 → fixed:損失12,700円超過 / risk:0株。どちらもavoid
    ...pricesWithPrevLow("9103", 200) // stop >= entry。どちらもavoid
  ];

  const fixed = evaluateCandidates(watchlist, prices, { ...rules, sizingMode: "fixed" }, "2026-05-30T00:00:00.000Z");
  const risk = evaluateCandidates(watchlist, prices, { ...rules, sizingMode: "risk", maxPositionYen: null }, "2026-05-30T00:00:00.000Z");

  const summarize = (candidates: typeof fixed.candidates) =>
    candidates
      .map((candidate) => ({ key: candidate.watchlistKey, status: candidate.status, score: candidate.individualScore }))
      .sort((a, b) => a.key.localeCompare(b.key));

  assert.deepEqual(summarize(risk.candidates), summarize(fixed.candidates));
});

test("maxPositionYen intentionally breaks parity by capping position cost", () => {
  const watchlist = [watchlistRow("8002", "商社")];
  const capped = evaluateCandidates(
    watchlist,
    samplePrices("8002"),
    { ...rules, sizingMode: "risk", maxPositionYen: 10_000 },
    "2026-05-30T00:00:00.000Z"
  );

  const candidate = capped.candidates[0];
  assert.equal(candidate.suggestedShares, 0);
  assert.equal(candidate.expectedLoss, 0);
  assert.equal(candidate.status, "avoid");
  assert.ok(candidate.reasons.some((reason) => reason.key === "position_cost_too_large"));
});

// ---- 出来高ドライアップ / 品質フィルター ----

test("volumeRatio compares short window volume to long window volume", () => {
  const watchlist = [watchlistRow("8002", "商社")];
  const result = evaluateCandidates(watchlist, dryUpPrices("8002"), rules, "2026-05-30T00:00:00.000Z");
  const candidate = result.candidates[0];

  // 直近3日=500,000 / 20日平均=(17×1,000,000+3×500,000)/20=925,000
  assert.ok(candidate.volumeRatio !== null);
  assert.ok(Math.abs(candidate.volumeRatio - 500_000 / 925_000) < 1e-9);
  // 枯れている(≤0.85)のでフラグは付かない
  assert.ok(!candidate.reasons.some((reason) => reason.key === "volume_not_dry"));
});

test("flag mode keeps buy_candidate but appends quality warnings", () => {
  const watchlist = [watchlistRow("8002", "商社")];
  const flagRules: Rules = { ...rules, stopTightFilterMode: "flag", volumeFilterMode: "flag" };
  const result = evaluateCandidates(watchlist, samplePrices("8002"), flagRules, "2026-05-30T00:00:00.000Z");
  const candidate = result.candidates[0];

  // samplePricesは損切り幅≈1.4円 ≪ ATR、出来高ほぼ横ばい(比率≈1.0)なので両方のフラグが立つ
  assert.equal(candidate.status, "buy_candidate");
  assert.equal(candidate.individualScore, 100); // 新条件はスコアに影響しない
  assert.deepEqual(
    candidate.reasons.map((reason) => reason.key),
    ["buy_setup_ready", "stop_too_tight", "volume_not_dry"]
  );
});

test("exclude mode demotes buy_candidate to watch (not avoid)", () => {
  const watchlist = [watchlistRow("8002", "商社")];
  const excludeRules: Rules = { ...rules, stopTightFilterMode: "exclude", volumeFilterMode: "off" };
  const result = evaluateCandidates(watchlist, samplePrices("8002"), excludeRules, "2026-05-30T00:00:00.000Z");
  const candidate = result.candidates[0];

  assert.equal(candidate.status, "watch");
  assert.equal(candidate.individualScore, 100);
  assert.ok(candidate.reasons.some((reason) => reason.key === "stop_too_tight"));
  assert.ok(!candidate.reasons.some((reason) => reason.key === "volume_not_dry"));
});

test("off mode neither flags nor demotes", () => {
  const watchlist = [watchlistRow("8002", "商社")];
  const offRules: Rules = { ...rules, stopTightFilterMode: "off", volumeFilterMode: "off" };
  const result = evaluateCandidates(watchlist, samplePrices("8002"), offRules, "2026-05-30T00:00:00.000Z");
  const candidate = result.candidates[0];

  assert.equal(candidate.status, "buy_candidate");
  assert.deepEqual(candidate.reasons.map((reason) => reason.key), ["buy_setup_ready"]);
});

test("insufficient price history leaves measurements null without flags", () => {
  const watchlist = [watchlistRow("8002", "商社")];
  const result = evaluateCandidates(watchlist, samplePrices("8002").slice(0, 10), rules, "2026-05-30T00:00:00.000Z");
  const candidate = result.candidates[0];

  assert.equal(candidate.atr, null);
  assert.equal(candidate.stopDistanceAtr, null);
  assert.equal(candidate.volumeRatio, null);
  assert.equal(candidate.suggestedShares, null);
  assert.equal(candidate.positionCost, null);
  assert.ok(!candidate.reasons.some((reason) => reason.key === "stop_too_tight" || reason.key === "volume_not_dry"));
});

// ---- フィクスチャ ----

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

/** samplePrices の前日(インデックス28)の安値だけを差し替える(損切り幅のバリエーション用) */
function pricesWithPrevLow(code: string, prevLow: number): PriceRow[] {
  return samplePrices(code).map((row, index) => (index === 28 ? { ...row, low: prevLow } : row));
}

/** 直近3日の出来高だけ半減させた押し目(売り枯れ)パターン */
function dryUpPrices(code: string): PriceRow[] {
  return samplePrices(code).map((row, index) => (index >= 27 ? { ...row, volume: 500_000 } : { ...row, volume: 1_000_000 }));
}
