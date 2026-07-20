import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { analyzeBbWatch } from "./bbWatch";
import { EarningsRow, toEarningsRows, toPriceRows, toWatchlistRows } from "./csv";
import { evaluateCandidates } from "./evaluator";
import {
  BbWatchResult,
  CandidateResult,
  EvaluationOutput,
  MarketCondition,
  PriceRow,
  Rules,
  ThemeScore,
  WatchlistRow
} from "./types";

const root = process.cwd();

export function readRules(): Rules {
  return JSON.parse(readText("config/rules.json")) as Rules;
}

export function readWatchlist(): WatchlistRow[] {
  return toWatchlistRows(readText("data/watchlist.csv"));
}

export function readPrices(): PriceRow[] {
  const filePath = resolvePath("data/prices.csv");
  if (!existsSync(filePath)) {
    return [];
  }

  return toPriceRows(readText("data/prices.csv"));
}

export function readPricesForCode(code: string): PriceRow[] {
  return readPrices().filter((row) => row.code === code);
}

export function readEarnings(): EarningsRow[] {
  const filePath = resolvePath("data/earnings.csv");
  if (!existsSync(filePath)) {
    return [];
  }

  return toEarningsRows(readText("data/earnings.csv"));
}

export function readEvaluation(): EvaluationOutput {
  const rules = readRules();
  const generatedCandidates = readJsonFile<CandidateResult[]>("data/candidates.json", []);
  const generatedThemes = readJsonFile<ThemeScore[]>("data/theme_scores.json", []);
  const pricesAsOf = readPricesAsOf();

  if (generatedCandidates.length > 0 || generatedThemes.length > 0) {
    return {
      generatedAt: generatedFileTime(),
      pricesAsOf,
      rules,
      candidates: generatedCandidates,
      themeScores: generatedThemes,
      market: readJsonFile<MarketCondition | null>("data/market.json", null)
    };
  }

  // generatedAt はデフォルト(現在時刻)を使うため undefined を渡す
  return { ...evaluateCandidates(readWatchlist(), readPrices(), rules, undefined, readEarnings()), pricesAsOf };
}

/** data/history/signals/ にある YYYY-MM-DD.json の最大日付。ディレクトリ不存在・0件は null */
export function readLatestSnapshotDate(): string | null {
  const dirPath = resolvePath("data/history/signals");
  if (!existsSync(dirPath)) {
    return null;
  }

  // ゼロ埋めISO日付は辞書順=時系列順なので文字列比較で最大を取れる
  const dates = readdirSync(dirPath)
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .map((file) => file.slice(0, -".json".length))
    .sort();

  return dates.length > 0 ? dates[dates.length - 1] : null;
}

export function readBbWatch(): BbWatchResult[] {
  const generated = readJsonFile<BbWatchResult[]>("data/bb_watch.json", []);
  if (generated.length > 0) {
    return generated;
  }

  const rules = readRules();
  const evaluation = readEvaluation();
  return analyzeBbWatch(readWatchlist(), readPrices(), evaluation.themeScores, rules);
}

export function findBbWatch(code: string): BbWatchResult | undefined {
  return readBbWatch().find((row) => row.code === code);
}

export function findCandidate(code: string): CandidateResult | undefined {
  return findCandidatesByCode(code)[0];
}

export function findCandidatesByCode(code: string): CandidateResult[] {
  return readEvaluation().candidates.filter((candidate) => candidate.code === code);
}

function readJsonFile<T>(relativePath: string, fallback: T): T {
  const filePath = resolvePath(relativePath);
  if (!existsSync(filePath)) {
    return fallback;
  }

  const text = readFileSync(filePath, "utf8").trim();
  if (!text) {
    return fallback;
  }

  return JSON.parse(text) as T;
}

function readPricesAsOf(): string | null {
  const filePath = resolvePath("data/prices_as_of.json");
  if (!existsSync(filePath)) return null;
  const data = JSON.parse(readFileSync(filePath, "utf8")) as { as_of: string | null };
  return data.as_of ?? null;
}

function readText(relativePath: string): string {
  return readFileSync(resolvePath(relativePath), "utf8");
}

function resolvePath(relativePath: string): string {
  return path.join(root, relativePath);
}

function generatedFileTime(): string {
  return new Date().toISOString();
}
