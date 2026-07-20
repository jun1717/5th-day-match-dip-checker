import assert from "node:assert/strict";
import test from "node:test";
import { confirmedCloseWarning, latestDecisionDay, snapshotLagWarning } from "../lib/freshness";

// 時刻はすべて「JSTでの意味」をコメントに書き、Date.UTC(...) で組み立てる(JST = UTC+9)。
// 例: JST 2026-07-17(金) 16:40 = Date.UTC(2026, 6, 17, 7, 40)

test("latestDecisionDay: 平日16:40が境界(以降で当日、前は前営業日)", () => {
  // 金曜16:39 JST → 前日木曜
  assert.equal(latestDecisionDay(Date.UTC(2026, 6, 17, 7, 39)), "2026-07-16");
  // 金曜16:40 JST → 当日金曜
  assert.equal(latestDecisionDay(Date.UTC(2026, 6, 17, 7, 40)), "2026-07-17");
});

test("latestDecisionDay: 土日・月曜朝は直前の金曜", () => {
  // 土曜10:00 JST → 金曜
  assert.equal(latestDecisionDay(Date.UTC(2026, 6, 18, 1, 0)), "2026-07-17");
  // 日曜12:00 JST → 金曜
  assert.equal(latestDecisionDay(Date.UTC(2026, 6, 19, 3, 0)), "2026-07-17");
  // 月曜09:00 JST → 前週金曜
  assert.equal(latestDecisionDay(Date.UTC(2026, 6, 20, 0, 0)), "2026-07-17");
  // 月曜16:40 JST → 当日月曜
  assert.equal(latestDecisionDay(Date.UTC(2026, 6, 20, 7, 40)), "2026-07-20");
});

test("latestDecisionDay: JSTの曜日で判定する(UTC曜日ではない)", () => {
  // JST月曜00:30(= UTC日曜15:30)→ 前週金曜
  assert.equal(latestDecisionDay(Date.UTC(2026, 6, 19, 15, 30)), "2026-07-17");
});

test("confirmedCloseWarning: 大引け後の確定データは警告なし", () => {
  // 平日(金)17:00 JST、asOf=同日16:31+09:00 → null(確定済み)
  const nowMs = Date.UTC(2026, 6, 17, 8, 0);
  assert.equal(confirmedCloseWarning("2026-07-17T16:31:00+09:00", nowMs), null);
});

test("confirmedCloseWarning: 場中データ・丸1日更新なしは警告", () => {
  const nowMs = Date.UTC(2026, 6, 17, 8, 0); // 金曜17:00 JST
  // 同日15:24(場中データ)→ 警告
  const intraday = confirmedCloseWarning("2026-07-17T15:24:00+09:00", nowMs);
  assert.notEqual(intraday, null);
  assert.equal(intraday?.decisionDay, "2026-07-17");
  assert.equal(intraday?.pricesAsOf, "2026-07-17T15:24:00+09:00");
  // 前営業日16:31(丸1日更新なし)→ 警告
  assert.notEqual(confirmedCloseWarning("2026-07-16T16:31:00+09:00", nowMs), null);
});

test("confirmedCloseWarning: 週末・月曜朝は金曜の確定データで警告なし", () => {
  const fridayAsOf = "2026-07-17T16:31:00+09:00";
  // 土曜10:00 JST → null
  assert.equal(confirmedCloseWarning(fridayAsOf, Date.UTC(2026, 6, 18, 1, 0)), null);
  // 月曜09:00 JST → null(判断開始済み営業日はまだ金曜)
  assert.equal(confirmedCloseWarning(fridayAsOf, Date.UTC(2026, 6, 20, 0, 0)), null);
});

test("confirmedCloseWarning: null・パース不能は警告", () => {
  const nowMs = Date.UTC(2026, 6, 17, 8, 0);
  const nullWarning = confirmedCloseWarning(null, nowMs);
  assert.notEqual(nullWarning, null);
  assert.equal(nullWarning?.pricesAsOf, null);
  assert.notEqual(confirmedCloseWarning("invalid", nowMs), null);
});

test("confirmedCloseWarning: ちょうど15:30:00は確定扱い(>=)", () => {
  const nowMs = Date.UTC(2026, 6, 17, 8, 0);
  assert.equal(confirmedCloseWarning("2026-07-17T15:30:00+09:00", nowMs), null);
});

test("snapshotLagWarning: 遅れ0〜1営業日は正常", () => {
  // snapshot == dataDate → 遅れ0
  assert.equal(snapshotLagWarning("2026-07-17", "2026-07-17"), null);
  // snapshot=金曜、dataDate=月曜 → 遅れ1(場中ビルドの正常形)
  assert.equal(snapshotLagWarning("2026-07-17", "2026-07-20"), null);
});

test("snapshotLagWarning: 遅れ2営業日以上は警告", () => {
  // snapshot=水曜、dataDate=金曜 → 遅れ2
  const midweek = snapshotLagWarning("2026-07-15", "2026-07-17");
  assert.notEqual(midweek, null);
  assert.equal(midweek?.lagDays, 2);
  // snapshot=木曜、dataDate=月曜(週末跨ぎ)→ 遅れ2
  const acrossWeekend = snapshotLagWarning("2026-07-16", "2026-07-20");
  assert.notEqual(acrossWeekend, null);
  assert.equal(acrossWeekend?.lagDays, 2);
});

test("snapshotLagWarning: スナップショット0件は警告、dataDate不明は判定しない", () => {
  const noSnapshot = snapshotLagWarning(null, "2026-07-17");
  assert.notEqual(noSnapshot, null);
  assert.equal(noSnapshot?.latestSnapshotDate, null);
  assert.equal(noSnapshot?.lagDays, null);
  assert.equal(snapshotLagWarning(null, null), null);
  assert.equal(snapshotLagWarning("2026-07-17", null), null);
});

test("snapshotLagWarning: 未来のスナップショット(snapshot > dataDate)は警告なし", () => {
  assert.equal(snapshotLagWarning("2026-07-17", "2026-07-13"), null);
});
