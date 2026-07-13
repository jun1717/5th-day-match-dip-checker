import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { analyzeBbWatch } from "../lib/bbWatch";
import { toEarningsRows, toPriceRows, toWatchlistRows } from "../lib/csv";
import { evaluateCandidates } from "../lib/evaluator";
import { Rules } from "../lib/types";

const root = process.cwd();

const rules = JSON.parse(readFileSync(path.join(root, "config/rules.json"), "utf8")) as Rules;
const watchlist = toWatchlistRows(readFileSync(path.join(root, "data/watchlist.csv"), "utf8"));
const prices = toPriceRows(readFileSync(path.join(root, "data/prices.csv"), "utf8"));
// data/earnings.csv はオプショナル(未作成でも動く)。存在すれば決算日フィルターに使う
const earningsPath = path.join(root, "data/earnings.csv");
const earnings = existsSync(earningsPath) ? toEarningsRows(readFileSync(earningsPath, "utf8")) : [];
const result = evaluateCandidates(watchlist, prices, rules, undefined, earnings);
const bbWatch = analyzeBbWatch(watchlist, prices, result.themeScores, rules);

mkdirSync(path.join(root, "data"), { recursive: true });
writeFileSync(path.join(root, "data/candidates.json"), `${JSON.stringify(result.candidates, null, 2)}\n`);
writeFileSync(path.join(root, "data/theme_scores.json"), `${JSON.stringify(result.themeScores, null, 2)}\n`);
writeFileSync(path.join(root, "data/market.json"), `${JSON.stringify(result.market, null, 2)}\n`);
writeFileSync(path.join(root, "data/bb_watch.json"), `${JSON.stringify(bbWatch, null, 2)}\n`);

console.log(
  `generated ${result.candidates.length} candidates, ${result.themeScores.length} theme scores and ${bbWatch.length} bb watch rows`
);
