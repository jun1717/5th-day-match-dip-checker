import { evaluateCandidates } from "../evaluator";
import { CandidateResult, CandidateStatus, ExitMode, PriceRow, Rules, WatchlistRow } from "../types";
import { SimulatedTrade, simulateTrade, StopMode } from "./simulate";

/** 本番の fetch_prices.py が period="1y" で取得することを再現するスライス幅（営業日） */
const LOOKBACK_ROWS = 252;
/** ウォームアップ: 年初来高値の定義が本番と揃う最初の日からバックテストを始める */
const DEFAULT_WARMUP_ROWS = LOOKBACK_ROWS;
/** 末尾はフォワードリターン20営業日分を確保できる日まで */
const DEFAULT_FORWARD_ROWS = 21;
/** トレンドフォローのMA5計算に渡す過去終値の本数 */
const TRAIL_CLOSES_LOOKBACK = 25;

export interface EngineOptions {
  from?: string;
  to?: string;
  maxHoldDays: number;
  stopMode: StopMode;
  statuses: CandidateStatus[];
}

export interface TradeRecord {
  signalDate: string;
  code: string;
  name: string;
  theme: string;
  status: CandidateStatus;
  individualScore: number;
  themeScore: number;
  exitMode: ExitMode;
  rewardR: number | null;
  trade: SimulatedTrade;
}

export interface CohortRecord {
  date: string;
  code: string;
  status: CandidateStatus;
  individualScore: number;
  themeScore: number;
  reasonKeys: string[];
  fwd5: number | null;
  fwd20: number | null;
}

export interface EngineResult {
  trades: TradeRecord[];
  cohorts: CohortRecord[];
  skippedOpenPosition: number;
  evaluatedDays: string[];
}

interface CodeSeries {
  rows: PriceRow[];
  dates: string[];
  closes: number[];
  /** 現在の評価日以前の最後の行のインデックス（該当なしは -1） */
  ptr: number;
}

export function runBacktest(
  watchlist: WatchlistRow[],
  prices: PriceRow[],
  rules: Rules,
  options: EngineOptions
): EngineResult {
  const seriesByCode = buildSeries(prices);
  const tradingDays = allTradingDays(prices);

  if (tradingDays.length === 0) {
    return { trades: [], cohorts: [], skippedOpenPosition: 0, evaluatedDays: [] };
  }

  const defaultFrom = tradingDays[Math.min(DEFAULT_WARMUP_ROWS, tradingDays.length - 1)];
  const defaultTo = tradingDays[Math.max(0, tradingDays.length - DEFAULT_FORWARD_ROWS)];
  const from = options.from ?? defaultFrom;
  const to = options.to ?? defaultTo;

  const trades: TradeRecord[] = [];
  const cohorts: CohortRecord[] = [];
  const openPositionUntil = new Map<string, string>(); // code -> exitDate
  let skippedOpenPosition = 0;
  const evaluatedDays: string[] = [];

  for (const day of tradingDays) {
    advancePointers(seriesByCode, day);

    if (day < from || day > to) {
      continue;
    }

    evaluatedDays.push(day);
    const slicedPrices = slicePricesUpTo(seriesByCode);
    const result = evaluateCandidates(watchlist, slicedPrices, rules, day);

    // その日に取引のあった銘柄の評価行だけを対象にする（date一致で判定）
    const todays = result.candidates.filter((candidate) => candidate.date === day);
    const deduped = dedupeByCode(todays);

    for (const candidate of deduped.values()) {
      const series = seriesByCode.get(candidate.code);
      if (series === undefined || series.ptr < 0) {
        continue;
      }

      cohorts.push(cohortRecord(candidate, series, day));

      if (!options.statuses.includes(candidate.status)) {
        continue;
      }

      if (
        candidate.entryPrice === null ||
        candidate.entryUpperPrice === null ||
        candidate.stopLoss === null ||
        candidate.takeProfit1 === null ||
        candidate.exitMode === null
      ) {
        continue;
      }

      const openUntil = openPositionUntil.get(candidate.code);
      if (openUntil !== undefined && openUntil >= day) {
        skippedOpenPosition += 1;
        continue;
      }

      const trade = simulateTrade({
        signal: {
          entryPrice: candidate.entryPrice,
          entryUpperPrice: candidate.entryUpperPrice,
          takeProfit1: candidate.takeProfit1,
          stopLossSignal: candidate.stopLoss,
          exitMode: candidate.exitMode
        },
        signalDayLow: series.rows[series.ptr].low,
        forwardBars: series.rows.slice(series.ptr + 1),
        closesUpToSignal: series.closes.slice(Math.max(0, series.ptr - TRAIL_CLOSES_LOOKBACK + 1), series.ptr + 1),
        options: { maxHoldDays: options.maxHoldDays, stopMode: options.stopMode, shares: rules.defaultShares }
      });

      if (trade.filled && trade.exitDate !== undefined) {
        openPositionUntil.set(candidate.code, trade.exitDate);
      }

      trades.push({
        signalDate: day,
        code: candidate.code,
        name: candidate.name,
        theme: candidate.theme,
        status: candidate.status,
        individualScore: candidate.individualScore,
        themeScore: candidate.themeScore,
        exitMode: candidate.exitMode,
        rewardR: candidate.rewardR,
        trade
      });
    }
  }

  return { trades, cohorts, skippedOpenPosition, evaluatedDays };
}

function buildSeries(prices: PriceRow[]): Map<string, CodeSeries> {
  const grouped = new Map<string, PriceRow[]>();
  for (const price of prices) {
    const rows = grouped.get(price.code) ?? [];
    rows.push(price);
    grouped.set(price.code, rows);
  }

  const series = new Map<string, CodeSeries>();
  for (const [code, rows] of grouped) {
    rows.sort((a, b) => a.date.localeCompare(b.date));
    series.set(code, {
      rows,
      dates: rows.map((row) => row.date),
      closes: rows.map((row) => row.close),
      ptr: -1
    });
  }

  return series;
}

function allTradingDays(prices: PriceRow[]): string[] {
  return Array.from(new Set(prices.map((price) => price.date))).sort();
}

function advancePointers(seriesByCode: Map<string, CodeSeries>, day: string): void {
  for (const series of seriesByCode.values()) {
    while (series.ptr + 1 < series.dates.length && series.dates[series.ptr + 1] <= day) {
      series.ptr += 1;
    }
  }
}

function slicePricesUpTo(seriesByCode: Map<string, CodeSeries>): PriceRow[] {
  const sliced: PriceRow[] = [];
  for (const series of seriesByCode.values()) {
    if (series.ptr < 0) {
      continue;
    }

    const start = Math.max(0, series.ptr - LOOKBACK_ROWS + 1);
    for (let index = start; index <= series.ptr; index += 1) {
      sliced.push(series.rows[index]);
    }
  }

  return sliced;
}

/** 同一銘柄が複数テーマに登録されている場合、themeScore最大（同点はindividualScore最大）の1行に絞る */
function dedupeByCode(candidates: CandidateResult[]): Map<string, CandidateResult> {
  const byCode = new Map<string, CandidateResult>();
  for (const candidate of candidates) {
    const existing = byCode.get(candidate.code);
    if (
      existing === undefined ||
      candidate.themeScore > existing.themeScore ||
      (candidate.themeScore === existing.themeScore && candidate.individualScore > existing.individualScore)
    ) {
      byCode.set(candidate.code, candidate);
    }
  }

  return byCode;
}

function cohortRecord(candidate: CandidateResult, series: CodeSeries, day: string): CohortRecord {
  return {
    date: day,
    code: candidate.code,
    status: candidate.status,
    individualScore: candidate.individualScore,
    themeScore: candidate.themeScore,
    reasonKeys: candidate.reasons.map((reason) => reason.key),
    fwd5: forwardReturn(series, 5),
    fwd20: forwardReturn(series, 20)
  };
}

function forwardReturn(series: CodeSeries, days: number): number | null {
  const base = series.closes[series.ptr];
  const future = series.closes[series.ptr + days];
  if (future === undefined || base === 0) {
    return null;
  }

  return (future - base) / base;
}
