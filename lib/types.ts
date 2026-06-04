export type Trend = "up" | "flat" | "down" | "unknown";

export type CandidateStatus = "buy_candidate" | "watch" | "avoid";

export type ThemeStatus = "strong" | "watch" | "weak";

export type WatchPriority = "A" | "B" | "C" | string;

export type WatchlistKey = `${string}__${string}`;

export interface WatchlistRow {
  watchlistKey: WatchlistKey;
  code: string;
  name: string;
  sector: string;
  theme: string;
  isLeader: boolean;
  watchPriority: WatchPriority;
}

export interface PriceRow {
  code: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ScoringWeights {
  individual: {
    ma25TrendUp: number;
    closeAboveMa25: number;
    ma5DeviationInRange: number;
    ma5TrendUpOrFlat: number;
    yearHighDeviationInRange: number;
    expectedLossWithinLimit: number;
  };
  theme: {
    rankTopPercent: number;
    leaderMa5AboveRatio: number;
    leaderMa25AboveRatio: number;
    return5dPositive: number;
  };
}

export interface Rules {
  maShort: number;
  maMiddle: number;
  entryMaPremium: number;
  entryUpperPremium: number;
  maxLossYen: number;
  defaultShares: number;
  ma5DeviationMin: number;
  ma5DeviationMax: number;
  yearHighDeviationMin: number;
  yearHighDeviationMax: number;
  themeRankTopPercent: number;
  leaderMa5AboveRatioMin: number;
  leaderMa25AboveRatioMin: number;
  individualBuyScoreThreshold: number;
  individualWatchScoreThreshold: number;
  themeBuyScoreThreshold: number;
  themeWatchScoreThreshold: number;
  trendFlatTolerance: number;
  scoring: ScoringWeights;
}

export interface RuleReason {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface CandidateResult {
  watchlistKey: WatchlistKey;
  code: string;
  name: string;
  sector: string;
  theme: string;
  isLeader: boolean;
  watchPriority: WatchPriority;
  status: CandidateStatus;
  date: string | null;
  close: number | null;
  volume: number | null;
  ma5: number | null;
  ma25: number | null;
  ma5Slope: number | null;
  ma25Slope: number | null;
  ma5Deviation: number | null;
  ma25Deviation: number | null;
  ma5Trend: Trend;
  ma25Trend: Trend;
  yearHigh: number | null;
  yearHighDeviation: number | null;
  previousLow: number | null;
  return5d: number | null;
  return20d: number | null;
  individualScore: number;
  themeScore: number;
  themeRank: number | null;
  entryPrice: number | null;
  entryUpperPrice: number | null;
  stopLoss: number | null;
  expectedLoss: number | null;
  reasons: RuleReason[];
  tomorrowAction: string;
  intradayMemo: string[];
}

export interface ThemeScore {
  theme: string;
  priority: WatchPriority;
  rank: number;
  return5d: number;
  return20d: number;
  themeScore: number;
  leaderMa5AboveRatio: number;
  leaderMa25AboveRatio: number;
  status: ThemeStatus;
  stockCount: number;
  leaderCount: number;
}

export interface EvaluationOutput {
  generatedAt: string;
  pricesAsOf: string | null;
  rules: Rules;
  candidates: CandidateResult[];
  themeScores: ThemeScore[];
}
