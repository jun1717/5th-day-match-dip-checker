import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { toPriceRows, toWatchlistRows } from "../lib/csv";
import { evaluateCandidates } from "../lib/evaluator";
import { Rules } from "../lib/types";

const root = process.cwd();

const rules = JSON.parse(readFileSync(path.join(root, "config/rules.json"), "utf8")) as Rules;
const watchlist = toWatchlistRows(readFileSync(path.join(root, "data/watchlist.csv"), "utf8"));
const prices = toPriceRows(readFileSync(path.join(root, "data/prices.csv"), "utf8"));
const result = evaluateCandidates(watchlist, prices, rules);

mkdirSync(path.join(root, "data"), { recursive: true });
writeFileSync(path.join(root, "data/candidates.json"), `${JSON.stringify(result.candidates, null, 2)}\n`);
writeFileSync(path.join(root, "data/theme_scores.json"), `${JSON.stringify(result.themeScores, null, 2)}\n`);

console.log(`generated ${result.candidates.length} candidates and ${result.themeScores.length} theme scores`);
