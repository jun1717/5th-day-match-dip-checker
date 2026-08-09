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
  // 平日(金)17:00 JST、asOf=同日15:30(確定終値)、fetchedAt=同日16:31(大引け後にビルド済み)
  const nowMs = Date.UTC(2026, 6, 17, 8, 0);
  assert.equal(confirmedCloseWarning("2026-07-17T15:30:00+09:00", "2026-07-17T16:31:00+09:00", nowMs), null);
});

test("confirmedCloseWarning: 場中データは unconfirmed", () => {
  const nowMs = Date.UTC(2026, 6, 17, 8, 0); // 金曜17:00 JST
  // asOfの時刻が15:30未満 = まだ大引け前の気配
  const intraday = confirmedCloseWarning("2026-07-17T15:24:00+09:00", "2026-07-17T15:26:00+09:00", nowMs);
  assert.equal(intraday?.reason, "unconfirmed");
  assert.equal(intraday?.decisionDay, "2026-07-17");
  assert.equal(intraday?.pricesAsOf, "2026-07-17T15:24:00+09:00");
});

test("confirmedCloseWarning: 大引け後にビルドが走っていなければ stale", () => {
  const nowMs = Date.UTC(2026, 6, 17, 8, 0); // 金曜17:00 JST
  // 前営業日の確定終値のまま、取得も前営業日どまり → 丸1日更新なし
  const dead = confirmedCloseWarning("2026-07-16T15:30:00+09:00", "2026-07-16T19:00:00+09:00", nowMs);
  assert.equal(dead?.reason, "stale");
  assert.equal(dead?.pricesFetchedAt, "2026-07-16T19:00:00+09:00");

  // 当日ビルドはされたが大引け前で止まった(9時台のasOfは前営業日の15:30を返すため
  // asOfだけでは確定済みに見えてしまう。fetchedAtが無いとこれを見逃す)
  const diedInMorning = confirmedCloseWarning("2026-07-16T15:30:00+09:00", "2026-07-17T09:03:00+09:00", nowMs);
  assert.equal(diedInMorning?.reason, "stale");
});

test("confirmedCloseWarning: 休場の平日(祝日)は誤警告しない", () => {
  // 2026-08-11(火)は山の日で休場。直近の確定セッションは前営業日8/10(月)。
  // cronは曜日指定(1-5)で祝日も走るため、当日の大引け後にもビルドは走る。
  const holidayEvening = Date.UTC(2026, 7, 11, 7, 41); // 8/11(火) 16:41 JST
  assert.equal(latestDecisionDay(holidayEvening), "2026-08-11"); // 祝日を営業日と誤認する(平日近似)
  assert.equal(
    confirmedCloseWarning("2026-08-10T15:30:00+09:00", "2026-08-11T16:31:00+09:00", holidayEvening),
    null
  );

  // 翌営業日8/12(水)の朝: asOfはまだ8/10の15:30だが、当日ビルドが走っているので警告なし
  assert.equal(
    confirmedCloseWarning("2026-08-10T15:30:00+09:00", "2026-08-12T09:03:00+09:00", Date.UTC(2026, 7, 12, 0, 3)),
    null
  );
});

test("confirmedCloseWarning: 週末・月曜朝は金曜の確定データで警告なし", () => {
  const fridayAsOf = "2026-07-17T15:30:00+09:00";
  // 土曜10:00 JST、取得は金曜の大引け後どまり(土日はcronが走らない)→ null
  assert.equal(confirmedCloseWarning(fridayAsOf, "2026-07-17T16:31:00+09:00", Date.UTC(2026, 6, 18, 1, 0)), null);
  // 月曜09:00 JST、月曜朝のビルド済み → null(判断開始済み営業日はまだ金曜)
  assert.equal(confirmedCloseWarning(fridayAsOf, "2026-07-20T09:03:00+09:00", Date.UTC(2026, 6, 20, 0, 0)), null);
});

test("confirmedCloseWarning: null・パース不能は unknown", () => {
  const nowMs = Date.UTC(2026, 6, 17, 8, 0);
  const noAsOf = confirmedCloseWarning(null, "2026-07-17T16:31:00+09:00", nowMs);
  assert.equal(noAsOf?.reason, "unknown");
  assert.equal(noAsOf?.pricesAsOf, null);
  // fetched_at を持たない古い prices_as_of.json も判定不能として警告する
  const noFetchedAt = confirmedCloseWarning("2026-07-17T15:30:00+09:00", null, nowMs);
  assert.equal(noFetchedAt?.reason, "unknown");
  assert.equal(confirmedCloseWarning("invalid", "2026-07-17T16:31:00+09:00", nowMs)?.reason, "unknown");
  assert.equal(confirmedCloseWarning("2026-07-17T15:30:00+09:00", "invalid", nowMs)?.reason, "unknown");
});

test("confirmedCloseWarning: 境界はどちらも15:30ちょうどまで確定扱い(>=)", () => {
  const nowMs = Date.UTC(2026, 6, 17, 8, 0);
  // asOf: 15:29:59は場中、15:30:00は確定
  assert.equal(confirmedCloseWarning("2026-07-17T15:29:59+09:00", "2026-07-17T16:31:00+09:00", nowMs)?.reason, "unconfirmed");
  assert.equal(confirmedCloseWarning("2026-07-17T15:30:00+09:00", "2026-07-17T16:31:00+09:00", nowMs), null);
  // fetchedAt: 15:29:59は未実施扱い、15:30:00は実施済み
  assert.equal(confirmedCloseWarning("2026-07-17T15:30:00+09:00", "2026-07-17T15:29:59+09:00", nowMs)?.reason, "stale");
  assert.equal(confirmedCloseWarning("2026-07-17T15:30:00+09:00", "2026-07-17T15:30:00+09:00", nowMs), null);
});

test("confirmedCloseWarning: 判定は閲覧端末のタイムゾーンに依存しない", () => {
  const nowMs = Date.UTC(2026, 6, 17, 8, 0);
  // 同じ瞬間をUTC表記で渡しても結果は変わらない(15:30 JST = 06:30 UTC)
  assert.equal(confirmedCloseWarning("2026-07-17T06:30:00Z", "2026-07-17T07:31:00Z", nowMs), null);
  assert.equal(confirmedCloseWarning("2026-07-17T06:24:00Z", "2026-07-17T07:31:00Z", nowMs)?.reason, "unconfirmed");
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
