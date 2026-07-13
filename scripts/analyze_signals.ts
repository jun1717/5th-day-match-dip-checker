import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  computeTradeStats,
  csvCell,
  formatTable,
  groupBy,
  marketRegimeBand,
  meanOf,
  num,
  pct,
  positiveRateOf,
  yen
} from "../lib/backtest/report";
import { SimulatedTrade, simulateTrade, StopMode } from "../lib/backtest/simulate";
import { toPriceRows } from "../lib/csv";
import { SignalSnapshot, SlimCandidate } from "../lib/snapshot";
import { PriceRow, Rules } from "../lib/types";

const TRAIL_CLOSES_LOOKBACK = 25;

const args = parseArgs({
  options: {
    prices: { type: "string", default: "data/prices.csv" },
    "max-hold-days": { type: "string", default: "30" },
    "stop-mode": { type: "string", default: "prev-day" },
    out: { type: "string", default: "data/analysis" }
  }
}).values;

const root = process.cwd();
const signalsDir = path.join(root, "data/history/signals");

if (!existsSync(signalsDir)) {
  console.error("data/history/signals がありません。まず `npm run evaluate && npm run snapshot` で履歴を蓄積してください。");
  process.exit(1);
}

const snapshotFiles = readdirSync(signalsDir)
  .filter((file) => file.endsWith(".json"))
  .sort();

if (snapshotFiles.length === 0) {
  console.error("スナップショットが0件です。まず `npm run evaluate && npm run snapshot` で履歴を蓄積してください。");
  process.exit(1);
}

const stopMode = args["stop-mode"] as StopMode;
if (stopMode !== "prev-day" && stopMode !== "signal") {
  console.error(`--stop-mode は prev-day か signal を指定してください: ${stopMode}`);
  process.exit(1);
}

const maxHoldDays = Number(args["max-hold-days"]);
const pricesPath = path.resolve(root, args.prices!);

if (!existsSync(pricesPath)) {
  console.error(`価格データが見つかりません: ${args.prices}`);
  process.exit(1);
}

const prices = toPriceRows(readFileSync(pricesPath, "utf8"));
const rowsByCode = new Map<string, PriceRow[]>();
for (const price of prices) {
  const rows = rowsByCode.get(price.code) ?? [];
  rows.push(price);
  rowsByCode.set(price.code, rows);
}
const indexByCode = new Map<string, Map<string, number>>();
for (const [code, rows] of rowsByCode) {
  rows.sort((a, b) => a.date.localeCompare(b.date));
  indexByCode.set(code, new Map(rows.map((row, index) => [row.date, index])));
}

const currentRules = JSON.parse(readFileSync(path.join(root, "config/rules.json"), "utf8")) as Rules;

function sharesFor(rulesHash: string): number {
  const archived = path.join(root, "data/history/rules", `${rulesHash}.json`);
  if (existsSync(archived)) {
    return (JSON.parse(readFileSync(archived, "utf8")) as Rules).defaultShares;
  }

  return currentRules.defaultShares;
}

interface AnalyzedSignal {
  snapshotDate: string;
  rulesHash: string;
  candidate: SlimCandidate;
  /** そのスナップショット日の地合い(旧スナップショットは market が無いため null) */
  marketRegimeOk: boolean | null;
  fwd5: number | null;
  fwd20: number | null;
  trade: SimulatedTrade | null;
}

const analyzed: AnalyzedSignal[] = [];
let uncovered = 0;
let missingFields = 0;

for (const file of snapshotFiles) {
  const snapshot = JSON.parse(readFileSync(path.join(signalsDir, file), "utf8")) as SignalSnapshot;

  // 旧形式スナップショットには存在しないフィールドをnullに正規化する(undefinedのままCSVに落ちるのを防ぐ)
  for (const candidate of snapshot.candidates) {
    candidate.atr ??= null;
    candidate.stopDistanceAtr ??= null;
    candidate.volumeRatio ??= null;
    candidate.suggestedShares ??= null;
    candidate.positionCost ??= null;
    candidate.nextEarningsDate ??= null;
    candidate.daysToEarnings ??= null;
  }

  // 旧スナップショットに market フィールドは無い → ?? null で吸収(不明扱い)
  const marketRegimeOk = snapshot.market?.regimeOk ?? null;

  const targets = snapshot.candidates.filter(
    (candidate) => (candidate.status === "buy_candidate" || candidate.status === "watch") && candidate.date === snapshot.snapshotDate
  );

  // 同一銘柄が複数テーマに登録されている場合はthemeScore最大の1行に絞る（二重カウント防止）
  const byCode = new Map<string, SlimCandidate>();
  for (const candidate of targets) {
    const existing = byCode.get(candidate.code);
    if (
      existing === undefined ||
      candidate.themeScore > existing.themeScore ||
      (candidate.themeScore === existing.themeScore && candidate.individualScore > existing.individualScore)
    ) {
      byCode.set(candidate.code, candidate);
    }
  }

  const fallbackShares = sharesFor(snapshot.rulesHash);

  for (const candidate of byCode.values()) {
    // riskモードのスナップショットは推奨株数を持つ。旧形式・fixedモードはルール版のdefaultShares
    const shares =
      candidate.suggestedShares !== null && candidate.suggestedShares > 0 ? candidate.suggestedShares : fallbackShares;
    const rows = rowsByCode.get(candidate.code);
    const index = indexByCode.get(candidate.code)?.get(snapshot.snapshotDate);

    if (rows === undefined || index === undefined) {
      uncovered += 1;
      continue;
    }

    const closes = rows.map((row) => row.close);
    const fwd5 = forwardReturn(closes, index, 5);
    const fwd20 = forwardReturn(closes, index, 20);

    let trade: SimulatedTrade | null = null;
    if (
      candidate.entryPrice !== null &&
      candidate.entryUpperPrice !== null &&
      candidate.stopLoss !== null &&
      candidate.takeProfit1 !== null &&
      candidate.exitMode !== null
    ) {
      trade = simulateTrade({
        signal: {
          entryPrice: candidate.entryPrice,
          entryUpperPrice: candidate.entryUpperPrice,
          takeProfit1: candidate.takeProfit1,
          stopLossSignal: candidate.stopLoss,
          exitMode: candidate.exitMode
        },
        signalDayLow: rows[index].low,
        forwardBars: rows.slice(index + 1),
        closesUpToSignal: closes.slice(Math.max(0, index - TRAIL_CLOSES_LOOKBACK + 1), index + 1),
        options: { maxHoldDays, stopMode, shares }
      });
    } else {
      missingFields += 1;
    }

    analyzed.push({ snapshotDate: snapshot.snapshotDate, rulesHash: snapshot.rulesHash, candidate, marketRegimeOk, fwd5, fwd20, trade });
  }
}

function forwardReturn(closes: number[], index: number, days: number): number | null {
  const base = closes[index];
  const future = closes[index + days];
  if (future === undefined || base === 0) {
    return null;
  }

  return (future - base) / base;
}

const outDir = path.resolve(root, args.out!);
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "signal_performance.csv"), performanceCsv(analyzed));

printSummary();

function performanceCsv(records: AnalyzedSignal[]): string {
  const headers = [
    "snapshotDate", "code", "name", "theme", "status", "individualScore", "themeScore", "rewardR", "exitMode", "rulesHash",
    "fwd5", "fwd20", "filled", "noFillReason", "entryDate", "entryFillPrice", "exitDate", "exitPrice", "exitReason",
    "holdDays", "pnlYen", "rMultiple", "suggestedShares", "stopDistanceAtr", "volumeRatio", "marketRegimeOk", "daysToEarnings"
  ];

  const lines = records.map((record) =>
    [
      record.snapshotDate,
      record.candidate.code,
      record.candidate.name,
      record.candidate.theme,
      record.candidate.status,
      record.candidate.individualScore,
      record.candidate.themeScore,
      record.candidate.rewardR === null ? "" : record.candidate.rewardR.toFixed(3),
      record.candidate.exitMode ?? "",
      record.rulesHash,
      record.fwd5 === null ? "" : record.fwd5.toFixed(4),
      record.fwd20 === null ? "" : record.fwd20.toFixed(4),
      record.trade?.filled ?? "",
      record.trade?.noFillReason ?? "",
      record.trade?.entryDate ?? "",
      record.trade?.entryFillPrice ?? "",
      record.trade?.exitDate ?? "",
      record.trade?.exitPrice ?? "",
      record.trade?.exitReason ?? "",
      record.trade?.holdDays ?? "",
      record.trade?.pnlYen === undefined || record.trade === null ? "" : Math.round(record.trade.pnlYen),
      record.trade?.rMultiple === undefined || record.trade === null ? "" : record.trade.rMultiple.toFixed(3),
      record.candidate.suggestedShares ?? "",
      record.candidate.stopDistanceAtr === null ? "" : record.candidate.stopDistanceAtr.toFixed(3),
      record.candidate.volumeRatio === null ? "" : record.candidate.volumeRatio.toFixed(3),
      record.marketRegimeOk === null ? "" : record.marketRegimeOk,
      record.candidate.daysToEarnings ?? ""
    ]
      .map(csvCell)
      .join(",")
  );

  return [headers.join(","), ...lines, ""].join("\n");
}

function summaryRows(records: AnalyzedSignal[]): string[] {
  const simulated = records.filter((record) => record.trade !== null).map((record) => ({ trade: record.trade! }));
  const stats = computeTradeStats(simulated);

  return [
    String(records.length),
    `${stats.fills}/${stats.signals} (${pct(stats.fillRate)})`,
    pct(stats.winRate),
    num(stats.expectancyR),
    yen(stats.expectancyYen),
    pct(meanOf(records.map((record) => record.fwd5))),
    pct(positiveRateOf(records.map((record) => record.fwd5))),
    pct(meanOf(records.map((record) => record.fwd20)))
  ];
}

function printSummary(): void {
  const dates = analyzed.map((record) => record.snapshotDate);
  const first = dates[0] ?? "-";
  const last = dates[dates.length - 1] ?? "-";

  console.log(`\n# シグナル履歴の成績分析 (スナップショット${snapshotFiles.length}件: ${first} 〜 ${last})`);
  console.log(`stopMode: ${stopMode} / maxHoldDays: ${maxHoldDays} / 価格データ: ${args.prices}`);

  if (uncovered > 0) {
    console.error(
      `warning: 価格データの範囲外で除外したシグナルが ${uncovered} 件あります。` +
        "prices.csv は1年ローリングのため、古い履歴には --prices data/prices_backtest.csv (2年分) を使ってください。"
    );
  }

  if (missingFields > 0) {
    console.error(`warning: エントリー情報が欠けていてシミュレーションできないシグナルが ${missingFields} 件あります。`);
  }

  const headers = ["区分", "シグナル", "約定/対象 (約定率)", "勝率", "期待値R", "期待値(円)", "fwd5平均", "fwd5プラス率", "fwd20平均"];

  console.log("\n## status別");
  const statusOrder: Record<string, number> = { buy_candidate: 0, watch: 1 };
  const byStatus = Array.from(groupBy(analyzed, (record) => record.candidate.status).entries()).sort(
    (a, b) => (statusOrder[a[0]] ?? 9) - (statusOrder[b[0]] ?? 9)
  );
  console.log(formatTable(headers, byStatus.map(([status, group]) => [status, ...summaryRows(group)])));

  console.log("\n## ルール版(rulesHash)別");
  const byRules = Array.from(groupBy(analyzed, (record) => record.rulesHash).entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  console.log(formatTable(headers, byRules.map(([hash, group]) => [hash, ...summaryRows(group)])));

  console.log("\n## status × 地合い(OK/NG/不明)別");
  const buyAndWatch = analyzed.filter(
    (record) => record.candidate.status === "buy_candidate" || record.candidate.status === "watch"
  );
  const byStatusRegime = Array.from(
    groupBy(buyAndWatch, (record) => `${record.candidate.status} × ${marketRegimeBand(record.marketRegimeOk)}`).entries()
  ).sort((a, b) => a[0].localeCompare(b[0]));
  console.log(formatTable(headers, byStatusRegime.map(([key, group]) => [key, ...summaryRows(group)])));

  console.log(`\n出力: ${path.relative(root, outDir)}/signal_performance.csv`);
}
