import { Rules, ThemeStatus } from "./types";

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
  const weights = rules.scoring.theme;
  return [
    isTopThemeRank(input.rank, input.totalThemes, rules) ? weights.rankTopPercent : 0,
    input.leaderMa5AboveRatio >= rules.leaderMa5AboveRatioMin ? weights.leaderMa5AboveRatio : 0,
    input.leaderMa25AboveRatio >= rules.leaderMa25AboveRatioMin ? weights.leaderMa25AboveRatio : 0,
    input.return5d > 0 ? weights.return5dPositive : 0
  ].reduce((total, points) => total + points, 0);
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
