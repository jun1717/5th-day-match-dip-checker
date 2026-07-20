import { weekdaysBetween } from "./calendar";
import { EarningsRow } from "./csv";
import { averageTrueRangeAt, deviation, max, movingAverageAt, rateOfChangeAt, trendFrom } from "./indicators";
import {
  percentileOf,
  relativeStrengthOf,
  scoreIndividual,
  scoreTheme,
  themeScoreComponentsOf,
  themeStatus
} from "./scoring";
import {
  CandidateResult,
  CandidateStatus,
  ExitMode,
  EvaluationOutput,
  MarketCondition,
  PriceRow,
  ProfitWarning,
  RuleReason,
  Rules,
  ThemeScore,
  WatchlistRow
} from "./types";

const BUY_ACTION =
  "今夜のうちに翌朝の注文をセット: 買い基準価格に指値、損切りライン（シグナル日の安値）に逆指値を同時に入れる。株数は画面の株数欄。買い上限価格を超えては追わない。翌朝、寄りが損切りライン以下で始まったら注文を取り消して見送り。指値に届かなければ諦める。";

type CandidateDraft = Omit<CandidateResult, "themeScore" | "themeRank" | "status" | "tomorrowAction" | "exitMode" | "profitWarnings"> & {
  conditions: {
    ma25TrendUp: boolean;
    closeAboveMa25: boolean;
    ma5DeviationInRange: boolean;
    ma5TrendUpOrFlat: boolean;
    yearHighDeviationInRange: boolean;
    expectedLossWithinLimit: boolean;
    stopNotTooTight: boolean;
    volumeDryUp: boolean;
    noEarningsSoon: boolean;
  };
};

export function evaluateCandidates(
  watchlist: WatchlistRow[],
  prices: PriceRow[],
  rules: Rules,
  generatedAt = new Date().toISOString(),
  earnings: EarningsRow[] = []
): EvaluationOutput {
  const pricesByCode = groupPricesByCode(prices);
  // 市場レジームは drafts 生成前に一度だけ計算する(全銘柄に等しくかかるマスタースイッチ)
  const market = marketConditionOf(pricesByCode, rules);
  const marketRegimeOk = market?.regimeOk ?? null;
  const earningsByCode = groupEarningsByCode(earnings);
  const drafts = watchlist.map((stock) =>
    evaluateStock(stock, pricesByCode.get(stock.code) ?? [], rules, earningsByCode.get(stock.code) ?? [])
  );
  const themeScores = evaluateThemes(drafts, rules);
  const themeByName = new Map(themeScores.map((theme) => [theme.theme, theme]));

  const candidates = drafts
    .map((draft) => {
      const theme = themeByName.get(draft.theme);
      const themeScoreValue = theme?.themeScore ?? 0;
      const status = classifyCandidate(draft, themeScoreValue, rules, marketRegimeOk);
      const reasons = reasonsForCandidate(draft, themeScoreValue, status, rules, market);
      const exitMode = exitModeFor(draft, themeScoreValue, rules);
      const profitWarnings = computeProfitWarnings(draft, themeScoreValue, theme, rules);
      const { conditions: _conditions, ...candidateDraft } = draft;

      return {
        ...candidateDraft,
        reasons,
        themeScore: themeScoreValue,
        themeRank: theme?.rank ?? null,
        status,
        tomorrowAction: actionForStatus(status),
        exitMode,
        profitWarnings
      };
    })
    .sort(sortCandidates);

  return {
    generatedAt,
    pricesAsOf: null,
    rules,
    candidates,
    themeScores,
    market
  };
}

/**
 * 市場レジーム指標(rules.marketIndexCode)の当日状態。行数不足・指標未取得なら null(不罰)。
 * regimeOk = 終値が25日線より上 かつ 25日線が上向き(trendFlatTolerance は個別銘柄と同じ定義)。
 */
function marketConditionOf(pricesByCode: Map<string, PriceRow[]>, rules: Rules): MarketCondition | null {
  const rows = pricesByCode.get(rules.marketIndexCode) ?? [];
  if (rows.length < rules.maMiddle + 1) {
    return null; // ma25 + 前日ma25(トレンド)に必要な行数
  }

  const latestIndex = rows.length - 1;
  const latest = rows[latestIndex];
  const closes = rows.map((row) => row.close);
  const ma25 = movingAverageAt(closes, latestIndex, rules.maMiddle);
  const prevMa25 = movingAverageAt(closes, latestIndex - 1, rules.maMiddle);
  const ma25Trend = trendFrom(ma25, prevMa25, rules.trendFlatTolerance);
  const ma25Deviation = deviation(latest.close, ma25);
  // "flat" は up ではない → 地合いOKは「明確に上向き」のときだけ
  const regimeOk = ma25 === null ? null : latest.close > ma25 && ma25Trend === "up";

  return {
    code: rules.marketIndexCode,
    date: latest.date,
    close: latest.close,
    ma25,
    ma25Deviation,
    ma25Trend,
    regimeOk
  };
}

/** code → 決算発表日(YYYY-MM-DD)の昇順配列。evaluateStock がその銘柄の直近未来日を引く */
function groupEarningsByCode(earnings: EarningsRow[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const row of earnings) {
    const dates = grouped.get(row.code) ?? [];
    dates.push(row.earningsDate);
    grouped.set(row.code, dates);
  }

  for (const dates of grouped.values()) {
    dates.sort((a, b) => a.localeCompare(b));
  }

  return grouped;
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

function evaluateStock(stock: WatchlistRow, prices: PriceRow[], rules: Rules, earningsDates: string[]): CandidateDraft {
  const minimumRows = Math.max(rules.maMiddle + 1, 26);
  if (prices.length < minimumRows) {
    return insufficientCandidate(stock, `価格データが不足しています（${prices.length}/${minimumRows}営業日）`, rules);
  }

  const latestIndex = prices.length - 1;
  const latest = prices[latestIndex];
  const previous = prices[latestIndex - 1];
  const closes = prices.map((row) => row.close);
  const highs = prices.map((row) => row.high);

  const ma5 = movingAverageAt(closes, latestIndex, rules.maShort);
  const prevMa5 = movingAverageAt(closes, latestIndex - 1, rules.maShort);
  const ma25 = movingAverageAt(closes, latestIndex, rules.maMiddle);
  const prevMa25 = movingAverageAt(closes, latestIndex - 1, rules.maMiddle);
  const yearHigh = max(highs);
  const ma5Deviation = deviation(latest.close, ma5);
  const ma25Deviation = deviation(latest.close, ma25);
  const yearHighDeviation = deviation(latest.close, yearHigh);
  const ma5Trend = trendFrom(ma5, prevMa5, rules.trendFlatTolerance);
  const ma25Trend = trendFrom(ma25, prevMa25, rules.trendFlatTolerance);
  const entryPrice = ma5 === null ? null : ma5 * (1 + rules.entryMaPremium);
  const entryUpperPrice = ma5 === null ? null : ma5 * (1 + rules.entryUpperPremium);
  const stopLoss = previous.low;
  const riskR = entryPrice !== null && stopLoss !== null && entryPrice > stopLoss ? entryPrice - stopLoss : null;
  const atr = averageTrueRangeAt(prices, latestIndex, rules.atrPeriod);
  const stopDistanceAtr = atr !== null && atr > 0 && riskR !== null ? riskR / atr : null;
  const volumes = prices.map((row) => row.volume);
  const volumeShortAvg = movingAverageAt(volumes, latestIndex, rules.volumeShortWindow);
  const volumeLongAvg = movingAverageAt(volumes, latestIndex, rules.volumeLongWindow);
  const volumeRatio =
    volumeShortAvg !== null && volumeLongAvg !== null && volumeLongAvg > 0 ? volumeShortAvg / volumeLongAvg : null;
  const suggestedShares = suggestedSharesFor(entryPrice, riskR, rules);
  const positionCost = entryPrice !== null && suggestedShares !== null ? entryPrice * suggestedShares : null;
  const expectedLoss = expectedLossFor(entryPrice, stopLoss, riskR, suggestedShares, rules);
  const recentHigh20 = max(highs.slice(-rules.recentHighLookback));
  const takeProfit1 = recentHigh20;
  const reward = takeProfit1 !== null && entryPrice !== null ? takeProfit1 - entryPrice : null;
  const rewardR = riskR !== null && riskR > 0 && reward !== null ? reward / riskR : null;

  // 翌朝注文用: 損切り=シグナル日安値(low(D))で株数・想定損失を再計算する。
  // バックテスト(stopMode="prev-day")のサイジングと同じ基準(lib/backtest/engine.ts参照)。
  // 判定(status/conditions)は従来どおり stopLoss=low(D-1) 基準のまま(検証済みロジックを変えない)
  const signalDayLow = latest.low;
  const orderRiskR = entryPrice !== null && entryPrice > signalDayLow ? entryPrice - signalDayLow : null;
  const orderShares = suggestedSharesFor(entryPrice, orderRiskR, rules);
  const orderPositionCost = entryPrice !== null && orderShares !== null ? entryPrice * orderShares : null;
  const orderExpectedLoss = orderRiskR === null ? null : expectedLossFor(entryPrice, signalDayLow, orderRiskR, orderShares, rules);
  const orderRewardR = orderRiskR !== null && orderRiskR > 0 && reward !== null ? reward / orderRiskR : null;

  // 決算接近: 基準日は必ず latest.date(バックテストの過去日評価で当時の未来決算を正しく効かせる)
  const nextEarningsDate = earningsDates.find((date) => date >= latest.date) ?? null;
  const daysToEarnings = nextEarningsDate === null ? null : weekdaysBetween(latest.date, nextEarningsDate);

  const conditions = {
    ma25TrendUp: ma25Trend === "up",
    closeAboveMa25: ma25 !== null && latest.close > ma25,
    ma5DeviationInRange:
      ma5Deviation !== null &&
      ma5Deviation >= rules.ma5DeviationMin &&
      ma5Deviation <= rules.ma5DeviationMax,
    ma5TrendUpOrFlat: ma5Trend === "up" || ma5Trend === "flat",
    yearHighDeviationInRange:
      yearHighDeviation !== null &&
      yearHighDeviation >= rules.yearHighDeviationMin &&
      yearHighDeviation <= rules.yearHighDeviationMax,
    expectedLossWithinLimit: expectedLoss !== null && expectedLoss > 0 && expectedLoss <= rules.maxLossYen,
    // 測定不能(null)は罰しない。フラグ・除外は明確な違反時のみ
    stopNotTooTight: stopDistanceAtr === null || stopDistanceAtr >= rules.stopAtrMinMultiple,
    volumeDryUp: volumeRatio === null || volumeRatio <= rules.volumeDryUpMaxRatio,
    // 決算未登録(daysToEarnings=null)は罰しない。daysToEarnings=0(評価日=発表日)も除外窓に含む
    noEarningsSoon: daysToEarnings === null || daysToEarnings > rules.earningsExclusionDays
  };

  const individualScore = scoreIndividual(
    conditions,
    rules
  );

  return {
    watchlistKey: stock.watchlistKey,
    code: stock.code,
    name: stock.name,
    sector: stock.sector,
    theme: stock.theme,
    isLeader: stock.isLeader,
    watchPriority: stock.watchPriority,
    date: latest.date,
    close: latest.close,
    volume: latest.volume,
    ma5,
    ma25,
    ma5Slope: ma5 !== null && prevMa5 !== null ? ma5 - prevMa5 : null,
    ma25Slope: ma25 !== null && prevMa25 !== null ? ma25 - prevMa25 : null,
    ma5Deviation,
    ma25Deviation,
    ma5Trend,
    ma25Trend,
    yearHigh,
    yearHighDeviation,
    previousLow: previous.low,
    return5d: rateOfChangeAt(closes, latestIndex, 5),
    return20d: rateOfChangeAt(closes, latestIndex, 20),
    atr,
    stopDistanceAtr,
    volumeShortAvg,
    volumeLongAvg,
    volumeRatio,
    nextEarningsDate,
    daysToEarnings,
    individualScore,
    entryPrice,
    entryUpperPrice,
    stopLoss,
    signalDayLow,
    suggestedShares,
    positionCost,
    expectedLoss,
    orderShares,
    orderPositionCost,
    orderExpectedLoss,
    orderRewardR,
    recentHigh20,
    takeProfit1,
    riskR,
    reward,
    rewardR,
    reasons: [],
    orderChecklist: orderChecklistFor(rules),
    conditions
  };
}

/**
 * リスクベース建玉: リスク許容額(と任意の投入額上限)から株数を逆算する。
 * lotSize=100・maxPositionYen=null では「(entry-stop)×100株 ≤ maxLossYen」と同値になり、
 * fixedモードと候補の選別結果が一致する(パリティ。tests/evaluator.test.tsで保証)。
 */
export function suggestedSharesFor(entryPrice: number | null, riskR: number | null, rules: Rules): number | null {
  if (rules.sizingMode === "fixed") {
    return rules.defaultShares;
  }

  if (entryPrice === null || riskR === null || riskR <= 0) {
    return null;
  }

  let raw = rules.maxLossYen / riskR;
  if (rules.maxPositionYen !== null) {
    raw = Math.min(raw, rules.maxPositionYen / entryPrice);
  }

  return rules.allowFractionalShares ? Math.floor(raw) : Math.floor(raw / rules.lotSize) * rules.lotSize;
}

/** riskモードは推奨株数での損失額(株数0なら0=条件未達)。fixedモードは従来どおりdefaultShares固定 */
export function expectedLossFor(
  entryPrice: number | null,
  stopLoss: number,
  riskR: number | null,
  suggestedShares: number | null,
  rules: Rules
): number | null {
  if (rules.sizingMode === "fixed") {
    return entryPrice === null ? null : Math.max(0, (entryPrice - stopLoss) * rules.defaultShares);
  }

  if (riskR === null || suggestedShares === null) {
    return null;
  }

  return riskR * suggestedShares;
}

function insufficientCandidate(stock: WatchlistRow, detail: string, rules: Rules): CandidateDraft {
  return {
    watchlistKey: stock.watchlistKey,
    code: stock.code,
    name: stock.name,
    sector: stock.sector,
    theme: stock.theme,
    isLeader: stock.isLeader,
    watchPriority: stock.watchPriority,
    date: null,
    close: null,
    volume: null,
    ma5: null,
    ma25: null,
    ma5Slope: null,
    ma25Slope: null,
    ma5Deviation: null,
    ma25Deviation: null,
    ma5Trend: "unknown",
    ma25Trend: "unknown",
    yearHigh: null,
    yearHighDeviation: null,
    previousLow: null,
    return5d: null,
    return20d: null,
    atr: null,
    stopDistanceAtr: null,
    volumeShortAvg: null,
    volumeLongAvg: null,
    volumeRatio: null,
    nextEarningsDate: null,
    daysToEarnings: null,
    individualScore: 0,
    entryPrice: null,
    entryUpperPrice: null,
    stopLoss: null,
    signalDayLow: null,
    suggestedShares: null,
    positionCost: null,
    expectedLoss: null,
    orderShares: null,
    orderPositionCost: null,
    orderExpectedLoss: null,
    orderRewardR: null,
    recentHigh20: null,
    takeProfit1: null,
    riskR: null,
    reward: null,
    rewardR: null,
    reasons: [reason("missing_price_data", "株価データが不足", false, detail)],
    orderChecklist: orderChecklistFor(rules),
    conditions: {
      ma25TrendUp: false,
      closeAboveMa25: false,
      ma5DeviationInRange: false,
      ma5TrendUpOrFlat: false,
      yearHighDeviationInRange: false,
      expectedLossWithinLimit: false,
      // 測定不能は罰しない(null→true と同じ扱い)
      stopNotTooTight: true,
      volumeDryUp: true,
      noEarningsSoon: true
    }
  };
}

function evaluateThemes(drafts: CandidateDraft[], rules: Rules): ThemeScore[] {
  const grouped = new Map<string, CandidateDraft[]>();
  for (const draft of drafts) {
    const rows = grouped.get(draft.theme) ?? [];
    rows.push(draft);
    grouped.set(draft.theme, rows);
  }

  const baseThemes = Array.from(grouped.entries()).map(([theme, rows]) => {
    const evaluable = rows.filter((row) => row.close !== null);
    const leaderRows = rows.filter((row) => row.isLeader && row.close !== null);
    const leaderUniverse = leaderRows.length > 0 ? leaderRows : evaluable;

    return {
      theme,
      rows,
      priority: bestPriority(rows.map((row) => row.watchPriority)),
      return5d: average(evaluable.map((row) => row.return5d)),
      return20d: average(evaluable.map((row) => row.return20d)),
      leaderMa5AboveRatio: ratio(
        leaderUniverse.filter((row) => row.close !== null && row.ma5 !== null && row.close > row.ma5).length,
        leaderUniverse.length
      ),
      leaderMa25AboveRatio: ratio(
        leaderUniverse.filter((row) => row.close !== null && row.ma25 !== null && row.close > row.ma25).length,
        leaderUniverse.length
      ),
      stockCount: rows.length,
      leaderCount: leaderUniverse.length
    };
  });

  const return5ds = baseThemes.map((theme) => theme.return5d);
  const return20ds = baseThemes.map((theme) => theme.return20d);
  const withPercentiles = baseThemes.map((theme) => ({
    ...theme,
    percentile5d: percentileOf(theme.return5d, return5ds),
    percentile20d: percentileOf(theme.return20d, return20ds)
  }));

  // 順位: binaryは現行どおりreturn5d降順(完全互換)。
  // continuousは5日/20日パーセンタイルをブレンドした相対強度の降順(タイはテーマ名で安定化)。
  const ranked = withPercentiles
    .slice()
    .sort((a, b) =>
      rules.themeScoringMode === "continuous"
        ? relativeStrengthOf(b, rules) - relativeStrengthOf(a, rules) || a.theme.localeCompare(b.theme, "ja")
        : b.return5d - a.return5d
    )
    .map((theme, index) => ({ ...theme, rank: index + 1 }));

  const totalThemes = ranked.length;
  return ranked.map((theme) => {
    const scoreInput = {
      rank: theme.rank,
      totalThemes,
      leaderMa5AboveRatio: theme.leaderMa5AboveRatio,
      leaderMa25AboveRatio: theme.leaderMa25AboveRatio,
      return5d: theme.return5d,
      return20d: theme.return20d,
      percentile5d: theme.percentile5d,
      percentile20d: theme.percentile20d
    };
    const themeScoreValue = scoreTheme(scoreInput, rules);

    return {
      theme: theme.theme,
      priority: theme.priority,
      rank: theme.rank,
      return5d: theme.return5d,
      return20d: theme.return20d,
      themeScore: themeScoreValue,
      leaderMa5AboveRatio: theme.leaderMa5AboveRatio,
      leaderMa25AboveRatio: theme.leaderMa25AboveRatio,
      status: themeStatus(themeScoreValue, rules),
      stockCount: theme.stockCount,
      leaderCount: theme.leaderCount,
      scoreComponents: themeScoreComponentsOf(scoreInput, rules)
    } satisfies ThemeScore;
  });
}

function average(values: Array<number | null>): number {
  const usable = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (usable.length === 0) {
    return 0;
  }

  return usable.reduce((total, value) => total + value, 0) / usable.length;
}

function ratio(count: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return count / total;
}

function bestPriority(priorities: string[]): string {
  return priorities.slice().sort((a, b) => priorityRank(a) - priorityRank(b) || a.localeCompare(b, "ja"))[0] ?? "C";
}

function priorityRank(priority: string): number {
  const ranks: Record<string, number> = { A: 0, B: 1, C: 2 };
  return ranks[priority] ?? 99;
}

function reasonsForCandidate(
  draft: CandidateDraft,
  themeScoreValue: number,
  status: CandidateStatus,
  rules: Rules,
  market: MarketCondition | null
): RuleReason[] {
  const reasons = [...draft.reasons];

  if (draft.close === null) {
    return reasons;
  }

  const qualityFlags = qualityFlagReasons(draft, rules, market);

  if (status === "buy_candidate") {
    return [
      reason("buy_setup_ready", "買い候補条件を満たしている", true, "個別スコアとテーマ資金スコアが買い基準以上"),
      ...qualityFlags
    ];
  }

  if (draft.ma25Trend === "down") {
    reasons.push(reason("ma25_trend_down", "25日線が下向き", false, `25日線トレンド: ${draft.ma25Trend}`));
  }

  if (draft.ma25 !== null && draft.close < draft.ma25) {
    reasons.push(
      reason(
        "ma25_broken",
        "25日線を下回っている",
        false,
        `終値 ${draft.close.toFixed(0)} / 25日線 ${draft.ma25.toFixed(1)}`
      )
    );
  }

  if (draft.ma5Deviation !== null && draft.ma5Deviation > rules.ma5DeviationMax) {
    reasons.push(
      reason("ma5_too_far_above", "5日線から遠い", false, `5日線乖離 ${(draft.ma5Deviation * 100).toFixed(2)}%`)
    );
  }

  if (draft.close !== null && draft.entryUpperPrice !== null && draft.close > draft.entryUpperPrice) {
    reasons.push(
      reason(
        "entry_upper_exceeded",
        "買い上限価格を超えている",
        false,
        `終値 ${draft.close.toFixed(0)} / 上限 ${draft.entryUpperPrice.toFixed(0)}`
      )
    );
  }

  if (
    draft.ma5Deviation !== null &&
    draft.ma5Deviation < rules.ma5DeviationMin &&
    draft.ma25 !== null &&
    draft.close > draft.ma25
  ) {
    reasons.push(
      reason(
        "ma25_pullback_type",
        "5日線ではなく25日線押し目型",
        false,
        `5日線乖離 ${(draft.ma5Deviation * 100).toFixed(2)}%`
      )
    );
  }

  if (draft.yearHighDeviation !== null && draft.yearHighDeviation > rules.yearHighDeviationMax) {
    reasons.push(
      reason(
        "breakout_type",
        "押し目ではなく高値ブレイク型",
        false,
        `年初来高値乖離 ${(draft.yearHighDeviation * 100).toFixed(2)}%`
      )
    );
  }

  if (draft.stopLoss !== null && draft.entryPrice !== null && draft.stopLoss >= draft.entryPrice) {
    reasons.push(
      reason(
        "stop_loss_above_entry",
        "損切りラインが買い基準価格以上",
        false,
        `損切り ${draft.stopLoss.toFixed(0)} / 買い基準 ${draft.entryPrice.toFixed(0)}`
      )
    );
  }

  if (draft.expectedLoss !== null && draft.expectedLoss > rules.maxLossYen) {
    reasons.push(
      reason(
        "expected_loss_too_large",
        "想定損失が大きすぎる",
        false,
        `${draft.expectedLoss.toFixed(0)}円 / 上限 ${rules.maxLossYen.toLocaleString("ja-JP")}円`
      )
    );
  }

  // riskモードでは株数0(=最低単位でも制約超過)が「想定損失が大きすぎる」に相当する
  if (rules.sizingMode === "risk" && draft.suggestedShares !== null && draft.suggestedShares <= 0 && draft.riskR !== null) {
    const minShares = rules.allowFractionalShares ? 1 : rules.lotSize;
    if (draft.riskR * minShares > rules.maxLossYen) {
      reasons.push(
        reason(
          "expected_loss_too_large",
          "想定損失が大きすぎる",
          false,
          `1株リスク ${draft.riskR.toFixed(0)}円 × 最低${minShares}株 が上限 ${rules.maxLossYen.toLocaleString("ja-JP")}円 を超過`
        )
      );
    } else if (draft.entryPrice !== null && rules.maxPositionYen !== null) {
      reasons.push(
        reason(
          "position_cost_too_large",
          "投入額が上限を超過",
          false,
          `買い基準 ${draft.entryPrice.toFixed(0)}円 × 最低${minShares}株 が上限 ${rules.maxPositionYen.toLocaleString("ja-JP")}円 を超過`
        )
      );
    }
  }

  if (themeScoreValue < rules.themeWatchScoreThreshold) {
    reasons.push(reason("theme_weak", "テーマ資金が弱い", false, `テーマ資金スコア ${themeScoreValue}`));
  } else if (themeScoreValue < rules.themeBuyScoreThreshold) {
    reasons.push(reason("theme_weak", "テーマ資金が買い基準未満", false, `テーマ資金スコア ${themeScoreValue}`));
  }

  if (draft.individualScore < rules.individualBuyScoreThreshold) {
    reasons.push(reason("individual_score_low", "個別押し目スコアが買い基準未満", false, `個別スコア ${draft.individualScore}`));
  }

  if (draft.rewardR !== null && draft.rewardR < rules.minRewardR) {
    reasons.push(
      reason(
        "reward_r_too_low",
        "利確ラインまでの利益余地が1R未満",
        false,
        `リワードR ${draft.rewardR.toFixed(2)} / 最低 ${rules.minRewardR.toFixed(1)}`
      )
    );
  }

  if (draft.takeProfit1 !== null && draft.entryPrice !== null && draft.takeProfit1 <= draft.entryPrice) {
    reasons.push(
      reason(
        "profit_target_near",
        "直近高値が近すぎる",
        false,
        `第1利確 ${draft.takeProfit1.toFixed(0)} / 買い基準 ${draft.entryPrice.toFixed(0)}`
      )
    );
  }

  if (draft.ma25Deviation !== null && draft.ma25Deviation >= rules.profitWarningMa25Deviation) {
    reasons.push(
      reason(
        "profit_warning_overheated",
        "25日線乖離率が大きく過熱気味",
        false,
        `25日線乖離 ${(draft.ma25Deviation * 100).toFixed(2)}%`
      )
    );
  }

  reasons.push(...qualityFlags);

  if (status === "watch" && reasons.length === 0) {
    reasons.push(reason("watch_conditions_pending", "監視継続", true, "買い候補条件が揃うまで追いかけない"));
  }

  return uniqueReasons(reasons);
}

/**
 * 品質フィルター(flag/exclude)の警告理由。条件がfalseなら測定値は非null(null→条件true)だが、型の絞り込みのため個別に確認する。
 * market は全銘柄に等しくかかるマスタースイッチ由来なので、close!==null の全候補に同じ理由が付く(呼び出し側で保証)。
 */
function qualityFlagReasons(draft: CandidateDraft, rules: Rules, market: MarketCondition | null): RuleReason[] {
  const flags: RuleReason[] = [];

  if (
    rules.stopTightFilterMode !== "off" &&
    !draft.conditions.stopNotTooTight &&
    draft.stopDistanceAtr !== null &&
    draft.riskR !== null
  ) {
    flags.push(
      reason(
        "stop_too_tight",
        "損切りラインが近すぎる（ノイズ域）",
        false,
        `損切り幅 ${draft.riskR.toFixed(0)}円 = ${draft.stopDistanceAtr.toFixed(2)} ATR / 最低 ${rules.stopAtrMinMultiple} ATR`
      )
    );
  }

  if (rules.volumeFilterMode !== "off" && !draft.conditions.volumeDryUp && draft.volumeRatio !== null) {
    flags.push(
      reason(
        "volume_not_dry",
        "押し目中も出来高が減っていない",
        false,
        `直近${rules.volumeShortWindow}日出来高/20日平均 = ${draft.volumeRatio.toFixed(2)} / 基準 ${rules.volumeDryUpMaxRatio} 以下`
      )
    );
  }

  if (
    rules.earningsFilterMode !== "off" &&
    !draft.conditions.noEarningsSoon &&
    draft.nextEarningsDate !== null &&
    draft.daysToEarnings !== null
  ) {
    flags.push(
      reason(
        "earnings_soon",
        "決算発表が近い",
        false,
        `次回決算 ${draft.nextEarningsDate}（あと${draft.daysToEarnings}営業日） / 発表${rules.earningsExclusionDays}営業日前から買い見送り`
      )
    );
  }

  if (
    rules.marketFilterMode !== "off" &&
    market !== null &&
    market.regimeOk === false &&
    market.ma25 !== null &&
    market.ma25Deviation !== null
  ) {
    flags.push(
      reason(
        "market_regime_weak",
        "地合いが弱い（市場が25日線条件を満たさない）",
        false,
        `${market.code} 終値 ${market.close.toFixed(0)} / 25日線 ${market.ma25.toFixed(1)}（乖離 ${(market.ma25Deviation * 100).toFixed(2)}% / トレンド ${market.ma25Trend}）`
      )
    );
  }

  return flags;
}

function reason(key: string, label: string, passed: boolean, detail: string): RuleReason {
  return { key, label, passed, detail };
}

function exitModeFor(draft: CandidateDraft, themeScoreValue: number, rules: Rules): ExitMode | null {
  if (draft.close === null) return null;
  return themeScoreValue >= rules.trendFollowThemeScoreThreshold ? "trend_follow_exit" : "target_exit";
}

function computeProfitWarnings(
  draft: CandidateDraft,
  themeScoreValue: number,
  theme: ThemeScore | undefined,
  rules: Rules
): ProfitWarning[] {
  if (draft.close === null) return [];

  const warnings: ProfitWarning[] = [];

  if (draft.ma25Deviation !== null && draft.ma25Deviation >= rules.profitWarningMa25Deviation) {
    warnings.push({ key: "profit_warning_overheated", label: "25日線乖離率が大きく過熱気味" });
  }

  if (themeScoreValue < rules.themeWatchScoreThreshold) {
    warnings.push({ key: "profit_warning_theme_weak", label: "テーマ資金スコアが低下" });
  }

  if (theme !== undefined && theme.leaderMa5AboveRatio < rules.leaderMa5AboveRatioMin) {
    warnings.push({ key: "profit_warning_leader_breakdown", label: "主役株の半数以上が5日線割れ" });
  }

  return warnings;
}

function uniqueReasons(reasons: RuleReason[]): RuleReason[] {
  const seen = new Set<string>();
  return reasons.filter((item) => {
    const uniqueKey = `${item.key}:${item.detail}`;
    if (seen.has(uniqueKey)) {
      return false;
    }

    seen.add(uniqueKey);
    return true;
  });
}

function classifyCandidate(
  draft: CandidateDraft,
  themeScoreValue: number,
  rules: Rules,
  marketRegimeOk: boolean | null
): CandidateStatus {
  if (draft.close === null || draft.ma25 === null || draft.expectedLoss === null) {
    return "avoid";
  }

  const hardFail =
    draft.ma25Trend === "down" ||
    draft.close < draft.ma25 ||
    draft.expectedLoss <= 0 ||
    draft.expectedLoss > rules.maxLossYen;

  if (hardFail) {
    return "avoid";
  }

  const individualBuy = draft.individualScore >= rules.individualBuyScoreThreshold;
  const individualWatch = draft.individualScore >= rules.individualWatchScoreThreshold;
  const themeBuy = themeScoreValue >= rules.themeBuyScoreThreshold;
  const themeWatch = themeScoreValue >= rules.themeWatchScoreThreshold;
  const notPulledBackYet = draft.ma5Deviation !== null && draft.ma5Deviation > rules.ma5DeviationMax;
  const individualCoreGood =
    draft.conditions.ma25TrendUp &&
    draft.conditions.closeAboveMa25 &&
    draft.conditions.ma5TrendUpOrFlat &&
    draft.conditions.expectedLossWithinLimit;
  const rewardSufficient = draft.rewardR === null || draft.rewardR >= rules.minRewardR;

  if (individualBuy && themeBuy && draft.expectedLoss <= rules.maxLossYen && rewardSufficient) {
    // 品質フィルター(excludeモード時のみ): シナリオ崩壊ではなく押し目の質の問題なので avoid ではなく watch に降格
    // marketRegimeOk === false の厳密比較が重要(null=測定不能は罰しない)
    const qualityExcluded =
      (rules.stopTightFilterMode === "exclude" && !draft.conditions.stopNotTooTight) ||
      (rules.volumeFilterMode === "exclude" && !draft.conditions.volumeDryUp) ||
      (rules.marketFilterMode === "exclude" && marketRegimeOk === false) ||
      (rules.earningsFilterMode === "exclude" && !draft.conditions.noEarningsSoon);

    return qualityExcluded ? "watch" : "buy_candidate";
  }

  if (individualBuy && themeBuy && draft.expectedLoss <= rules.maxLossYen && !rewardSufficient) {
    return "watch";
  }

  if (
    individualWatch ||
    (themeBuy && notPulledBackYet) ||
    (individualCoreGood && themeWatch && themeScoreValue < rules.themeBuyScoreThreshold)
  ) {
    return "watch";
  }

  return "avoid";
}

function actionForStatus(status: CandidateStatus): string {
  if (status === "buy_candidate") {
    return BUY_ACTION;
  }

  if (status === "watch") {
    return "5日線との距離、テーマ主役株の維持率、想定損失を引け後に再確認。買い候補条件が揃うまで追いかけない。";
  }

  return "条件未達。25日線の向き、テーマ資金スコア、想定損失が改善するまで見送り。";
}

/** 運用マニュアル「注文の組み方」と同じ手順(夜に注文を組み、朝は裁量を挟まない) */
function orderChecklistFor(rules: Rules): string[] {
  const sharesItem =
    rules.sizingMode === "risk"
      ? `株数 = 画面の「株数」欄（リスク${rules.maxLossYen.toLocaleString("ja-JP")}円 ÷ (買い指値 − 損切りライン) を${rules.lotSize}株単位で切り捨て済み）。0株なら見送り`
      : `株数 = ${rules.defaultShares.toLocaleString("ja-JP")}株（固定）`;

  return [
    "買い指値 = 買い基準価格。買い上限価格を超えては絶対に追わない",
    "損切り逆指値 = 損切りライン（シグナル日の安値）。買い注文と同時にセットし、エントリー後は動かさない",
    sharesItem,
    "翌朝、寄りが損切りライン以下で始まったら（ギャップダウン）注文を取り消して見送り",
    "指値に届かなかったら縁がなかったと諦める。場中に思いついた売買はしない"
  ];
}

function sortCandidates(a: CandidateResult, b: CandidateResult): number {
  const statusOrder: Record<CandidateStatus, number> = {
    buy_candidate: 0,
    watch: 1,
    avoid: 2
  };

  return (
    statusOrder[a.status] - statusOrder[b.status] ||
    b.individualScore - a.individualScore ||
    b.themeScore - a.themeScore ||
    a.code.localeCompare(b.code) ||
    a.theme.localeCompare(b.theme, "ja")
  );
}
