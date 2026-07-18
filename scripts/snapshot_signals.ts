import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildSnapshot, rulesHashOf } from "../lib/snapshot";
import { CandidateResult, MarketCondition, ThemeScore } from "../lib/types";

const root = process.cwd();

const rawRules = readFileSync(path.join(root, "config/rules.json"), "utf8");
const candidates = JSON.parse(readFileSync(path.join(root, "data/candidates.json"), "utf8")) as CandidateResult[];
const themeScores = JSON.parse(readFileSync(path.join(root, "data/theme_scores.json"), "utf8")) as ThemeScore[];
// data/market.json が無ければ地合いなし(null)としてスナップショットを作る
const marketPath = path.join(root, "data/market.json");
const market = existsSync(marketPath)
  ? (JSON.parse(readFileSync(marketPath, "utf8")) as MarketCondition | null)
  : null;

const rulesHash = rulesHashOf(rawRules);
const snapshot = buildSnapshot(candidates, themeScores, rulesHash, market);

if (snapshot === null) {
  // 全候補が missing_price_data ということは、この実行では価格データが1件も取得できていない
  // (fetch_prices.py の失敗)。CIで気づけるよう黙って成功にせず失敗させる。
  console.error("error: 全候補の date が null です(価格データを1件も取得できていません)。fetch_prices.py の実行結果を確認してください。");
  process.exit(1);
}

const signalsDir = path.join(root, "data/history/signals");
const rulesDir = path.join(root, "data/history/rules");
mkdirSync(signalsDir, { recursive: true });
mkdirSync(rulesDir, { recursive: true });

// generatedAt 以外が同一なら既存ファイルを保持する（冪等な再実行で無意味なdiffを作らない）
const snapshotPath = path.join(signalsDir, `${snapshot.snapshotDate}.json`);
if (existsSync(snapshotPath)) {
  const existing = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const withoutTimestamp = (value: object) => JSON.stringify({ ...value, generatedAt: null });
  if (withoutTimestamp(existing) === withoutTimestamp(snapshot)) {
    console.log(`snapshot ${snapshot.snapshotDate}: 変更なし（既存ファイルを保持）`);
    process.exit(0);
  }
}

writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);

const rulesArchivePath = path.join(rulesDir, `${rulesHash}.json`);
if (!existsSync(rulesArchivePath)) {
  writeFileSync(rulesArchivePath, rawRules);
}

console.log(
  `snapshot ${snapshot.snapshotDate}: ${snapshot.candidates.length} candidates, ${snapshot.themeScores.length} themes (rules ${rulesHash})`
);
