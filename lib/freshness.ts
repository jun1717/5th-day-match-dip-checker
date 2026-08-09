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

/** 東証の大引け(JST)。この時刻の板寄せで終値が確定する */
const CLOSE_HOUR_JST = 15;
const CLOSE_MINUTE_JST = 30;
const CLOSE_MINUTES_OF_DAY = CLOSE_HOUR_JST * 60 + CLOSE_MINUTE_JST;

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

/** JSTの0時からの経過分 */
function jstMinutesOfDay(ms: number): number {
  const jst = new Date(ms + JST_OFFSET_MS);
  return jst.getUTCHours() * 60 + jst.getUTCMinutes();
}

/** その営業日の大引け(15:30 JST)のepoch ms */
function closeMsOf(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day, CLOSE_HOUR_JST - 9, CLOSE_MINUTE_JST);
}

/**
 * unconfirmed = 表示中のバーが場中の途中値 / stale = 自動更新が止まっている /
 * unknown = 取得時刻が読めず判定できない
 */
export type ConfirmedCloseReason = "unconfirmed" | "stale" | "unknown";

export interface ConfirmedCloseWarning {
  reason: ConfirmedCloseReason;
  /** 確定日足が期待される営業日 */
  decisionDay: string;
  /** 表示に使う(nullは取得時刻不明) */
  pricesAsOf: string | null;
  /** 表示に使う(nullは取得時刻不明) */
  pricesFetchedAt: string | null;
}

/**
 * W1: 確定前データ警告。警告不要なら null。
 *
 * 「終値が確定しているか」と「その確定終値が最新か」は別の失敗で、判定材料も別:
 *  - unconfirmed: pricesAsOf(取引所が公表する直近の終値時刻)の *時刻* が15:30 JST未満
 *    = まだ大引け前の気配 = 表示中のバーは場中の途中値。日付を見ないので祝日カレンダーが要らない。
 *  - stale: pricesFetchedAt(価格取得を実行した時刻)が「D の 15:30 JST」より前
 *    = 判断開始済み営業日 D の大引け後に自動更新が1度も走っていない。
 *
 * この分解で祝日(休場の平日)の誤警告が消える。前営業日の確定終値が最新なので unconfirmed に
 * 当たらず、cronは曜日指定(1-5)で祝日も走るため stale にも当たらない。
 * 逆に本当に更新が止まった場合は、pricesAsOf が前営業日の15:30のままでも stale で捕まる
 * (pricesAsOf だけでは祝日と区別できないため、fetchedAt が必要)。
 *
 * 境界: ちょうど15:30:00は確定扱い(>=)。null / パース不能は unknown として警告する。
 */
export function confirmedCloseWarning(
  pricesAsOf: string | null,
  pricesFetchedAt: string | null,
  nowMs: number
): ConfirmedCloseWarning | null {
  const decisionDay = latestDecisionDay(nowMs);
  const base = { decisionDay, pricesAsOf, pricesFetchedAt };

  const asOfMs = pricesAsOf === null ? Number.NaN : Date.parse(pricesAsOf);
  const fetchedAtMs = pricesFetchedAt === null ? Number.NaN : Date.parse(pricesFetchedAt);
  if (Number.isNaN(asOfMs) || Number.isNaN(fetchedAtMs)) {
    return { ...base, reason: "unknown" };
  }

  if (jstMinutesOfDay(asOfMs) < CLOSE_MINUTES_OF_DAY) {
    return { ...base, reason: "unconfirmed" };
  }

  if (fetchedAtMs < closeMsOf(decisionDay)) {
    return { ...base, reason: "stale" };
  }

  return null;
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
