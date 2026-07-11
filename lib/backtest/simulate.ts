import { ExitMode, PriceRow } from "../types";

export type StopMode = "prev-day" | "signal";

export type NoFillReason =
  | "gap_below_stop"
  | "never_reached_limit"
  | "no_forward_data"
  | "stop_at_or_above_entry"
  /** riskサイジング時、エントリー時点の損切り幅では1単元すら予算内に収まらない(エンジン側で判定) */
  | "risk_over_budget";

export type ExitReason = "stop" | "take_profit" | "ma5_trail" | "timeout";

export interface SimulationSignal {
  entryPrice: number;
  entryUpperPrice: number;
  takeProfit1: number;
  /** 評価時の stopLoss = シグナル日前日の安値 low(D-1) */
  stopLossSignal: number;
  exitMode: ExitMode;
}

export interface SimulationOptions {
  maxHoldDays: number;
  stopMode: StopMode;
  shares: number;
}

export interface SimulationInput {
  signal: SimulationSignal;
  /** シグナル日Dの安値。stopMode="prev-day" では翌日エントリー時の「前日安値」= これを損切りに使う */
  signalDayLow: number;
  /** シグナル日の翌営業日以降の日足（昇順） */
  forwardBars: PriceRow[];
  /** シグナル日以前の終値（昇順）。トレンドフォロー時のMA5計算に使う */
  closesUpToSignal: number[];
  options: SimulationOptions;
}

export interface SimulatedTrade {
  filled: boolean;
  noFillReason?: NoFillReason;
  entryDate?: string;
  entryFillPrice?: number;
  exitDate?: string;
  exitPrice?: number;
  exitReason?: ExitReason;
  holdDays?: number;
  pnlYen?: number;
  rMultiple?: number;
  stopUsed: number;
}

const MA_TRAIL_WINDOW = 5;

export function simulateTrade(input: SimulationInput): SimulatedTrade {
  const { signal, signalDayLow, forwardBars, closesUpToSignal, options } = input;
  const stopUsed = options.stopMode === "prev-day" ? signalDayLow : signal.stopLossSignal;

  if (forwardBars.length === 0) {
    return { filled: false, noFillReason: "no_forward_data", stopUsed };
  }

  // 損切りラインが買い基準価格以上 = エントリーした瞬間にシナリオ崩壊する縮退ケース。
  // 実運用でもツールが stop_loss_above_entry を表示するため入らない前提とする。
  if (signal.entryPrice <= stopUsed) {
    return { filled: false, noFillReason: "stop_at_or_above_entry", stopUsed };
  }

  const entryBar = forwardBars[0];

  // 約定判定（BUY_ACTION準拠: 基準価格以下なら成行、基準価格まで下げてきたら指値、追いかけない）
  let entryFillPrice: number;
  if (entryBar.open <= stopUsed) {
    return { filled: false, noFillReason: "gap_below_stop", stopUsed };
  } else if (entryBar.open <= signal.entryPrice) {
    entryFillPrice = entryBar.open;
  } else if (entryBar.low <= signal.entryPrice) {
    entryFillPrice = signal.entryPrice;
  } else {
    return { filled: false, noFillReason: "never_reached_limit", stopUsed };
  }

  const exit = resolveExit(signal, stopUsed, forwardBars, closesUpToSignal, options);

  const pnlYen = (exit.exitPrice - entryFillPrice) * options.shares;
  const rMultiple = (exit.exitPrice - entryFillPrice) / (entryFillPrice - stopUsed);

  return {
    filled: true,
    entryDate: entryBar.date,
    entryFillPrice,
    exitDate: exit.exitDate,
    exitPrice: exit.exitPrice,
    exitReason: exit.exitReason,
    holdDays: exit.holdDays,
    pnlYen,
    rMultiple,
    stopUsed
  };
}

interface ExitResult {
  exitDate: string;
  exitPrice: number;
  exitReason: ExitReason;
  holdDays: number;
}

function resolveExit(
  signal: SimulationSignal,
  stopUsed: number,
  forwardBars: PriceRow[],
  closesUpToSignal: number[],
  options: SimulationOptions
): ExitResult {
  const closes = [...closesUpToSignal];
  let tpTouched = false;

  for (let index = 0; index < forwardBars.length; index += 1) {
    const bar = forwardBars[index];
    const holdDays = index + 1;

    // 同一日に損切りと利確の両方が成立し得る場合は損切りを優先（日足では順序不明のため保守側に倒す）
    if (bar.low <= stopUsed) {
      return { exitDate: bar.date, exitPrice: Math.min(bar.open, stopUsed), exitReason: "stop", holdDays };
    }

    if (signal.exitMode === "target_exit") {
      if (bar.high >= signal.takeProfit1) {
        return {
          exitDate: bar.date,
          exitPrice: Math.max(bar.open, signal.takeProfit1),
          exitReason: "take_profit",
          holdDays
        };
      }

      if (holdDays >= options.maxHoldDays) {
        return { exitDate: bar.date, exitPrice: bar.close, exitReason: "timeout", holdDays };
      }
    } else {
      // trend_follow_exit: TP1タッチまでは損切りのみ。タッチ以降は5日線終値割れで決済
      if (!tpTouched && bar.high >= signal.takeProfit1) {
        tpTouched = true;
      }

      closes.push(bar.close);

      if (tpTouched && closes.length >= MA_TRAIL_WINDOW) {
        const ma5 = averageOfLast(closes, MA_TRAIL_WINDOW);
        if (bar.close < ma5) {
          return { exitDate: bar.date, exitPrice: bar.close, exitReason: "ma5_trail", holdDays };
        }
      }
    }
  }

  // データが尽きた場合は最終バーの終値で決済
  const lastBar = forwardBars[forwardBars.length - 1];
  return { exitDate: lastBar.date, exitPrice: lastBar.close, exitReason: "timeout", holdDays: forwardBars.length };
}

function averageOfLast(values: number[], window: number): number {
  let total = 0;
  for (let index = values.length - window; index < values.length; index += 1) {
    total += values[index];
  }

  return total / window;
}
