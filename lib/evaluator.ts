import { deviation, max, movingAverageAt, rateOfChangeAt, trendFrom } from "./indicators";
import { scoreIndividual, scoreTheme, themeStatus } from "./scoring";
import {
  CandidateResult,
  CandidateStatus,
  ExitMode,
  EvaluationOutput,
  PriceRow,
  ProfitWarning,
  RuleReason,
  Rules,
  ThemeScore,
  WatchlistRow
} from "./types";

const BUY_ACTION =
  "9:30〜10:00に確認。現在値が買い基準価格より高ければ、買い基準価格で指値注文。約定しなければ追いかけない。現在値が買い基準価格以下なら、5分足の下げ止まり確認後のみ成行買い。損切りラインは前日に決めた位置から下げない。";

type CandidateDraft = Omit<CandidateResult, "themeScore" | "themeRank" | "status" | "tomorrowAction" | "exitMode" | "profitWarnings"> & {
  conditions: {
    ma25TrendUp: boolean;
    closeAboveMa25: boolean;
    ma5DeviationInRange: boolean;
    ma5TrendUpOrFlat: boolean;
    yearHighDeviationInRange: boolean;
    expectedLossWithinLimit: boolean;
  };
};

export function evaluateCandidates(
  watchlist: WatchlistRow[],
  prices: PriceRow[],
  rules: Rules,
  generatedAt = new Date().toISOString()
): EvaluationOutput {
  const pricesByCode = groupPricesByCode(prices);
  const drafts = watchlist.map((stock) => evaluateStock(stock, pricesByCode.get(stock.code) ?? [], rules));
  const themeScores = evaluateThemes(drafts, rules);
  const themeByName = new Map(themeScores.map((theme) => [theme.theme, theme]));

  const candidates = drafts
    .map((draft) => {
      const theme = themeByName.get(draft.theme);
      const themeScoreValue = theme?.themeScore ?? 0;
      const status = classifyCandidate(draft, themeScoreValue, rules);
      const reasons = reasonsForCandidate(draft, themeScoreValue, status, rules);
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
    themeScores
  };
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

function evaluateStock(stock: WatchlistRow, prices: PriceRow[], rules: Rules): CandidateDraft {
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
  const expectedLoss = entryPrice === null ? null : Math.max(0, (entryPrice - stopLoss) * rules.defaultShares);
  const recentHigh20 = max(highs.slice(-rules.recentHighLookback));
  const takeProfit1 = recentHigh20;
  const riskR = entryPrice !== null && stopLoss !== null && entryPrice > stopLoss ? entryPrice - stopLoss : null;
  const reward = takeProfit1 !== null && entryPrice !== null ? takeProfit1 - entryPrice : null;
  const rewardR = riskR !== null && riskR > 0 && reward !== null ? reward / riskR : null;

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
    expectedLossWithinLimit: expectedLoss !== null && expectedLoss > 0 && expectedLoss <= rules.maxLossYen
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
    individualScore,
    entryPrice,
    entryUpperPrice,
    stopLoss,
    expectedLoss,
    recentHigh20,
    takeProfit1,
    riskR,
    reward,
    rewardR,
    reasons: [],
    intradayMemo: intradayMemoFor(rules),
    conditions
  };
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
    individualScore: 0,
    entryPrice: null,
    entryUpperPrice: null,
    stopLoss: null,
    expectedLoss: null,
    recentHigh20: null,
    takeProfit1: null,
    riskR: null,
    reward: null,
    rewardR: null,
    reasons: [reason("missing_price_data", "株価データが不足", false, detail)],
    intradayMemo: intradayMemoFor(rules),
    conditions: {
      ma25TrendUp: false,
      closeAboveMa25: false,
      ma5DeviationInRange: false,
      ma5TrendUpOrFlat: false,
      yearHighDeviationInRange: false,
      expectedLossWithinLimit: false
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

  const ranked = baseThemes
    .slice()
    .sort((a, b) => b.return5d - a.return5d)
    .map((theme, index) => ({ ...theme, rank: index + 1 }));

  const totalThemes = ranked.length;
  return ranked.map((theme) => {
    const themeScoreValue = scoreTheme(
      {
        rank: theme.rank,
        totalThemes,
        leaderMa5AboveRatio: theme.leaderMa5AboveRatio,
        leaderMa25AboveRatio: theme.leaderMa25AboveRatio,
        return5d: theme.return5d
      },
      rules
    );

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
      leaderCount: theme.leaderCount
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
  rules: Rules
): RuleReason[] {
  const reasons = [...draft.reasons];

  if (draft.close === null) {
    return reasons;
  }

  if (status === "buy_candidate") {
    return [reason("buy_setup_ready", "買い候補条件を満たしている", true, "個別スコアとテーマ資金スコアが買い基準以上")];
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

  if (status === "watch" && reasons.length === 0) {
    reasons.push(reason("watch_conditions_pending", "監視継続", true, "買い候補条件が揃うまで追いかけない"));
  }

  return uniqueReasons(reasons);
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

function classifyCandidate(draft: CandidateDraft, themeScoreValue: number, rules: Rules): CandidateStatus {
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
    return "buy_candidate";
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

function intradayMemoFor(rules: Rules): string[] {
  return [
    "現在値が損切りラインより上",
    `現在値で買っても想定損失${rules.maxLossYen.toLocaleString("ja-JP")}円以内`,
    "直近5分足が陽線",
    "直近5分足終値が1本前の5分足高値を上回る",
    "直近2本の5分足で安値を切り上げ",
    "当日安値を更新していない",
    "テーマ主役株が複数崩れていない"
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
