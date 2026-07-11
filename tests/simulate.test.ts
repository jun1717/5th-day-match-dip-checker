import assert from "node:assert/strict";
import test from "node:test";
import { simulateTrade, SimulationInput } from "../lib/backtest/simulate";
import { PriceRow } from "../lib/types";

function bar(date: string, open: number, high: number, low: number, close: number): PriceRow {
  return { code: "0000", date, open, high, low, close, volume: 1000 };
}

function input(overrides: Partial<SimulationInput> = {}): SimulationInput {
  return {
    signal: {
      entryPrice: 100,
      entryUpperPrice: 101.5,
      takeProfit1: 110,
      stopLossSignal: 97,
      exitMode: "target_exit"
    },
    signalDayLow: 98,
    forwardBars: [],
    closesUpToSignal: [100, 100, 100, 100, 100],
    options: { maxHoldDays: 30, stopMode: "prev-day", shares: 100 },
    ...overrides
  };
}

test("寄りが買い基準価格以下なら寄り値で成行約定する", () => {
  const trade = simulateTrade(
    input({
      forwardBars: [bar("d1", 99.5, 105, 99, 104), bar("d2", 105, 111, 104, 110)]
    })
  );

  assert.equal(trade.filled, true);
  assert.equal(trade.entryDate, "d1");
  assert.equal(trade.entryFillPrice, 99.5);
  assert.equal(trade.exitReason, "take_profit");
  assert.equal(trade.exitPrice, 110);
  assert.equal(trade.holdDays, 2);
  assert.equal(trade.pnlYen, (110 - 99.5) * 100);
  assert.ok(Math.abs(trade.rMultiple! - (110 - 99.5) / (99.5 - 98)) < 1e-9);
});

test("寄りが買い基準価格超でザラ場に指値到達なら買い基準価格で約定する", () => {
  const trade = simulateTrade(
    input({
      forwardBars: [bar("d1", 101, 102, 99.8, 101), bar("d2", 105, 111, 104, 110)]
    })
  );

  assert.equal(trade.filled, true);
  assert.equal(trade.entryFillPrice, 100);
});

test("一度も買い基準価格まで下げなければ約定しない（追いかけない）", () => {
  const trade = simulateTrade(input({ forwardBars: [bar("d1", 101, 103, 100.5, 102)] }));

  assert.equal(trade.filled, false);
  assert.equal(trade.noFillReason, "never_reached_limit");
});

test("寄りが損切りライン以下にギャップダウンしたら約定しない", () => {
  const trade = simulateTrade(input({ forwardBars: [bar("d1", 97.5, 99, 97, 98.5)] }));

  assert.equal(trade.filled, false);
  assert.equal(trade.noFillReason, "gap_below_stop");
});

test("損切りラインがエントリー価格以上なら約定しない", () => {
  const trade = simulateTrade(
    input({ signalDayLow: 100.5, forwardBars: [bar("d1", 101, 102, 99.8, 101)] })
  );

  assert.equal(trade.filled, false);
  assert.equal(trade.noFillReason, "stop_at_or_above_entry");
  assert.equal(trade.stopUsed, 100.5);
});

test("フォワードデータが無ければ約定しない", () => {
  const trade = simulateTrade(input({ forwardBars: [] }));

  assert.equal(trade.filled, false);
  assert.equal(trade.noFillReason, "no_forward_data");
});

test("翌日以降に安値が損切りラインに達したら損切りラインで決済する", () => {
  const trade = simulateTrade(
    input({
      forwardBars: [bar("d1", 99.5, 101, 99, 100), bar("d2", 99, 100, 97.5, 98.5)]
    })
  );

  assert.equal(trade.exitReason, "stop");
  assert.equal(trade.exitPrice, 98);
  assert.equal(trade.exitDate, "d2");
});

test("損切りラインを下回って寄り付いたら寄り値で決済する（ギャップダウン）", () => {
  const trade = simulateTrade(
    input({
      forwardBars: [bar("d1", 99.5, 101, 99, 100), bar("d2", 96, 97, 95, 96.5)]
    })
  );

  assert.equal(trade.exitReason, "stop");
  assert.equal(trade.exitPrice, 96);
});

test("利確ラインを上回って寄り付いたら寄り値で決済する（ギャップアップ）", () => {
  const trade = simulateTrade(
    input({
      forwardBars: [bar("d1", 99.5, 101, 99, 100), bar("d2", 112, 113, 111, 112.5)]
    })
  );

  assert.equal(trade.exitReason, "take_profit");
  assert.equal(trade.exitPrice, 112);
});

test("同日に損切りと利確の両方が成立したら損切り扱いにする（保守的仮定）", () => {
  const trade = simulateTrade(
    input({
      forwardBars: [bar("d1", 99.5, 101, 99, 100), bar("d2", 105, 111, 97, 108)]
    })
  );

  assert.equal(trade.exitReason, "stop");
  assert.equal(trade.exitPrice, 98);
});

test("maxHoldDays経過でその日の終値で決済する", () => {
  const trade = simulateTrade(
    input({
      forwardBars: [
        bar("d1", 99.5, 101, 99, 100),
        bar("d2", 100, 102, 99.5, 101),
        bar("d3", 101, 103, 100, 102)
      ],
      options: { maxHoldDays: 3, stopMode: "prev-day", shares: 100 }
    })
  );

  assert.equal(trade.exitReason, "timeout");
  assert.equal(trade.exitDate, "d3");
  assert.equal(trade.exitPrice, 102);
  assert.equal(trade.holdDays, 3);
});

test("トレンドフォロー: TP1タッチ後にMA5終値割れの日の終値で決済する。タッチ前のMA5割れでは決済しない", () => {
  const trade = simulateTrade(
    input({
      signal: {
        entryPrice: 100,
        entryUpperPrice: 101.5,
        takeProfit1: 110,
        stopLossSignal: 97,
        exitMode: "trend_follow_exit"
      },
      forwardBars: [
        // d1: MA5(=99.8)を終値99で割るが、TP1未タッチなので決済しない
        bar("d1", 99.5, 100.5, 99, 99),
        // d2: TP1タッチ。終値108 > MA5(101.4)なので保有継続
        bar("d2", 100, 111, 99.5, 108),
        // d3: 終値100 < MA5(101.4)なので決済
        bar("d3", 108, 109, 106, 100)
      ]
    })
  );

  assert.equal(trade.exitReason, "ma5_trail");
  assert.equal(trade.exitDate, "d3");
  assert.equal(trade.exitPrice, 100);
  assert.equal(trade.holdDays, 3);
});

test("トレンドフォロー: TP1タッチ後でも損切りライン到達なら損切りで決済する", () => {
  const trade = simulateTrade(
    input({
      signal: {
        entryPrice: 100,
        entryUpperPrice: 101.5,
        takeProfit1: 110,
        stopLossSignal: 97,
        exitMode: "trend_follow_exit"
      },
      forwardBars: [
        bar("d1", 99.5, 101, 99, 100.5),
        bar("d2", 101, 111, 100.5, 109),
        bar("d3", 105, 106, 97.5, 105)
      ]
    })
  );

  assert.equal(trade.exitReason, "stop");
  assert.equal(trade.exitPrice, 98);
});

test("トレンドフォロー: maxHoldDaysは適用せずデータが尽きたら最終終値で決済する", () => {
  const trade = simulateTrade(
    input({
      signal: {
        entryPrice: 100,
        entryUpperPrice: 101.5,
        takeProfit1: 110,
        stopLossSignal: 97,
        exitMode: "trend_follow_exit"
      },
      forwardBars: [
        bar("d1", 99.5, 101, 99, 100.5),
        bar("d2", 100, 102, 99.5, 101.5),
        bar("d3", 101, 103, 100.5, 102.5)
      ],
      options: { maxHoldDays: 2, stopMode: "prev-day", shares: 100 }
    })
  );

  assert.equal(trade.exitReason, "timeout");
  assert.equal(trade.exitDate, "d3");
  assert.equal(trade.exitPrice, 102.5);
});

test("stopMode=signalでは評価時のstopLoss（シグナル日前日安値）を使う", () => {
  const trade = simulateTrade(
    input({
      forwardBars: [bar("d1", 99.5, 101, 99, 100), bar("d2", 99, 100, 96.9, 97.5)],
      options: { maxHoldDays: 30, stopMode: "signal", shares: 100 }
    })
  );

  assert.equal(trade.stopUsed, 97);
  assert.equal(trade.exitReason, "stop");
  assert.equal(trade.exitPrice, 97);
  assert.ok(Math.abs(trade.rMultiple! - (97 - 99.5) / (99.5 - 97)) < 1e-9);
  assert.equal(trade.pnlYen, (97 - 99.5) * 100);
});
