import { createHash } from "node:crypto";
import {
  CandidateResult,
  CandidateStatus,
  ExitMode,
  ThemeScore,
  Trend,
  WatchlistKey,
  WatchPriority
} from "./types";

export interface SlimCandidate {
  watchlistKey: WatchlistKey;
  code: string;
  name: string;
  theme: string;
  isLeader: boolean;
  watchPriority: WatchPriority;
  status: CandidateStatus;
  date: string | null;
  close: number | null;
  volume: number | null;
  ma5: number | null;
  ma25: number | null;
  ma5Deviation: number | null;
  ma25Deviation: number | null;
  ma5Trend: Trend;
  ma25Trend: Trend;
  yearHighDeviation: number | null;
  return5d: number | null;
  return20d: number | null;
  individualScore: number;
  themeScore: number;
  themeRank: number | null;
  entryPrice: number | null;
  entryUpperPrice: number | null;
  stopLoss: number | null;
  expectedLoss: number | null;
  takeProfit1: number | null;
  riskR: number | null;
  reward: number | null;
  rewardR: number | null;
  exitMode: ExitMode | null;
  reasonKeys: string[];
}

export interface SignalSnapshot {
  snapshotDate: string;
  generatedAt: string;
  rulesHash: string;
  candidates: SlimCandidate[];
  themeScores: ThemeScore[];
}

export function rulesHashOf(rawRulesText: string): string {
  return createHash("sha256").update(rawRulesText).digest("hex").slice(0, 12);
}

export function snapshotDateOf(candidates: CandidateResult[]): string | null {
  const dates = candidates
    .map((candidate) => candidate.date)
    .filter((date): date is string => date !== null);

  if (dates.length === 0) {
    return null;
  }

  return dates.reduce((latest, date) => (date > latest ? date : latest), dates[0]);
}

export function toSlimCandidate(candidate: CandidateResult): SlimCandidate {
  return {
    watchlistKey: candidate.watchlistKey,
    code: candidate.code,
    name: candidate.name,
    theme: candidate.theme,
    isLeader: candidate.isLeader,
    watchPriority: candidate.watchPriority,
    status: candidate.status,
    date: candidate.date,
    close: candidate.close,
    volume: candidate.volume,
    ma5: candidate.ma5,
    ma25: candidate.ma25,
    ma5Deviation: candidate.ma5Deviation,
    ma25Deviation: candidate.ma25Deviation,
    ma5Trend: candidate.ma5Trend,
    ma25Trend: candidate.ma25Trend,
    yearHighDeviation: candidate.yearHighDeviation,
    return5d: candidate.return5d,
    return20d: candidate.return20d,
    individualScore: candidate.individualScore,
    themeScore: candidate.themeScore,
    themeRank: candidate.themeRank,
    entryPrice: candidate.entryPrice,
    entryUpperPrice: candidate.entryUpperPrice,
    stopLoss: candidate.stopLoss,
    expectedLoss: candidate.expectedLoss,
    takeProfit1: candidate.takeProfit1,
    riskR: candidate.riskR,
    reward: candidate.reward,
    rewardR: candidate.rewardR,
    exitMode: candidate.exitMode,
    reasonKeys: candidate.reasons.map((reason) => reason.key)
  };
}

export function buildSnapshot(
  candidates: CandidateResult[],
  themeScores: ThemeScore[],
  rulesHash: string,
  generatedAt = new Date().toISOString()
): SignalSnapshot | null {
  const snapshotDate = snapshotDateOf(candidates);
  if (snapshotDate === null) {
    return null;
  }

  return {
    snapshotDate,
    generatedAt,
    rulesHash,
    candidates: candidates.map(toSlimCandidate),
    themeScores
  };
}
