import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EarningsRow, toEarningsRows } from "../lib/csv";
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

test("order fields are recomputed from the signal-day low (next-morning entry basis)", () => {
  const watchlist = [watchlistRow("8002", "商社")];
  const testRules: Rules = { ...rules, sizingMode: "risk", maxPositionYen: null };
  const result = evaluateCandidates(watchlist, samplePrices("8002"), testRules, "2026-05-30T00:00:00.000Z");
  const candidate = result.candidates[0];

  // samplePrices: 前日(D-1)安値=166、シグナル日(D)安値=165。stopLossは従来どおりD-1、注文用はD基準
  assert.equal(candidate.stopLoss, 166);
  assert.equal(candidate.signalDayLow, 165);

  const entry = candidate.entryPrice!;
  const orderRiskR = entry - 165;
  const expectedShares = Math.floor(testRules.maxLossYen / orderRiskR / testRules.lotSize) * testRules.lotSize;
  assert.equal(candidate.orderShares, expectedShares);
  assert.equal(candidate.orderExpectedLoss, orderRiskR * expectedShares);
  assert.equal(candidate.orderPositionCost, entry * expectedShares);
  assert.equal(candidate.orderRewardR, candidate.reward! / orderRiskR);
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

// ---- 市場レジーム(地合い)フィルター ----

test("marketConditionOf classifies regime from the index 25-day line", () => {
  const watchlist = [watchlistRow("8002", "商社")];

  const okResult = evaluateCandidates(
    watchlist,
    [...samplePrices("8002"), ...marketSeries("1306", risingCloses())],
    rules,
    "2026-05-30T00:00:00.000Z"
  );
  assert.ok(okResult.market !== null);
  assert.equal(okResult.market.regimeOk, true);
  assert.equal(okResult.market.ma25Trend, "up");

  // 終値 < MA25 だがMA25は上向き → regimeOk=false(乖離マイナス)
  const weakCloseResult = evaluateCandidates(
    watchlist,
    [...samplePrices("8002"), ...marketSeries("1306", weakCloseCloses())],
    rules,
    "2026-05-30T00:00:00.000Z"
  );
  assert.ok(weakCloseResult.market !== null);
  assert.equal(weakCloseResult.market.regimeOk, false);
  assert.equal(weakCloseResult.market.ma25Trend, "up");
  assert.ok((weakCloseResult.market.ma25Deviation ?? 0) < 0);

  // MA25下向き → regimeOk=false
  const downResult = evaluateCandidates(
    watchlist,
    [...samplePrices("8002"), ...marketSeries("1306", decliningCloses())],
    rules,
    "2026-05-30T00:00:00.000Z"
  );
  assert.ok(downResult.market !== null);
  assert.equal(downResult.market.ma25Trend, "down");
  assert.equal(downResult.market.regimeOk, false);

  // 指標行なし → market=null(不罰)
  const noIndex = evaluateCandidates(watchlist, samplePrices("8002"), rules, "2026-05-30T00:00:00.000Z");
  assert.equal(noIndex.market, null);

  // 行数不足(<26)→ market=null
  const shortIndex = evaluateCandidates(
    watchlist,
    [...samplePrices("8002"), ...marketSeries("1306", risingCloses()).slice(0, 10)],
    rules,
    "2026-05-30T00:00:00.000Z"
  );
  assert.equal(shortIndex.market, null);
});

test("market flag mode keeps buy_candidate but appends market_regime_weak to all evaluable candidates", () => {
  const watchlist = [watchlistRow("8002", "商社")];
  const flagRules: Rules = { ...rules, marketFilterMode: "flag" };
  const result = evaluateCandidates(
    watchlist,
    [...samplePrices("8002"), ...marketSeries("1306", decliningCloses())],
    flagRules,
    "2026-05-30T00:00:00.000Z"
  );
  const candidate = result.candidates[0];

  assert.equal(candidate.status, "buy_candidate");
  assert.ok(candidate.reasons.some((reason) => reason.key === "market_regime_weak"));
});

test("market exclude mode demotes buy_candidate to watch (not avoid)", () => {
  const watchlist = [watchlistRow("8002", "商社")];
  const excludeRules: Rules = { ...rules, marketFilterMode: "exclude" };
  const result = evaluateCandidates(
    watchlist,
    [...samplePrices("8002"), ...marketSeries("1306", decliningCloses())],
    excludeRules,
    "2026-05-30T00:00:00.000Z"
  );
  const candidate = result.candidates[0];

  assert.equal(candidate.status, "watch");
  assert.equal(candidate.individualScore, 100); // スコアは不変
  assert.ok(candidate.reasons.some((reason) => reason.key === "market_regime_weak"));
});

test("market off mode and market=null neither flag nor demote", () => {
  const watchlist = [watchlistRow("8002", "商社")];

  // off: 地合いNGでも影響なし
  const offResult = evaluateCandidates(
    watchlist,
    [...samplePrices("8002"), ...marketSeries("1306", decliningCloses())],
    { ...rules, marketFilterMode: "off" },
    "2026-05-30T00:00:00.000Z"
  );
  assert.equal(offResult.candidates[0].status, "buy_candidate");
  assert.ok(!offResult.candidates[0].reasons.some((reason) => reason.key === "market_regime_weak"));

  // market=null: excludeモードでも罰しない(指標行なし)
  const nullResult = evaluateCandidates(
    watchlist,
    samplePrices("8002"),
    { ...rules, marketFilterMode: "exclude" },
    "2026-05-30T00:00:00.000Z"
  );
  assert.equal(nullResult.candidates[0].status, "buy_candidate");
  assert.ok(!nullResult.candidates[0].reasons.some((reason) => reason.key === "market_regime_weak"));
});

test("weak market regime does not change the individual score", () => {
  const watchlist = [watchlistRow("8002", "商社")];
  const okScore = evaluateCandidates(
    watchlist,
    [...samplePrices("8002"), ...marketSeries("1306", risingCloses())],
    { ...rules, marketFilterMode: "exclude" },
    "2026-05-30T00:00:00.000Z"
  ).candidates[0].individualScore;
  const ngScore = evaluateCandidates(
    watchlist,
    [...samplePrices("8002"), ...marketSeries("1306", decliningCloses())],
    { ...rules, marketFilterMode: "exclude" },
    "2026-05-30T00:00:00.000Z"
  ).candidates[0].individualScore;

  assert.equal(okScore, 100);
  assert.equal(ngScore, 100);
});

// ---- 決算日フィルター ----

test("daysToEarnings picks the first announcement on or after the evaluation date", () => {
  const watchlist = [watchlistRow("8002", "商社")];

  // 過去・未来が順不同。評価日 2026-05-30 以降の最初 = 2026-06-15
  const earnings: EarningsRow[] = [
    { code: "8002", earningsDate: "2026-08-01", memo: "" },
    { code: "8002", earningsDate: "2026-05-10", memo: "" },
    { code: "8002", earningsDate: "2026-06-15", memo: "" }
  ];
  const result = evaluateCandidates(watchlist, samplePrices("8002"), rules, "2026-05-30T00:00:00.000Z", earnings);
  const candidate = result.candidates[0];
  assert.equal(candidate.nextEarningsDate, "2026-06-15");
  assert.ok(candidate.daysToEarnings !== null && candidate.daysToEarnings > 0);

  // 評価日 = 発表日 → daysToEarnings = 0(除外窓に含む)
  const sameDay = evaluateCandidates(watchlist, samplePrices("8002"), rules, "2026-05-30T00:00:00.000Z", [
    { code: "8002", earningsDate: "2026-05-30", memo: "" }
  ]);
  assert.equal(sameDay.candidates[0].nextEarningsDate, "2026-05-30");
  assert.equal(sameDay.candidates[0].daysToEarnings, 0);
});

test("earnings proximity boundary matches earningsExclusionDays (flag mode)", () => {
  const watchlist = [watchlistRow("8002", "商社")];
  const flagRules: Rules = { ...rules, earningsFilterMode: "flag" };

  // 評価日 2026-05-30(土)から 2026-06-03(水)=平日3日 → 除外窓内(<= 3)
  const inWindow = evaluateCandidates(watchlist, samplePrices("8002"), flagRules, "2026-05-30T00:00:00.000Z", [
    { code: "8002", earningsDate: "2026-06-03", memo: "" }
  ]).candidates[0];
  assert.equal(inWindow.daysToEarnings, 3);
  assert.ok(inWindow.reasons.some((reason) => reason.key === "earnings_soon"));

  // 2026-06-04(木)=平日4日 → 窓の外(> 3)
  const outWindow = evaluateCandidates(watchlist, samplePrices("8002"), flagRules, "2026-05-30T00:00:00.000Z", [
    { code: "8002", earningsDate: "2026-06-04", memo: "" }
  ]).candidates[0];
  assert.equal(outWindow.daysToEarnings, 4);
  assert.ok(!outWindow.reasons.some((reason) => reason.key === "earnings_soon"));
});

test("earnings filter modes: exclude demotes, flag warns, off and empty do nothing", () => {
  const watchlist = [watchlistRow("8002", "商社")];
  const near: EarningsRow[] = [{ code: "8002", earningsDate: "2026-06-03", memo: "" }];

  const excluded = evaluateCandidates(
    watchlist,
    samplePrices("8002"),
    { ...rules, earningsFilterMode: "exclude" },
    "2026-05-30T00:00:00.000Z",
    near
  ).candidates[0];
  assert.equal(excluded.status, "watch");
  assert.equal(excluded.individualScore, 100);
  assert.ok(excluded.reasons.some((reason) => reason.key === "earnings_soon"));

  const flagged = evaluateCandidates(
    watchlist,
    samplePrices("8002"),
    { ...rules, earningsFilterMode: "flag" },
    "2026-05-30T00:00:00.000Z",
    near
  ).candidates[0];
  assert.equal(flagged.status, "buy_candidate");
  assert.ok(flagged.reasons.some((reason) => reason.key === "earnings_soon"));

  const off = evaluateCandidates(
    watchlist,
    samplePrices("8002"),
    { ...rules, earningsFilterMode: "off" },
    "2026-05-30T00:00:00.000Z",
    near
  ).candidates[0];
  assert.equal(off.status, "buy_candidate");
  assert.ok(!off.reasons.some((reason) => reason.key === "earnings_soon"));

  // earnings空 → 影響なし(既定 exclude でも不発)
  const empty = evaluateCandidates(watchlist, samplePrices("8002"), rules, "2026-05-30T00:00:00.000Z", []).candidates[0];
  assert.equal(empty.status, "buy_candidate");
  assert.equal(empty.nextEarningsDate, null);
  assert.equal(empty.daysToEarnings, null);
  assert.ok(!empty.reasons.some((reason) => reason.key === "earnings_soon"));
});

test("earnings proximity is measured from latest.date, not today (backtest consistency)", () => {
  const watchlist = [watchlistRow("8002", "商社")];
  // 評価日は過去(2026-05-30)。当時から見た未来 2026-06-03 と、今日(2026-07-12)より後の 2026-08-01。
  // latest.date 基準なら最初の未来日は 2026-06-03。今日基準だと 2026-06-03 は過去で選ばれない。
  const earnings: EarningsRow[] = [
    { code: "8002", earningsDate: "2026-06-03", memo: "" },
    { code: "8002", earningsDate: "2026-08-01", memo: "" }
  ];
  const candidate = evaluateCandidates(
    watchlist,
    samplePrices("8002"),
    { ...rules, earningsFilterMode: "flag" },
    "2026-05-30T00:00:00.000Z",
    earnings
  ).candidates[0];

  assert.equal(candidate.nextEarningsDate, "2026-06-03");
  assert.equal(candidate.daysToEarnings, 3);
});

// ---- toEarningsRows(手動CSVパース) ----

test("toEarningsRows parses, sorts by date, and errors on invalid rows", () => {
  const rows = toEarningsRows("code,earningsDate,memo\n5803,2026-08-08,\n7011,2026-08-04,1Q決算\n");
  assert.deepEqual(
    rows.map((row) => `${row.code}:${row.earningsDate}`),
    ["7011:2026-08-04", "5803:2026-08-08"]
  );
  assert.equal(rows[0].memo, "1Q決算");

  // codeは4桁に正規化される
  assert.equal(toEarningsRows("code,earningsDate,memo\n83,2026-08-08,\n")[0].code, "0083");

  assert.throws(
    () => toEarningsRows("code,earningsDate,memo\n7011,2026/08/04,\n"),
    /earnings.csv 2行目: earningsDate は YYYY-MM-DD/
  );
  assert.throws(
    () => toEarningsRows("code,earningsDate,memo\n,2026-08-04,\n"),
    /earnings.csv 2行目: code は必須です/
  );
});

// ---- テーマスコア(binary互換 / continuous) ----

test("binary mode keeps legacy theme output and null scoreComponents", () => {
  const watchlist = [watchlistRow("8002", "商社")];
  const result = evaluateCandidates(watchlist, samplePrices("8002"), rules, "2026-05-30T00:00:00.000Z");
  const theme = result.themeScores[0];

  // 1テーマ: rank1(30) + 維持率1/1(30+20) + return5dプラス(20) = 100
  assert.equal(theme.themeScore, 100);
  assert.equal(theme.rank, 1);
  assert.equal(theme.scoreComponents, null);
});

test("continuous mode ranks themes by blended 5d/20d relative strength", () => {
  const watchlist: WatchlistRow[] = [
    watchlistRow("9201", "テーマA"), // 5日は最強だが20日は最弱
    watchlistRow("9202", "テーマB"), // 5日は2位だが20日は最強
    watchlistRow("9203", "テーマC")
  ];
  const prices = [
    ...pricesWithReturns("9201", 0.04, -0.06),
    ...pricesWithReturns("9202", 0.02, 0.08),
    ...pricesWithReturns("9203", -0.03, 0.01)
  ];

  const binary = evaluateCandidates(watchlist, prices, rules, "2026-05-30T00:00:00.000Z");
  const continuous = evaluateCandidates(
    watchlist,
    prices,
    { ...rules, themeScoringMode: "continuous" },
    "2026-05-30T00:00:00.000Z"
  );

  const rankOf = (themes: typeof binary.themeScores, name: string) =>
    themes.find((theme) => theme.theme === name)?.rank;

  // binaryはreturn5d順: A→B→C
  assert.equal(rankOf(binary.themeScores, "テーマA"), 1);
  assert.equal(rankOf(binary.themeScores, "テーマB"), 2);

  // continuousは相対強度(0.6×pct5+0.4×pct20)順: B(0.7)→A(0.6)→C(0.2)
  assert.equal(rankOf(continuous.themeScores, "テーマB"), 1);
  assert.equal(rankOf(continuous.themeScores, "テーマA"), 2);
  assert.equal(rankOf(continuous.themeScores, "テーマC"), 3);

  for (const theme of continuous.themeScores) {
    assert.ok(theme.scoreComponents !== null);
    const sum =
      theme.scoreComponents.relativeStrength +
      theme.scoreComponents.leaderMa5 +
      theme.scoreComponents.leaderMa25 +
      theme.scoreComponents.momentum;
    assert.ok(Math.abs(sum - theme.themeScore) <= 0.7);

    const expectedStatus =
      theme.themeScore >= rules.themeBuyScoreThreshold
        ? "strong"
        : theme.themeScore >= rules.themeWatchScoreThreshold
          ? "watch"
          : "weak";
    assert.equal(theme.status, expectedStatus);
  }

  // 候補のthemeScoreはテーマ側と一致し続ける
  for (const candidate of continuous.candidates) {
    const theme = continuous.themeScores.find((row) => row.theme === candidate.theme);
    assert.equal(candidate.themeScore, theme?.themeScore);
  }
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

/** return5d/return20dだけを狙った値にした30本の系列(rateOfChangeAtは端点のみ参照する) */
function pricesWithReturns(code: string, r5: number, r20: number): PriceRow[] {
  const closes = Array.from({ length: 30 }, () => 100);
  closes[24] = 100 / (1 + r5); // rateOfChangeAt(closes, 29, 5) の始点
  closes[9] = 100 / (1 + r20); // rateOfChangeAt(closes, 29, 20) の始点

  return closes.map((close, index) => ({
    code,
    date: `2026-05-${String(index + 1).padStart(2, "0")}`,
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1_000_000
  }));
}

/** 直近3日の出来高だけ半減させた押し目(売り枯れ)パターン */
function dryUpPrices(code: string): PriceRow[] {
  return samplePrices(code).map((row, index) => (index >= 27 ? { ...row, volume: 500_000 } : { ...row, volume: 1_000_000 }));
}

/** 市場指標(1306)用の30本系列。任意のcloses配列から生成する(>=26本で market が非null) */
function marketSeries(code: string, closes: number[]): PriceRow[] {
  return closes.map((close, index) => ({
    code,
    date: `2026-05-${String(index + 1).padStart(2, "0")}`,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1_000_000
  }));
}

/** 明確な上昇(終値>MA25・MA25上向き → regimeOk=true) */
function risingCloses(): number[] {
  return Array.from({ length: 30 }, (_, index) => 1000 + index * 10);
}

/** 上昇後に最終日だけ下押し(終値<MA25 だがMA25はまだ上向き → regimeOk=false) */
function weakCloseCloses(): number[] {
  return [...Array.from({ length: 29 }, (_, index) => 1000 + index * 10), 1100];
}

/** 明確な下降(MA25下向き → regimeOk=false) */
function decliningCloses(): number[] {
  return Array.from({ length: 30 }, (_, index) => 1300 - index * 10);
}
