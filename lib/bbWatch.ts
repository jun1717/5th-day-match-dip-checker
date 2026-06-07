import { bollingerBandsAt, bollingerLineValue, BollingerBands } from "./bollinger";
import { deviation, trendFrom } from "./indicators";
import {
  BbLineStats,
  BbReason,
  BbWatchResult,
  BbWatchStatus,
  BollingerLine,
  CurrentLine,
  PreferredLine,
  PriceRow,
  Rules,
  ThemeScore,
  Trend,
  WatchlistRow
} from "./types";

const BB_LINES: BollingerLine[] = ["ma25", "bb_minus_1sigma", "bb_minus_2sigma"];

export function analyzeBbWatch(
  watchlist: WatchlistRow[],
  prices: PriceRow[],
  themeScores: ThemeScore[],
  rules: Rules
): BbWatchResult[] {
  const pricesByCode = groupPricesByCode(prices);
  const themeScoreByTheme = new Map(themeScores.map((theme) => [theme.theme, theme.themeScore]));

  return watchlist
    .map((stock) =>
      analyzeStock(stock, pricesByCode.get(stock.code) ?? [], themeScoreByTheme.get(stock.theme) ?? 0, rules)
    )
    .sort(sortBbWatchResults);
}

function groupPricesByCode(prices: PriceRow[]): Map<string, PriceRow[]> {
  const grouped = new Map<string, PriceRow[]>();

  for (const price of prices) {
    const rows = grouped.get(price.code) ?? [];
    rows.push(price);
    grouped.set(price.code, rows);
  }

  for (const rows of grouped.values()) {
    rows.sort((a, b) => a.date.localeCompare(b.date));
  }

  return grouped;
}

function analyzeStock(stock: WatchlistRow, priceRows: PriceRow[], themeScoreValue: number, rules: Rules): BbWatchResult {
  const period = rules.bollingerPeriod;

  if (priceRows.length < period) {
    return insufficientResult(stock, themeScoreValue);
  }

  const closes = priceRows.map((row) => row.close);
  const lows = priceRows.map((row) => row.low);
  const latestIndex = priceRows.length - 1;
  const latest = priceRows[latestIndex];

  const latestBands = bollingerBandsAt(closes, latestIndex, period);
  const previousBands = bollingerBandsAt(closes, latestIndex - 1, period);
  const ma25Trend = trendFrom(latestBands.ma, previousBands.ma, rules.trendFlatTolerance);

  const lineStats = BB_LINES.map((line) => computeLineStats(priceRows, closes, lows, line, period, rules));
  const lineStatsByLine = new Map(lineStats.map((stats) => [stats.line, stats]));

  const preferredLine = computePreferredLine(lineStats, rules);
  const currentLine = computeCurrentLine(latest, latestBands, rules);
  const bbWatchStatus = computeBbWatchStatus(currentLine, preferredLine, lineStatsByLine, themeScoreValue, ma25Trend, rules);
  const reasons = reasonsFor(currentLine, preferredLine, lineStatsByLine, themeScoreValue, ma25Trend, rules);
  const preferredStats = preferredLine === "insufficient_history" ? undefined : lineStatsByLine.get(preferredLine);

  return {
    watchlistKey: stock.watchlistKey,
    code: stock.code,
    name: stock.name,
    sector: stock.sector,
    theme: stock.theme,
    isLeader: stock.isLeader,
    watchPriority: stock.watchPriority,
    themeScore: themeScoreValue,
    date: latest.date,
    close: latest.close,
    low: latest.low,
    ma25: latestBands.ma,
    stdDev25: latestBands.stdDev,
    bbUpper1: latestBands.upper1,
    bbUpper2: latestBands.upper2,
    bbLower1: latestBands.lower1,
    bbLower2: latestBands.lower2,
    ma25Deviation: deviation(latest.close, latestBands.ma),
    bbUpper1Deviation: deviation(latest.close, latestBands.upper1),
    bbUpper2Deviation: deviation(latest.close, latestBands.upper2),
    bbLower1Deviation: deviation(latest.close, latestBands.lower1),
    bbLower2Deviation: deviation(latest.close, latestBands.lower2),
    ma25Trend,
    lineStats,
    preferredLine,
    currentLine,
    successRate: preferredStats?.successRate ?? 0,
    touchCount: preferredStats?.touchCount ?? 0,
    avgMaxReturn5d: preferredStats?.avgMaxReturn5d ?? 0,
    avgMaxDrawdown5d: preferredStats?.avgMaxDrawdown5d ?? 0,
    bbWatchStatus,
    reasons
  };
}

function computeLineStats(
  priceRows: PriceRow[],
  closes: number[],
  lows: number[],
  line: BollingerLine,
  period: number,
  rules: Rules
): BbLineStats {
  interface TouchOutcome {
    maxReturn5d: number;
    maxDrawdown5d: number;
    success: boolean;
    failure: boolean;
  }

  const touches: TouchOutcome[] = [];

  for (let index = period - 1; index < priceRows.length; index += 1) {
    const bands = bollingerBandsAt(closes, index, period);
    const lineValue = bollingerLineValue(bands, line);
    if (lineValue === null) continue;

    const touched = lows[index] <= lineValue * (1 + rules.bbTouchTolerance);
    if (!touched) continue;

    const lookaheadEnd = Math.min(index + rules.bbLookaheadDays, priceRows.length - 1);
    if (lookaheadEnd <= index) continue;

    const closeAtTouch = closes[index];
    let maxReturn5d = Number.NEGATIVE_INFINITY;
    let maxDrawdown5d = Number.POSITIVE_INFINITY;

    for (let lookIndex = index + 1; lookIndex <= lookaheadEnd; lookIndex += 1) {
      const change = (closes[lookIndex] - closeAtTouch) / closeAtTouch;
      maxReturn5d = Math.max(maxReturn5d, change);
      maxDrawdown5d = Math.min(maxDrawdown5d, change);
    }

    touches.push({
      maxReturn5d,
      maxDrawdown5d,
      success: maxReturn5d >= rules.bbSuccessReturnThreshold,
      failure: maxDrawdown5d <= rules.bbFailureReturnThreshold
    });
  }

  const touchCount = touches.length;
  const successCount = touches.filter((touch) => touch.success).length;
  const failureCount = touches.filter((touch) => touch.failure).length;

  return {
    line,
    touchCount,
    successCount,
    failureCount,
    successRate: touchCount > 0 ? successCount / touchCount : 0,
    avgMaxReturn5d: average(touches.map((touch) => touch.maxReturn5d)),
    avgMaxDrawdown5d: average(touches.map((touch) => touch.maxDrawdown5d))
  };
}

function computePreferredLine(lineStats: BbLineStats[], rules: Rules): PreferredLine {
  const eligible = lineStats.filter((stats) => stats.touchCount >= rules.bbMinTouchCount);
  if (eligible.length === 0) {
    return "insufficient_history";
  }

  const best = eligible.reduce((current, candidate) => {
    if (candidate.successRate > current.successRate) return candidate;
    if (candidate.successRate < current.successRate) return current;
    return candidate.avgMaxReturn5d > current.avgMaxReturn5d ? candidate : current;
  });

  return best.line;
}

function computeCurrentLine(latest: PriceRow, bands: BollingerBands, rules: Rules): CurrentLine {
  const candidates: Array<{ line: BollingerLine; value: number | null }> = [
    { line: "ma25", value: bands.ma },
    { line: "bb_minus_1sigma", value: bands.lower1 },
    { line: "bb_minus_2sigma", value: bands.lower2 }
  ];

  for (const candidate of candidates) {
    if (candidate.value === null) continue;
    if (isNear(latest.close, candidate.value, rules.bbNearTolerance) || isNear(latest.low, candidate.value, rules.bbNearTolerance)) {
      return candidate.line;
    }
  }

  return "not_near_pullback_line";
}

function isNear(price: number, line: number, tolerance: number): boolean {
  if (line === 0) return false;
  return Math.abs(price - line) / Math.abs(line) <= tolerance;
}

function computeBbWatchStatus(
  currentLine: CurrentLine,
  preferredLine: PreferredLine,
  lineStatsByLine: Map<BollingerLine, BbLineStats>,
  themeScoreValue: number,
  ma25Trend: Trend,
  rules: Rules
): BbWatchStatus {
  const nearAnyLine = currentLine !== "not_near_pullback_line";

  if (nearAnyLine && preferredLine !== "insufficient_history" && currentLine === preferredLine) {
    const stats = lineStatsByLine.get(preferredLine);
    const successRateGood = stats !== undefined && stats.successRate >= rules.bbTimingGoodSuccessRate;
    const themeGood = themeScoreValue >= rules.bbThemeScoreThreshold;
    const trendNotWeak = ma25Trend !== "down";

    if (successRateGood && themeGood && trendNotWeak) {
      return "timing_good";
    }
  }

  if (nearAnyLine) {
    return "watch";
  }

  if (preferredLine === "insufficient_history") {
    return "insufficient_history";
  }

  return "not_near";
}

function reasonsFor(
  currentLine: CurrentLine,
  preferredLine: PreferredLine,
  lineStatsByLine: Map<BollingerLine, BbLineStats>,
  themeScoreValue: number,
  ma25Trend: Trend,
  rules: Rules
): BbReason[] {
  const reasons: BbReason[] = [];

  if (currentLine === "not_near_pullback_line") {
    reasons.push(bbReason("not_near_pullback_line", "押し目ラインから遠い"));
  } else if (preferredLine !== "insufficient_history" && currentLine === preferredLine) {
    reasons.push(bbReason("near_preferred_line", "得意ラインに接近"));
  } else if (currentLine === "ma25") {
    reasons.push(bbReason("near_ma25", "MA25に接近"));
  } else if (currentLine === "bb_minus_1sigma") {
    reasons.push(bbReason("near_minus_1sigma", "-1σに接近"));
  } else {
    reasons.push(bbReason("near_minus_2sigma", "-2σに接近"));
  }

  if (preferredLine === "insufficient_history") {
    reasons.push(bbReason("insufficient_history", "過去接触回数が不足"));
  } else {
    const stats = lineStatsByLine.get(preferredLine);
    if (stats !== undefined) {
      if (stats.successRate >= rules.bbTimingGoodSuccessRate) {
        reasons.push(bbReason("success_rate_high", "反発成功率が高い"));
      } else {
        reasons.push(bbReason("success_rate_low", "反発成功率が低い"));
      }
    }
  }

  if (themeScoreValue < rules.bbThemeScoreThreshold) {
    reasons.push(bbReason("theme_weak", "テーマ資金が弱い"));
  }

  if (ma25Trend === "down") {
    reasons.push(bbReason("ma25_trend_weak", "25日線の方向が弱い"));
  }

  return reasons;
}

function bbReason(key: string, label: string): BbReason {
  return { key, label };
}

function average(values: number[]): number {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length === 0) {
    return 0;
  }

  return usable.reduce((total, value) => total + value, 0) / usable.length;
}

function emptyLineStats(): BbLineStats[] {
  return BB_LINES.map((line) => ({
    line,
    touchCount: 0,
    successCount: 0,
    failureCount: 0,
    successRate: 0,
    avgMaxReturn5d: 0,
    avgMaxDrawdown5d: 0
  }));
}

function insufficientResult(stock: WatchlistRow, themeScoreValue: number): BbWatchResult {
  return {
    watchlistKey: stock.watchlistKey,
    code: stock.code,
    name: stock.name,
    sector: stock.sector,
    theme: stock.theme,
    isLeader: stock.isLeader,
    watchPriority: stock.watchPriority,
    themeScore: themeScoreValue,
    date: null,
    close: null,
    low: null,
    ma25: null,
    stdDev25: null,
    bbUpper1: null,
    bbUpper2: null,
    bbLower1: null,
    bbLower2: null,
    ma25Deviation: null,
    bbUpper1Deviation: null,
    bbUpper2Deviation: null,
    bbLower1Deviation: null,
    bbLower2Deviation: null,
    ma25Trend: "unknown",
    lineStats: emptyLineStats(),
    preferredLine: "insufficient_history",
    currentLine: "not_near_pullback_line",
    successRate: 0,
    touchCount: 0,
    avgMaxReturn5d: 0,
    avgMaxDrawdown5d: 0,
    bbWatchStatus: "insufficient_history",
    reasons: [bbReason("insufficient_history", "過去接触回数が不足")]
  };
}

const BB_STATUS_ORDER: Record<BbWatchStatus, number> = {
  timing_good: 0,
  watch: 1,
  insufficient_history: 2,
  not_near: 3
};

function sortBbWatchResults(a: BbWatchResult, b: BbWatchResult): number {
  return (
    BB_STATUS_ORDER[a.bbWatchStatus] - BB_STATUS_ORDER[b.bbWatchStatus] ||
    b.themeScore - a.themeScore ||
    a.code.localeCompare(b.code) ||
    a.theme.localeCompare(b.theme, "ja")
  );
}
