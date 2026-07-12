import { SimulatedTrade, simulateTrade, StopMode } from "./backtest/simulate";
import { ExecutionRow } from "./csv";
import { SignalSnapshot, SlimCandidate } from "./snapshot";
import { PriceRow } from "./types";

/** トレンドフォローのMA5計算に渡す過去終値の本数(analyze_signals.tsと同じ) */
const TRAIL_CLOSES_LOOKBACK = 25;

export interface ClosedLot {
  code: string;
  shares: number;
  buyDate: string;
  buyPrice: number;
  sellDate: string;
  sellPrice: number;
  /** (売値 − 買値) × 株数。手数料・税は対象外(バックテストと整合) */
  pnlYen: number;
  buyMemo: string;
  sellMemo: string;
}

export interface OpenLot {
  code: string;
  shares: number;
  buyDate: string;
  buyPrice: number;
  buyMemo: string;
}

/**
 * 約定履歴をFIFOで往復(ロット)にペアリングする。売りはオープンな買いロットへ古い順に充当し、
 * ロットをまたぐ場合は株数で按分する。売り数量が保有を超えたらエラー(記録漏れの検出)。
 */
export function pairExecutions(rows: ExecutionRow[]): { closed: ClosedLot[]; open: OpenLot[] } {
  const byCode = new Map<string, ExecutionRow[]>();
  for (const row of rows) {
    const bucket = byCode.get(row.code) ?? [];
    bucket.push(row);
    byCode.set(row.code, bucket);
  }

  const closed: ClosedLot[] = [];
  const open: OpenLot[] = [];

  for (const [code, executions] of byCode) {
    const openLots: Array<{ shares: number; date: string; price: number; memo: string }> = [];

    for (const execution of executions) {
      if (execution.side === "buy") {
        openLots.push({ shares: execution.shares, date: execution.executedAt, price: execution.price, memo: execution.memo });
        continue;
      }

      let remaining = execution.shares;
      while (remaining > 0) {
        const head = openLots[0];
        if (head === undefined) {
          throw new Error(
            `code ${code}: ${execution.executedAt} の売り${execution.shares}株が保有株数を超えています(買いの記録漏れ?)`
          );
        }

        const take = Math.min(head.shares, remaining);
        closed.push({
          code,
          shares: take,
          buyDate: head.date,
          buyPrice: head.price,
          sellDate: execution.executedAt,
          sellPrice: execution.price,
          pnlYen: (execution.price - head.price) * take,
          buyMemo: head.memo,
          sellMemo: execution.memo
        });

        head.shares -= take;
        remaining -= take;
        if (head.shares === 0) {
          openLots.shift();
        }
      }
    }

    for (const lot of openLots) {
      open.push({ code, shares: lot.shares, buyDate: lot.date, buyPrice: lot.price, buyMemo: lot.memo });
    }
  }

  return { closed, open };
}

export interface SignalMatch {
  snapshotDate: string;
  /** codeがスナップショットに存在しない(=ウォッチリスト外)場合はnull。複数テーマ行はthemeScore最大の1行 */
  candidate: SlimCandidate | null;
  /** 前営業日のスナップショットが無く、買い当日のスナップショットでマッチした(場中判断とみなす) */
  sameDaySignal: boolean;
}

/**
 * 買い日の直前のスナップショットからcodeのシグナルを引く。
 * 優先: snapshotDate < buyDate の最新(lookbackDays暦日以内。連休を跨いでもD-1営業日が引けるように既定5日)。
 * 無ければ snapshotDate === buyDate を場中判断として採用する。どちらも無ければ null(=no_signal_data)。
 */
export function matchSignal(
  buyDate: string,
  code: string,
  snapshotsByDate: Map<string, SignalSnapshot>,
  lookbackDays: number
): SignalMatch | null {
  const minDate = isoDateAdd(buyDate, -lookbackDays);
  let chosenDate: string | null = null;
  for (const date of snapshotsByDate.keys()) {
    if (date < buyDate && date >= minDate && (chosenDate === null || date > chosenDate)) {
      chosenDate = date;
    }
  }

  let sameDaySignal = false;
  if (chosenDate === null && snapshotsByDate.has(buyDate)) {
    chosenDate = buyDate;
    sameDaySignal = true;
  }

  if (chosenDate === null) {
    return null;
  }

  const snapshot = snapshotsByDate.get(chosenDate)!;
  return { snapshotDate: chosenDate, candidate: dedupeByCode(snapshot.candidates, code), sameDaySignal };
}

/** 同一銘柄が複数テーマに登録されている場合、themeScore最大(同点はindividualScore最大)の1行に絞る(engine/analyze_signalsと同じ規則) */
function dedupeByCode(candidates: SlimCandidate[], code: string): SlimCandidate | null {
  let best: SlimCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate.code !== code) {
      continue;
    }

    if (
      best === null ||
      candidate.themeScore > best.themeScore ||
      (candidate.themeScore === best.themeScore && candidate.individualScore > best.individualScore)
    ) {
      best = candidate;
    }
  }

  return best;
}

function isoDateAdd(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export type ReviewFlag =
  | "no_signal_data"
  | "off_watchlist"
  | "not_buy_candidate"
  | "same_day_signal"
  | "chase_entry"
  | "over_sized"
  | "late_stop"
  | "holding_below_stop";

export interface ReviewOptions {
  /** シグナルを探す暦日数(既定5) */
  lookbackDays: number;
  /** late_stop判定の許容率(既定0.005 = 損切りラインの0.5%下まではセーフ) */
  stopTolerance: number;
  /** 仮想成績シミュレーションの設定(バックテスト既定と同じ) */
  maxHoldDays: number;
  stopMode: StopMode;
}

export const DEFAULT_REVIEW_OPTIONS: ReviewOptions = {
  lookbackDays: 5,
  stopTolerance: 0.005,
  maxHoldDays: 30,
  stopMode: "prev-day"
};

export interface LotReview {
  lot: ClosedLot;
  match: SignalMatch | null;
  flags: ReviewFlag[];
  /** (買値 − ツールの買い基準価格) ÷ 買い基準価格。正=基準より高く買った */
  entrySlippagePct: number | null;
  /** 保有営業日数(その銘柄の価格データで buyDate < date <= sellDate の本数)。価格データが無ければnull */
  holdDays: number | null;
  /** ツールに完全に従った場合の約定シミュレーション(株数=実際の株数)。計算不能ならnull */
  virtual: SimulatedTrade | null;
  /** 仮想損益。仮想が約定しなかった場合は0(=ツールに従えばトレードなし) */
  virtualPnlYen: number | null;
  /** 実現損益 − 仮想損益(執行の差)。仮想が計算できないときnull */
  executionGapYen: number | null;
}

export function reviewClosedLot(
  lot: ClosedLot,
  snapshotsByDate: Map<string, SignalSnapshot>,
  pricesByCode: Map<string, PriceRow[]>,
  options: ReviewOptions = DEFAULT_REVIEW_OPTIONS
): LotReview {
  const match = matchSignal(lot.buyDate, lot.code, snapshotsByDate, options.lookbackDays);
  const candidate = match?.candidate ?? null;
  const flags = entryFlags(lot.buyPrice, lot.shares, match);

  if (candidate?.stopLoss != null && lot.sellPrice < candidate.stopLoss * (1 - options.stopTolerance)) {
    flags.push("late_stop");
  }

  const rows = pricesByCode.get(lot.code);
  const holdDays =
    rows === undefined ? null : rows.filter((row) => row.date > lot.buyDate && row.date <= lot.sellDate).length;

  const virtual = simulateVirtual(lot.shares, match, rows, options);
  const virtualPnlYen = virtual === null ? null : virtual.filled ? (virtual.pnlYen ?? 0) : 0;

  return {
    lot,
    match,
    flags,
    entrySlippagePct:
      candidate?.entryPrice != null && candidate.entryPrice > 0
        ? (lot.buyPrice - candidate.entryPrice) / candidate.entryPrice
        : null,
    holdDays,
    virtual,
    virtualPnlYen,
    executionGapYen: virtualPnlYen === null ? null : lot.pnlYen - virtualPnlYen
  };
}

export interface OpenLotReview {
  lot: OpenLot;
  match: SignalMatch | null;
  flags: ReviewFlag[];
  lastClose: number | null;
  unrealizedPnlYen: number | null;
  stopLoss: number | null;
}

export function reviewOpenLot(
  lot: OpenLot,
  snapshotsByDate: Map<string, SignalSnapshot>,
  pricesByCode: Map<string, PriceRow[]>,
  options: ReviewOptions = DEFAULT_REVIEW_OPTIONS
): OpenLotReview {
  const match = matchSignal(lot.buyDate, lot.code, snapshotsByDate, options.lookbackDays);
  const candidate = match?.candidate ?? null;
  const flags = entryFlags(lot.buyPrice, lot.shares, match);

  const rows = pricesByCode.get(lot.code);
  const lastClose = rows !== undefined && rows.length > 0 ? rows[rows.length - 1].close : null;
  const stopLoss = candidate?.stopLoss ?? null;

  // 損切りライン割れを保有中 = ドクトリン違反の最重要警告
  if (lastClose !== null && stopLoss !== null && lastClose < stopLoss) {
    flags.push("holding_below_stop");
  }

  return {
    lot,
    match,
    flags,
    lastClose,
    unrealizedPnlYen: lastClose === null ? null : (lastClose - lot.buyPrice) * lot.shares,
    stopLoss
  };
}

/** エントリー側の逸脱フラグ(closed/open共通) */
function entryFlags(buyPrice: number, shares: number, match: SignalMatch | null): ReviewFlag[] {
  const flags: ReviewFlag[] = [];

  if (match === null) {
    flags.push("no_signal_data");
    return flags;
  }

  if (match.candidate === null) {
    flags.push("off_watchlist");
    return flags;
  }

  if (match.sameDaySignal) {
    flags.push("same_day_signal");
  }

  if (match.candidate.status !== "buy_candidate") {
    flags.push("not_buy_candidate");
  }

  if (match.candidate.entryUpperPrice != null && buyPrice > match.candidate.entryUpperPrice) {
    flags.push("chase_entry");
  }

  if (match.candidate.suggestedShares != null && match.candidate.suggestedShares > 0 && shares > match.candidate.suggestedShares) {
    flags.push("over_sized");
  }

  return flags;
}

/** マッチしたシグナルからanalyze_signalsと同じ手順でツール準拠の仮想トレードを再現する(株数=実際の株数) */
function simulateVirtual(
  shares: number,
  match: SignalMatch | null,
  rows: PriceRow[] | undefined,
  options: ReviewOptions
): SimulatedTrade | null {
  const candidate = match?.candidate ?? null;
  if (
    match === null ||
    candidate === null ||
    rows === undefined ||
    candidate.entryPrice === null ||
    candidate.entryUpperPrice === null ||
    candidate.stopLoss === null ||
    candidate.takeProfit1 === null ||
    candidate.exitMode === null
  ) {
    return null;
  }

  const index = rows.findIndex((row) => row.date === match.snapshotDate);
  if (index < 0) {
    return null;
  }

  const closes = rows.map((row) => row.close);
  return simulateTrade({
    signal: {
      entryPrice: candidate.entryPrice,
      entryUpperPrice: candidate.entryUpperPrice,
      takeProfit1: candidate.takeProfit1,
      stopLossSignal: candidate.stopLoss,
      exitMode: candidate.exitMode
    },
    signalDayLow: rows[index].low,
    forwardBars: rows.slice(index + 1),
    closesUpToSignal: closes.slice(Math.max(0, index - TRAIL_CLOSES_LOOKBACK + 1), index + 1),
    options: { maxHoldDays: options.maxHoldDays, stopMode: options.stopMode, shares }
  });
}

/** ルール逸脱とみなすフラグ(執行タイミング系のsame_day_signal/late_stopは別枠で数える) */
const RULE_VIOLATION_FLAGS: ReviewFlag[] = ["no_signal_data", "off_watchlist", "not_buy_candidate"];

export interface MonthlyReview {
  /** 決済月(sellDateのYYYY-MM)。実現損益が確定した月に帰属させる */
  month: string;
  closedLots: number;
  ruleCompliant: number;
  ruleViolations: number;
  avgEntrySlippagePct: number | null;
  actualPnlYen: number;
  /** 仮想成績が計算できたロット数とその合計(実現側も同じサブセットで差を取る) */
  virtualCoveredLots: number;
  virtualPnlYen: number | null;
  executionGapYen: number | null;
}

export function monthlyReviews(reviews: LotReview[]): MonthlyReview[] {
  const byMonth = new Map<string, LotReview[]>();
  for (const review of reviews) {
    const month = review.lot.sellDate.slice(0, 7);
    const bucket = byMonth.get(month) ?? [];
    bucket.push(review);
    byMonth.set(month, bucket);
  }

  return Array.from(byMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, group]) => {
      const violations = group.filter((review) => review.flags.some((flag) => RULE_VIOLATION_FLAGS.includes(flag)));
      const slippages = group
        .map((review) => review.entrySlippagePct)
        .filter((value): value is number => value !== null);
      const covered = group.filter((review) => review.virtualPnlYen !== null);
      const virtualPnlYen = covered.reduce((total, review) => total + (review.virtualPnlYen ?? 0), 0);
      const actualPnlCovered = covered.reduce((total, review) => total + review.lot.pnlYen, 0);

      return {
        month,
        closedLots: group.length,
        ruleCompliant: group.length - violations.length,
        ruleViolations: violations.length,
        avgEntrySlippagePct:
          slippages.length > 0 ? slippages.reduce((total, value) => total + value, 0) / slippages.length : null,
        actualPnlYen: group.reduce((total, review) => total + review.lot.pnlYen, 0),
        virtualCoveredLots: covered.length,
        virtualPnlYen: covered.length > 0 ? virtualPnlYen : null,
        executionGapYen: covered.length > 0 ? actualPnlCovered - virtualPnlYen : null
      };
    });
}
