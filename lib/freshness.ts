import { weekdaysBetween } from "./calendar";

/**
 * データ鮮度の判定純関数。現在時刻はepoch msで注入する(テスト容易性・クライアント/サーバー非依存)。
 * JSTはUTC+9固定(日本にDSTなし)。閲覧端末のタイムゾーン設定に依存しないよう、
 * 比較はすべてepoch msで行い、JSTの暦日・時刻は ms+9h の Date を getUTC* 系で読む。
 * 平日近似(祝日非考慮)は決算フィルターと同じ既存方針。
 */

const JST_OFFSET_MS = 9 * 3_600_000;
const MS_PER_DAY = 86_400_000;

/** 判断開始時刻(JST)。運用マニュアル「毎日の運用(平日夜 16:40以降)」に対応 */
const DECISION_HOUR_JST = 16;
const DECISION_MINUTE_JST = 40;

function isWeekday(jstDate: Date): boolean {
  const dow = jstDate.getUTCDay();
  return dow >= 1 && dow <= 5;
}

function formatIsoDate(jstDate: Date): string {
  const year = jstDate.getUTCFullYear();
  const month = String(jstDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jstDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 直近の「判断開始済み営業日」(YYYY-MM-DD、JST基準)。
 * now(JST)が平日Dの16:40以降ならD、それ以外(平日16:40前・土日)は直前の平日。
 */
export function latestDecisionDay(nowMs: number): string {
  let jst = new Date(nowMs + JST_OFFSET_MS);
  const afterDecisionTime =
    jst.getUTCHours() > DECISION_HOUR_JST ||
    (jst.getUTCHours() === DECISION_HOUR_JST && jst.getUTCMinutes() >= DECISION_MINUTE_JST);

  if (isWeekday(jst) && afterDecisionTime) {
    return formatIsoDate(jst);
  }

  // 1日ずつ遡り、最初の平日を返す(過去の平日は16:40を常に過ぎている)
  do {
    jst = new Date(jst.getTime() - MS_PER_DAY);
  } while (!isWeekday(jst));

  return formatIsoDate(jst);
}

export interface ConfirmedCloseWarning {
  /** 確定日足が期待される営業日 */
  decisionDay: string;
  /** 表示に使う(nullは取得時刻不明) */
  pricesAsOf: string | null;
}

/**
 * W1: 確定前データ警告。警告不要なら null。
 * D = latestDecisionDay(nowMs) とし、pricesAsOf が「D の 15:30:00 JST」以上なら確定済み(null)。
 * pricesAsOf が null / パース不能な場合は警告する。境界: ちょうど15:30:00は確定扱い(>=)。
 */
export function confirmedCloseWarning(pricesAsOf: string | null, nowMs: number): ConfirmedCloseWarning | null {
  const decisionDay = latestDecisionDay(nowMs);

  if (pricesAsOf !== null) {
    const asOfMs = Date.parse(pricesAsOf);
    if (!Number.isNaN(asOfMs)) {
      const [year, month, day] = decisionDay.split("-").map(Number);
      // Dの15:30 JST = Dの06:30 UTC
      const closeMs = Date.UTC(year, month - 1, day, 6, 30);
      if (asOfMs >= closeMs) {
        return null;
      }
    }
  }

  return { decisionDay, pricesAsOf };
}

export interface SnapshotLagWarning {
  /** null = スナップショットが1件も無い */
  latestSnapshotDate: string | null;
  /** weekdaysBetween(latestSnapshotDate, dataDate)。latestSnapshotDate=nullならnull */
  lagDays: number | null;
}

/**
 * W2: 履歴保存停止警告。警告不要なら null。
 * dataDate(評価に使った最新価格バーの日付)が null → null(データ欠損は別系統の問題)。
 * latestSnapshotDate が null → 警告(lagDays: null)。
 * それ以外 → lag = weekdaysBetween(latestSnapshotDate, dataDate)。lag >= 2 で警告。
 * (場中ビルドでは最新スナップショット=前営業日分が正常=遅れ1のため、しきい値は2営業日)
 */
export function snapshotLagWarning(latestSnapshotDate: string | null, dataDate: string | null): SnapshotLagWarning | null {
  if (dataDate === null) {
    return null;
  }

  if (latestSnapshotDate === null) {
    return { latestSnapshotDate: null, lagDays: null };
  }

  const lagDays = weekdaysBetween(latestSnapshotDate, dataDate);
  if (lagDays < 2) {
    return null;
  }

  return { latestSnapshotDate, lagDays };
}
