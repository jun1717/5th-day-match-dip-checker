import assert from "node:assert/strict";
import test from "node:test";
import { toExecutionRows } from "../lib/csv";
import { SignalSnapshot, SlimCandidate } from "../lib/snapshot";
import {
  DEFAULT_REVIEW_OPTIONS,
  LotReview,
  matchSignal,
  monthlyReviews,
  pairExecutions,
  reviewClosedLot,
  reviewOpenLot
} from "../lib/tradeReview";
import { PriceRow } from "../lib/types";

// ---- toExecutionRows ----

test("toExecutionRows parses, normalizes codes and sorts by date", () => {
  const rows = toExecutionRows(
    [
      "executedAt,code,side,price,shares,memo",
      "2026-07-10,5803,sell,6580,100,利確",
      "2026-07-09,980,buy,6210,100,",
      "2026-07-09,5803,buy,6300,100,追加"
    ].join("\n")
  );

  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.executedAt), ["2026-07-09", "2026-07-09", "2026-07-10"]);
  assert.equal(rows[0].code, "0980"); // 数字コードは4桁ゼロ埋め
  assert.equal(rows[0].memo, "");
  assert.equal(rows[1].memo, "追加"); // 同日内はファイル記載順を保つ
  assert.equal(rows[2].side, "sell");
});

test("toExecutionRows fails fast with line numbers on invalid rows", () => {
  const header = "executedAt,code,side,price,shares,memo";
  assert.throws(
    () => toExecutionRows(`${header}\n2026/07/10,5803,buy,6210,100,`),
    /2行目.*executedAt/
  );
  assert.throws(
    () => toExecutionRows(`${header}\n2026-07-10,5803,BUY,6210,100,`),
    /2行目.*side/
  );
  assert.throws(
    () => toExecutionRows(`${header}\n2026-07-10,5803,buy,-5,100,`),
    /2行目.*price/
  );
  assert.throws(
    () => toExecutionRows(`${header}\n2026-07-10,5803,buy,6210,0,`),
    /2行目.*shares/
  );
  assert.throws(
    () => toExecutionRows(`${header}\n2026-07-10,5803,buy,6210,100,\n2026-07-11,5803,sell,6300,10.5,`),
    /3行目.*shares/
  );
});

// ---- pairExecutions ----

function execution(executedAt: string, code: string, side: "buy" | "sell", price: number, shares: number) {
  return { executedAt, code, side, price, shares, memo: "" };
}

test("pairExecutions pairs a simple round trip", () => {
  const { closed, open } = pairExecutions([
    execution("2026-07-09", "5803", "buy", 6210, 100),
    execution("2026-07-15", "5803", "sell", 6580, 100)
  ]);

  assert.equal(open.length, 0);
  assert.equal(closed.length, 1);
  assert.deepEqual(closed[0], {
    code: "5803",
    shares: 100,
    buyDate: "2026-07-09",
    buyPrice: 6210,
    sellDate: "2026-07-15",
    sellPrice: 6580,
    pnlYen: 37000,
    buyMemo: "",
    sellMemo: ""
  });
});

test("pairExecutions splits partial sells against one lot", () => {
  const { closed, open } = pairExecutions([
    execution("2026-07-09", "5803", "buy", 6000, 100),
    execution("2026-07-10", "5803", "sell", 6100, 60),
    execution("2026-07-11", "5803", "sell", 6200, 40)
  ]);

  assert.equal(open.length, 0);
  assert.deepEqual(closed.map((lot) => [lot.shares, lot.sellDate, lot.pnlYen]), [
    [60, "2026-07-10", 6000],
    [40, "2026-07-11", 8000]
  ]);
});

test("pairExecutions spans lots FIFO when a sell crosses lot boundaries", () => {
  const { closed, open } = pairExecutions([
    execution("2026-07-01", "5803", "buy", 6000, 100),
    execution("2026-07-02", "5803", "buy", 6100, 100),
    execution("2026-07-10", "5803", "sell", 6300, 150)
  ]);

  // 古いロットから150株を充当: 100株(買値6000) + 50株(買値6100)
  assert.deepEqual(closed.map((lot) => [lot.buyDate, lot.shares, lot.pnlYen]), [
    ["2026-07-01", 100, 30000],
    ["2026-07-02", 50, 10000]
  ]);
  assert.deepEqual(open.map((lot) => [lot.buyDate, lot.shares]), [["2026-07-02", 50]]);
});

test("pairExecutions keeps unsold buys open and codes independent", () => {
  const { closed, open } = pairExecutions([
    execution("2026-07-01", "5803", "buy", 6000, 100),
    execution("2026-07-01", "7011", "buy", 2300, 200),
    execution("2026-07-05", "7011", "sell", 2400, 200)
  ]);

  assert.equal(closed.length, 1);
  assert.equal(closed[0].code, "7011");
  assert.deepEqual(open.map((lot) => lot.code), ["5803"]);
});

test("pairExecutions throws when a sell exceeds held shares", () => {
  assert.throws(
    () =>
      pairExecutions([
        execution("2026-07-01", "5803", "buy", 6000, 100),
        execution("2026-07-05", "5803", "sell", 6100, 200)
      ]),
    /5803.*売り200株が保有株数を超えています/
  );
});

// ---- フィクスチャ(シグナル・価格) ----

function slimCandidate(overrides: Partial<SlimCandidate> = {}): SlimCandidate {
  return {
    watchlistKey: "5803__電線・データセンター",
    code: "5803",
    name: "フジクラ",
    theme: "電線・データセンター",
    isLeader: true,
    watchPriority: "A",
    status: "buy_candidate",
    date: "2026-07-09",
    close: 100,
    volume: 1_000_000,
    ma5: 100,
    ma25: 95,
    ma5Deviation: 0,
    ma25Deviation: 0.05,
    ma5Trend: "up",
    ma25Trend: "up",
    yearHighDeviation: -0.05,
    return5d: 0.01,
    return20d: 0.03,
    atr: 3,
    stopDistanceAtr: 1.2,
    volumeRatio: 0.8,
    individualScore: 100,
    themeScore: 100,
    themeRank: 1,
    entryPrice: 100.5,
    entryUpperPrice: 101.5,
    stopLoss: 97,
    suggestedShares: 300,
    positionCost: 30150,
    expectedLoss: 1050,
    takeProfit1: 110,
    riskR: 3.5,
    reward: 9.5,
    rewardR: 2.71,
    exitMode: "target_exit",
    reasonKeys: ["buy_setup_ready"],
    ...overrides
  };
}

function snapshotOf(date: string, candidates: SlimCandidate[]): SignalSnapshot {
  return {
    snapshotDate: date,
    generatedAt: `${date}T07:30:00.000Z`,
    rulesHash: "abcdef123456",
    candidates,
    themeScores: []
  };
}

function snapshotsMap(...snapshots: SignalSnapshot[]): Map<string, SignalSnapshot> {
  return new Map(snapshots.map((snapshot) => [snapshot.snapshotDate, snapshot]));
}

function bar(code: string, date: string, open: number, high: number, low: number, close: number): PriceRow {
  return { code, date, open, high, low, close, volume: 1_000_000 };
}

/** シグナル日2026-07-09 → 翌日寄りで約定 → 07-11に利確ライン(110)到達のシンプルな系列 */
function reviewPrices(): Map<string, PriceRow[]> {
  return new Map([
    [
      "5803",
      [
        bar("5803", "2026-07-08", 99, 100, 97.5, 99),
        bar("5803", "2026-07-09", 99, 101, 98, 100),
        bar("5803", "2026-07-10", 100, 102, 99.5, 101),
        bar("5803", "2026-07-11", 105, 111, 104, 109)
      ]
    ]
  ]);
}

function closedLot(overrides: Partial<Parameters<typeof reviewClosedLot>[0]> = {}) {
  return {
    code: "5803",
    shares: 100,
    buyDate: "2026-07-10",
    buyPrice: 100.8,
    sellDate: "2026-07-11",
    sellPrice: 108,
    pnlYen: 720,
    buyMemo: "",
    sellMemo: "",
    ...overrides
  };
}

// ---- matchSignal ----

test("matchSignal picks the latest snapshot strictly before the buy date", () => {
  const snapshots = snapshotsMap(
    snapshotOf("2026-07-08", [slimCandidate({ date: "2026-07-08" })]),
    snapshotOf("2026-07-09", [slimCandidate()])
  );

  const match = matchSignal("2026-07-10", "5803", snapshots, 5);
  assert.ok(match !== null);
  assert.equal(match.snapshotDate, "2026-07-09");
  assert.equal(match.sameDaySignal, false);
  assert.equal(match.candidate?.code, "5803");
});

test("matchSignal crosses weekends within the lookback window", () => {
  // 金曜のスナップショット → 月曜の買い
  const snapshots = snapshotsMap(snapshotOf("2026-07-03", [slimCandidate({ date: "2026-07-03" })]));
  const match = matchSignal("2026-07-06", "5803", snapshots, 5);
  assert.equal(match?.snapshotDate, "2026-07-03");
});

test("matchSignal returns null outside the lookback window", () => {
  const snapshots = snapshotsMap(snapshotOf("2026-07-01", [slimCandidate({ date: "2026-07-01" })]));
  assert.equal(matchSignal("2026-07-10", "5803", snapshots, 5), null);
});

test("matchSignal falls back to the same-day snapshot with a flag", () => {
  const snapshots = snapshotsMap(snapshotOf("2026-07-10", [slimCandidate({ date: "2026-07-10" })]));
  const match = matchSignal("2026-07-10", "5803", snapshots, 5);
  assert.equal(match?.snapshotDate, "2026-07-10");
  assert.equal(match?.sameDaySignal, true);
});

test("matchSignal dedupes multi-theme rows by themeScore", () => {
  const snapshots = snapshotsMap(
    snapshotOf("2026-07-09", [
      slimCandidate({ watchlistKey: "5803__非鉄・資源素材", theme: "非鉄・資源素材", themeScore: 70 }),
      slimCandidate({ themeScore: 100 })
    ])
  );

  const match = matchSignal("2026-07-10", "5803", snapshots, 5);
  assert.equal(match?.candidate?.theme, "電線・データセンター");
});

test("matchSignal reports missing code as off_watchlist via null candidate", () => {
  const snapshots = snapshotsMap(snapshotOf("2026-07-09", [slimCandidate({ code: "9999", watchlistKey: "9999__他" })]));
  const match = matchSignal("2026-07-10", "5803", snapshots, 5);
  assert.ok(match !== null);
  assert.equal(match.candidate, null);
});

// ---- reviewClosedLot: フラグ・計測値・仮想成績 ----

test("compliant trade carries no flags and computes slippage, holdDays and virtual result", () => {
  const snapshots = snapshotsMap(snapshotOf("2026-07-09", [slimCandidate()]));
  const review = reviewClosedLot(closedLot(), snapshots, reviewPrices());

  assert.deepEqual(review.flags, []);
  assert.ok(review.entrySlippagePct !== null);
  assert.ok(Math.abs(review.entrySlippagePct - (100.8 - 100.5) / 100.5) < 1e-9);
  assert.equal(review.holdDays, 1);

  // 仮想: 07-10寄り100で約定(entryPrice100.5以下) → 07-11に利確110で決済 → (110-100)×100株
  assert.ok(review.virtual !== null);
  assert.equal(review.virtual.filled, true);
  assert.equal(review.virtualPnlYen, 1000);
  assert.equal(review.executionGapYen, 720 - 1000);
});

test("review flags rule deviations from the matched signal", () => {
  const prices = reviewPrices();

  // not_buy_candidate
  const watchSnapshot = snapshotsMap(snapshotOf("2026-07-09", [slimCandidate({ status: "watch" })]));
  assert.deepEqual(reviewClosedLot(closedLot(), watchSnapshot, prices).flags, ["not_buy_candidate"]);

  // chase_entry: 上限ちょうどはセーフ、超えたらフラグ
  const snapshots = snapshotsMap(snapshotOf("2026-07-09", [slimCandidate()]));
  assert.deepEqual(reviewClosedLot(closedLot({ buyPrice: 101.5 }), snapshots, prices).flags, []);
  assert.deepEqual(reviewClosedLot(closedLot({ buyPrice: 101.51 }), snapshots, prices).flags, ["chase_entry"]);

  // over_sized
  assert.deepEqual(reviewClosedLot(closedLot({ shares: 400 }), snapshots, prices).flags, ["over_sized"]);

  // no_signal_data
  assert.deepEqual(reviewClosedLot(closedLot(), snapshotsMap(), prices).flags, ["no_signal_data"]);

  // off_watchlist
  const otherOnly = snapshotsMap(snapshotOf("2026-07-09", [slimCandidate({ code: "9999", watchlistKey: "9999__他" })]));
  assert.deepEqual(reviewClosedLot(closedLot(), otherOnly, prices).flags, ["off_watchlist"]);
});

test("late_stop puts the tolerance boundary on the safe side", () => {
  // stopLoss=100 / tolerance 0.5% → 99.5ちょうどはセーフ、下回るとフラグ
  const snapshots = snapshotsMap(snapshotOf("2026-07-09", [slimCandidate({ stopLoss: 100 })]));
  const prices = reviewPrices();

  const safe = reviewClosedLot(closedLot({ sellPrice: 99.5, pnlYen: -130 }), snapshots, prices);
  assert.ok(!safe.flags.includes("late_stop"));

  const late = reviewClosedLot(closedLot({ sellPrice: 99.49, pnlYen: -131 }), snapshots, prices);
  assert.ok(late.flags.includes("late_stop"));
});

test("virtual result is null when prices do not cover the signal date", () => {
  const snapshots = snapshotsMap(snapshotOf("2026-07-09", [slimCandidate()]));
  const review = reviewClosedLot(closedLot(), snapshots, new Map());

  assert.equal(review.virtual, null);
  assert.equal(review.virtualPnlYen, null);
  assert.equal(review.executionGapYen, null);
  assert.equal(review.holdDays, null);
});

// ---- reviewOpenLot ----

test("open lot below the stop line is flagged as holding_below_stop", () => {
  const snapshots = snapshotsMap(snapshotOf("2026-07-09", [slimCandidate({ stopLoss: 97 })]));
  const prices = new Map([
    [
      "5803",
      [bar("5803", "2026-07-09", 99, 101, 98, 100), bar("5803", "2026-07-10", 100, 102, 95, 96)]
    ]
  ]);

  const review = reviewOpenLot(
    { code: "5803", shares: 100, buyDate: "2026-07-10", buyPrice: 100.8, buyMemo: "" },
    snapshots,
    prices
  );

  assert.ok(review.flags.includes("holding_below_stop"));
  assert.equal(review.lastClose, 96);
  assert.equal(review.unrealizedPnlYen, (96 - 100.8) * 100);
  assert.equal(review.stopLoss, 97);
});

// ---- monthlyReviews ----

function lotReviewFixture(sellDate: string, pnlYen: number, overrides: Partial<LotReview> = {}): LotReview {
  return {
    lot: closedLot({ sellDate, pnlYen }),
    match: null,
    flags: [],
    entrySlippagePct: null,
    holdDays: null,
    virtual: null,
    virtualPnlYen: null,
    executionGapYen: null,
    ...overrides
  };
}

test("monthlyReviews groups by sell month and separates rule violations", () => {
  const reviews: LotReview[] = [
    lotReviewFixture("2026-07-15", 1000, { entrySlippagePct: 0.01, virtualPnlYen: 1500, executionGapYen: -500 }),
    lotReviewFixture("2026-07-20", -400, { flags: ["not_buy_candidate"], entrySlippagePct: 0.03 }),
    lotReviewFixture("2026-08-05", 2000, { flags: ["same_day_signal"] }) // 執行タイミング系はルール外に数えない
  ];

  const months = monthlyReviews(reviews);
  assert.deepEqual(months.map((row) => row.month), ["2026-07", "2026-08"]);

  const july = months[0];
  assert.equal(july.closedLots, 2);
  assert.equal(july.ruleCompliant, 1);
  assert.equal(july.ruleViolations, 1);
  assert.equal(july.actualPnlYen, 600);
  assert.ok(july.avgEntrySlippagePct !== null && Math.abs(july.avgEntrySlippagePct - 0.02) < 1e-9);
  // 仮想が計算できた1ロットのみで突き合わせ(実現1000 − 仮想1500 = -500)
  assert.equal(july.virtualCoveredLots, 1);
  assert.equal(july.virtualPnlYen, 1500);
  assert.equal(july.executionGapYen, -500);

  const august = months[1];
  assert.equal(august.ruleCompliant, 1);
  assert.equal(august.virtualPnlYen, null);
  assert.equal(august.executionGapYen, null);
});

test("default review options match the doctrine defaults", () => {
  assert.equal(DEFAULT_REVIEW_OPTIONS.lookbackDays, 5);
  assert.equal(DEFAULT_REVIEW_OPTIONS.stopTolerance, 0.005);
  assert.equal(DEFAULT_REVIEW_OPTIONS.maxHoldDays, 30);
  assert.equal(DEFAULT_REVIEW_OPTIONS.stopMode, "prev-day");
});
