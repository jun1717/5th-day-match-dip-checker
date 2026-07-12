import { Rules, ThemeScoreComponents, ThemeStatus } from "./types";

export interface IndividualScoreInput {
  ma25TrendUp: boolean;
  closeAboveMa25: boolean;
  ma5DeviationInRange: boolean;
  ma5TrendUpOrFlat: boolean;
  yearHighDeviationInRange: boolean;
  expectedLossWithinLimit: boolean;
}

export interface ThemeScoreInput {
  rank: number;
  totalThemes: number;
  leaderMa5AboveRatio: number;
  leaderMa25AboveRatio: number;
  return5d: number;
  return20d: number;
  /** return5dの全テーマ内パーセンタイル(0..1、最強=1)。binaryモードでは未使用 */
  percentile5d: number;
  /** return20dの全テーマ内パーセンタイル(0..1、最強=1)。binaryモードでは未使用 */
  percentile20d: number;
}

export function scoreIndividual(input: IndividualScoreInput, rules: Rules): number {
  const weights = rules.scoring.individual;
  return [
    input.ma25TrendUp ? weights.ma25TrendUp : 0,
    input.closeAboveMa25 ? weights.closeAboveMa25 : 0,
    input.ma5DeviationInRange ? weights.ma5DeviationInRange : 0,
    input.ma5TrendUpOrFlat ? weights.ma5TrendUpOrFlat : 0,
    input.yearHighDeviationInRange ? weights.yearHighDeviationInRange : 0,
    input.expectedLossWithinLimit ? weights.expectedLossWithinLimit : 0
  ].reduce((total, points) => total + points, 0);
}

export function isTopThemeRank(rank: number, totalThemes: number, rules: Rules): boolean {
  const topCount = Math.max(1, Math.ceil(totalThemes * rules.themeRankTopPercent));
  return rank <= topCount;
}

export function scoreTheme(input: ThemeScoreInput, rules: Rules): number {
  return rules.themeScoringMode === "continuous"
    ? scoreThemeContinuous(input, rules)
    : scoreThemeBinary(input, rules);
}

function scoreThemeBinary(input: ThemeScoreInput, rules: Rules): number {
  const weights = rules.scoring.theme;
  return [
    isTopThemeRank(input.rank, input.totalThemes, rules) ? weights.rankTopPercent : 0,
    input.leaderMa5AboveRatio >= rules.leaderMa5AboveRatioMin ? weights.leaderMa5AboveRatio : 0,
    input.leaderMa25AboveRatio >= rules.leaderMa25AboveRatioMin ? weights.leaderMa25AboveRatio : 0,
    input.return5d > 0 ? weights.return5dPositive : 0
  ].reduce((total, points) => total + points, 0);
}

/**
 * 連続版: binaryの4つの二値条件を、同じ配点のまま自然な連続量に置き換える。
 * - 順位(30点) → 5日/20日騰落率パーセンタイルのブレンド(相対強度)
 * - 主役株維持率(30点/20点) → 維持率そのまま(0..1)
 * - 5日騰落率プラス(20点) → ±rangeを0..1に線形写像した絶対モメンタムのブレンド
 *   (騰落率0%はちょうど0.5。全テーマ下落時はこの項が全テーマ沈み、相対順位だけでは満点にならない)
 */
export function scoreThemeContinuous(input: ThemeScoreInput, rules: Rules): number {
  const raw = rawThemeScoreComponents(input, rules);
  return Math.round(raw.relativeStrength + raw.leaderMa5 + raw.leaderMa25 + raw.momentum);
}

/** UI・検証用のスコア内訳(配点適用後・小数1桁丸め)。binaryモードではnull */
export function themeScoreComponentsOf(input: ThemeScoreInput, rules: Rules): ThemeScoreComponents | null {
  if (rules.themeScoringMode !== "continuous") {
    return null;
  }

  const raw = rawThemeScoreComponents(input, rules);
  return {
    relativeStrength: round1(raw.relativeStrength),
    leaderMa5: round1(raw.leaderMa5),
    leaderMa25: round1(raw.leaderMa25),
    momentum: round1(raw.momentum)
  };
}

function rawThemeScoreComponents(input: ThemeScoreInput, rules: Rules): ThemeScoreComponents {
  const weights = rules.scoring.theme;
  return {
    relativeStrength: weights.rankTopPercent * relativeStrengthOf(input, rules),
    leaderMa5: weights.leaderMa5AboveRatio * input.leaderMa5AboveRatio,
    leaderMa25: weights.leaderMa25AboveRatio * input.leaderMa25AboveRatio,
    momentum:
      weights.return5dPositive *
      (rules.themeMomentumBlend5d * momentum01(input.return5d, rules.themeMomentum5dRange) +
        (1 - rules.themeMomentumBlend5d) * momentum01(input.return20d, rules.themeMomentum20dRange))
  };
}

/** 相対強度(0..1): 5日/20日パーセンタイルのブレンド。continuousモードの順位付けにも使う */
export function relativeStrengthOf(
  input: Pick<ThemeScoreInput, "percentile5d" | "percentile20d">,
  rules: Rules
): number {
  return rules.themeMomentumBlend5d * input.percentile5d + (1 - rules.themeMomentumBlend5d) * input.percentile20d;
}

/** 騰落率±rangeを0..1に線形写像(0%→0.5、range以上→1、-range以下→0) */
function momentum01(rateOfReturn: number, range: number): number {
  return clamp01((rateOfReturn + range) / (2 * range));
}

/**
 * valuesの中でのvalueのパーセンタイル(0..1、最大=1)。
 * pct = (自分より小さい個数 + 0.5×自分と等しい個数(自分を除く)) / (n - 1)。
 * タイは0.5扱い(全テーマ同値なら全テーマ0.5)。n<=1は1を返す(ゼロ除算ガード)。
 */
export function percentileOf(value: number, values: number[]): number {
  if (values.length <= 1) {
    return 1;
  }

  let below = 0;
  let ties = 0;
  for (const other of values) {
    if (other < value) {
      below += 1;
    } else if (other === value) {
      ties += 1;
    }
  }

  return (below + 0.5 * (ties - 1)) / (values.length - 1);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function themeStatus(score: number, rules: Rules): ThemeStatus {
  if (score >= rules.themeBuyScoreThreshold) {
    return "strong";
  }

  if (score >= rules.themeWatchScoreThreshold) {
    return "watch";
  }

  return "weak";
}
