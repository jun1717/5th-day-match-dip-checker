import assert from "node:assert/strict";
import test from "node:test";
import { buildSnapshot, rulesHashOf, snapshotDateOf, toSlimCandidate } from "../lib/snapshot";
import { CandidateResult, ThemeScore } from "../lib/types";

function candidateFixture(overrides: Partial<CandidateResult> = {}): CandidateResult {
  return {
    watchlistKey: "5803__電線・データセンター",
    code: "5803",
    name: "フジクラ",
    sector: "非鉄金属",
    theme: "電線・データセンター",
    isLeader: true,
    watchPriority: "A",
    status: "buy_candidate",
    date: "2026-07-10",
    close: 6000,
    volume: 1000000,
    ma5: 5970,
    ma25: 5800,
    ma5Slope: 10,
    ma25Slope: 5,
    ma5Deviation: 0.005,
    ma25Deviation: 0.034,
    ma5Trend: "up",
    ma25Trend: "up",
    yearHigh: 6400,
    yearHighDeviation: -0.0625,
    previousLow: 5900,
    return5d: 0.01,
    return20d: 0.05,
    atr: 180,
    stopDistanceAtr: 0.55,
    volumeShortAvg: 900000,
    volumeLongAvg: 1000000,
    volumeRatio: 0.9,
    individualScore: 100,
    themeScore: 100,
    themeRank: 1,
    entryPrice: 5999.85,
    entryUpperPrice: 6059.55,
    stopLoss: 5900,
    suggestedShares: 100,
    positionCost: 599985,
    expectedLoss: 9985,
    recentHigh20: 6400,
    takeProfit1: 6400,
    riskR: 99.85,
    reward: 400.15,
    rewardR: 4.01,
    exitMode: "trend_follow_exit",
    profitWarnings: [],
    reasons: [
      { key: "buy_setup_ready", label: "買い候補条件を満たしている", passed: true, detail: "..." }
    ],
    tomorrowAction: "9:30〜10:00に確認。",
    intradayMemo: ["現在値が損切りラインより上"],
    ...overrides
  };
}

const themeScoreFixture: ThemeScore = {
  theme: "電線・データセンター",
  priority: "A",
  rank: 1,
  return5d: 0.02,
  return20d: 0.08,
  themeScore: 100,
  leaderMa5AboveRatio: 1,
  leaderMa25AboveRatio: 1,
  status: "strong",
  stockCount: 5,
  leaderCount: 3,
  scoreComponents: null
};

test("snapshotDateOf picks the latest non-null date", () => {
  const candidates = [
    candidateFixture({ date: "2026-07-09" }),
    candidateFixture({ date: null }),
    candidateFixture({ date: "2026-07-10" })
  ];

  assert.equal(snapshotDateOf(candidates), "2026-07-10");
});

test("snapshotDateOf returns null when all dates are null", () => {
  assert.equal(snapshotDateOf([candidateFixture({ date: null })]), null);
});

test("toSlimCandidate keeps analysis fields and converts reasons to keys", () => {
  const slim = toSlimCandidate(candidateFixture());

  assert.equal(slim.code, "5803");
  assert.equal(slim.status, "buy_candidate");
  assert.equal(slim.entryPrice, 5999.85);
  assert.equal(slim.stopLoss, 5900);
  assert.equal(slim.takeProfit1, 6400);
  assert.equal(slim.exitMode, "trend_follow_exit");
  assert.equal(slim.atr, 180);
  assert.equal(slim.stopDistanceAtr, 0.55);
  assert.equal(slim.volumeRatio, 0.9);
  assert.equal(slim.suggestedShares, 100);
  assert.equal(slim.positionCost, 599985);
  assert.deepEqual(slim.reasonKeys, ["buy_setup_ready"]);

  const keys = Object.keys(slim);
  assert.ok(!keys.includes("tomorrowAction"));
  assert.ok(!keys.includes("intradayMemo"));
  assert.ok(!keys.includes("profitWarnings"));
  assert.ok(!keys.includes("reasons"));
  // 比率があれば復元不要のため生の出来高平均はスナップショットに保存しない
  assert.ok(!keys.includes("volumeShortAvg"));
  assert.ok(!keys.includes("volumeLongAvg"));
});

test("buildSnapshot assembles snapshot with date, hash and slim candidates", () => {
  const snapshot = buildSnapshot(
    [candidateFixture({ date: "2026-07-09" }), candidateFixture({ date: "2026-07-10" })],
    [themeScoreFixture],
    "a1b2c3d4e5f6",
    "2026-07-10T07:35:00.000Z"
  );

  assert.ok(snapshot !== null);
  assert.equal(snapshot.snapshotDate, "2026-07-10");
  assert.equal(snapshot.generatedAt, "2026-07-10T07:35:00.000Z");
  assert.equal(snapshot.rulesHash, "a1b2c3d4e5f6");
  assert.equal(snapshot.candidates.length, 2);
  assert.equal(snapshot.themeScores.length, 1);
});

test("buildSnapshot returns null when no candidate has a date", () => {
  const snapshot = buildSnapshot([candidateFixture({ date: null })], [themeScoreFixture], "a1b2c3d4e5f6");
  assert.equal(snapshot, null);
});

test("rulesHashOf is a stable 12-char sha256 prefix", () => {
  const hash = rulesHashOf('{"maShort":5}');
  assert.equal(hash.length, 12);
  assert.equal(hash, rulesHashOf('{"maShort":5}'));
  assert.notEqual(hash, rulesHashOf('{"maShort":6}'));
});
