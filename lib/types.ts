export type Trend = "up" | "flat" | "down" | "unknown";

export type ExitMode = "target_exit" | "trend_follow_exit";

export interface ProfitWarning {
  key: string;
  label: string;
}

export type CandidateStatus = "buy_candidate" | "watch" | "avoid";

/** 品質フィルターの動作: off=無効 / flag=理由表示のみ / exclude=買い候補からwatchに降格 */
export type QualityFilterMode = "off" | "flag" | "exclude";

/** 建玉の決め方: fixed=defaultShares固定 / risk=リスク許容額から株数を逆算 */
export type SizingMode = "fixed" | "risk";

/** テーマスコアの計算方式: binary=4条件×二値(現行) / continuous=各条件を連続量に置き換えた0-100 */
export type ThemeScoringMode = "binary" | "continuous";

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
  recentHighLookback: number;
  minRewardR: number;
  profitWarningMa25Deviation: number;
  trendFollowThemeScoreThreshold: number;
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
  atrPeriod: number;
  stopAtrMinMultiple: number;
  stopTightFilterMode: QualityFilterMode;
  sizingMode: SizingMode;
  lotSize: number;
  allowFractionalShares: boolean;
  maxPositionYen: number | null;
  volumeShortWindow: number;
  volumeLongWindow: number;
  volumeDryUpMaxRatio: number;
  volumeFilterMode: QualityFilterMode;
  marketIndexCode: string;
  marketFilterMode: QualityFilterMode;
  earningsExclusionDays: number;
  earningsFilterMode: QualityFilterMode;
  themeScoringMode: ThemeScoringMode;
  themeMomentumBlend5d: number;
  themeMomentum5dRange: number;
  themeMomentum20dRange: number;
  scoring: ScoringWeights;
  bollingerPeriod: number;
  bbTouchTolerance: number;
  bbNearTolerance: number;
  bbLookaheadDays: number;
  bbSuccessReturnThreshold: number;
  bbFailureReturnThreshold: number;
  bbMinTouchCount: number;
  bbTimingGoodSuccessRate: number;
  bbThemeScoreThreshold: number;
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
  atr: number | null;
  stopDistanceAtr: number | null;
  volumeShortAvg: number | null;
  volumeLongAvg: number | null;
  volumeRatio: number | null;
  /** 評価日(latest.date)以降で最初の決算発表日。data/earnings.csv に該当が無ければnull */
  nextEarningsDate: string | null;
  /** 評価日から nextEarningsDate までの平日数(祝日近似)。nextEarningsDate=null なら null(不罰) */
  daysToEarnings: number | null;
  individualScore: number;
  themeScore: number;
  themeRank: number | null;
  entryPrice: number | null;
  entryUpperPrice: number | null;
  /** シグナル日前日(D-1)の安値。当日(D)エントリー時の損切り基準で、バックテストのstopLossSignalと同じ意味。
   *  翌朝(D+1)エントリーの損切りは signalDayLow を使うこと */
  stopLoss: number | null;
  /** シグナル日(D)の安値。翌朝エントリーの損切りライン(=「エントリー日の前日の安値」ドクトリン)で、
   *  バックテストの stopMode="prev-day" と同じ基準。画面の損切り表示はこちら */
  signalDayLow: number | null;
  suggestedShares: number | null;
  positionCost: number | null;
  expectedLoss: number | null;
  /** 翌朝注文用: signalDayLow を損切りとして再計算した株数・投入額・想定損失・リワードR。
   *  買い指値(entryPrice)が損切り以下で注文が成立しない場合は null */
  orderShares: number | null;
  orderPositionCost: number | null;
  orderExpectedLoss: number | null;
  orderRewardR: number | null;
  recentHigh20: number | null;
  takeProfit1: number | null;
  riskR: number | null;
  reward: number | null;
  rewardR: number | null;
  exitMode: ExitMode | null;
  profitWarnings: ProfitWarning[];
  reasons: RuleReason[];
  tomorrowAction: string;
  orderChecklist: string[];
}

/** 連続テーマスコアの成分(配点適用後・小数1桁丸め)。合計≒themeScore(丸め誤差のみ) */
export interface ThemeScoreComponents {
  relativeStrength: number;
  leaderMa5: number;
  leaderMa25: number;
  momentum: number;
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
  /** binaryモードではnull。旧スナップショットのthemeScoresには存在しないため読み手はundefined許容にすること */
  scoreComponents: ThemeScoreComponents | null;
}

/** 市場レジーム指標(TOPIX連動ETF等)の当日状態。指標データが無い/不足のときは EvaluationOutput.market = null */
export interface MarketCondition {
  code: string;
  date: string;
  close: number;
  ma25: number | null;
  ma25Deviation: number | null;
  ma25Trend: Trend;
  /** 地合いOK = 終値が25日線より上 かつ 25日線が上向き。ma25計算不能ならnull(不罰) */
  regimeOk: boolean | null;
}

export interface EvaluationOutput {
  generatedAt: string;
  pricesAsOf: string | null;
  rules: Rules;
  candidates: CandidateResult[];
  themeScores: ThemeScore[];
  market: MarketCondition | null;
}

export type BollingerLine = "ma25" | "bb_minus_1sigma" | "bb_minus_2sigma";

export type PreferredLine = BollingerLine | "insufficient_history";

export type CurrentLine = BollingerLine | "not_near_pullback_line";

export type BbWatchStatus = "timing_good" | "watch" | "insufficient_history" | "not_near";

export interface BbReason {
  key: string;
  label: string;
}

export interface BbLineStats {
  line: BollingerLine;
  touchCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgMaxReturn5d: number;
  avgMaxDrawdown5d: number;
}

export interface BbWatchResult {
  watchlistKey: WatchlistKey;
  code: string;
  name: string;
  sector: string;
  theme: string;
  isLeader: boolean;
  watchPriority: WatchPriority;
  themeScore: number;
  date: string | null;
  close: number | null;
  low: number | null;
  ma25: number | null;
  stdDev25: number | null;
  bbUpper1: number | null;
  bbUpper2: number | null;
  bbLower1: number | null;
  bbLower2: number | null;
  ma25Deviation: number | null;
  bbUpper1Deviation: number | null;
  bbUpper2Deviation: number | null;
  bbLower1Deviation: number | null;
  bbLower2Deviation: number | null;
  ma25Trend: Trend;
  lineStats: BbLineStats[];
  preferredLine: PreferredLine;
  currentLine: CurrentLine;
  successRate: number;
  touchCount: number;
  avgMaxReturn5d: number;
  avgMaxDrawdown5d: number;
  bbWatchStatus: BbWatchStatus;
  reasons: BbReason[];
}
