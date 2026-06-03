import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { toPriceRows, toWatchlistRows } from "./csv";
import { evaluateCandidates } from "./evaluator";
import { CandidateResult, EvaluationOutput, PriceRow, Rules, ThemeScore, WatchlistRow } from "./types";

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

export function readEvaluation(): EvaluationOutput {
  const rules = readRules();
  const generatedCandidates = readJsonFile<CandidateResult[]>("data/candidates.json", []);
  const generatedThemes = readJsonFile<ThemeScore[]>("data/theme_scores.json", []);

  if (generatedCandidates.length > 0 || generatedThemes.length > 0) {
    return {
      generatedAt: generatedFileTime(),
      rules,
      candidates: generatedCandidates,
      themeScores: generatedThemes
    };
  }

  return evaluateCandidates(readWatchlist(), readPrices(), rules);
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

function readText(relativePath: string): string {
  return readFileSync(resolvePath(relativePath), "utf8");
}

function resolvePath(relativePath: string): string {
  return path.join(root, relativePath);
}

function generatedFileTime(): string {
  return new Date().toISOString();
}
