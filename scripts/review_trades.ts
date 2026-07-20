import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { csvCell, formatTable, num, pct, yen } from "../lib/backtest/report";
import { StopMode } from "../lib/backtest/simulate";
import { toExecutionRows, toPriceRows } from "../lib/csv";
import { SignalSnapshot } from "../lib/snapshot";
import {
  DEFAULT_REVIEW_OPTIONS,
  LotReview,
  monthlyReviews,
  pairExecutions,
  reviewClosedLot,
  reviewOpenLot,
  ReviewOptions
} from "../lib/tradeReview";
import { PriceRow } from "../lib/types";

const CAVEATS = [
  "手数料・税は含まない(バックテストと整合)。",
  "仮想成績はシグナル日の翌営業日執行の日足近似で、バックテストと同じ制約(5分足の下げ止まり確認は再現しない等)を持つ。",
  "同一銘柄が複数テーマに登録されている場合はthemeScore最大の行で突き合わせる(バックテスト・履歴分析と同じ規則)。",
  "prices.csvは1年ローリングのため、古い売買のレビューには --prices data/prices_backtest.csv (2年分) を使うこと。"
];

const args = parseArgs({
  options: {
    executions: { type: "string", default: "data/trades/executions.csv" },
    prices: { type: "string", default: "data/prices.csv" },
    month: { type: "string" },
    "lookback-days": { type: "string", default: String(DEFAULT_REVIEW_OPTIONS.lookbackDays) },
    "stop-tolerance": { type: "string", default: String(DEFAULT_REVIEW_OPTIONS.stopTolerance) },
    "max-hold-days": { type: "string", default: String(DEFAULT_REVIEW_OPTIONS.maxHoldDays) },
    "stop-mode": { type: "string", default: DEFAULT_REVIEW_OPTIONS.stopMode },
    out: { type: "string", default: "data/analysis" }
  }
}).values;

const root = process.cwd();

const stopMode = args["stop-mode"] as StopMode;
if (stopMode !== "prev-day" && stopMode !== "signal") {
  console.error(`--stop-mode は prev-day か signal を指定してください: ${stopMode}`);
  process.exit(1);
}

if (args.month !== undefined && !/^\d{4}-\d{2}$/.test(args.month)) {
  console.error(`--month は YYYY-MM 形式で指定してください: ${args.month}`);
  process.exit(1);
}

const options: ReviewOptions = {
  lookbackDays: Number(args["lookback-days"]),
  stopTolerance: Number(args["stop-tolerance"]),
  maxHoldDays: Number(args["max-hold-days"]),
  stopMode
};

// ---- 約定記録 ----

const executionsPath = path.resolve(root, args.executions!);
if (!existsSync(executionsPath)) {
  console.log(`約定記録がありません: ${args.executions}`);
  printHowToRecord();
  process.exit(0);
}

const executions = toExecutionRows(readFileSync(executionsPath, "utf8"));
if (executions.length === 0) {
  console.log(`約定記録が0件です: ${args.executions}`);
  printHowToRecord();
  process.exit(0);
}

// ---- 価格データ・シグナル履歴 ----

const pricesPath = path.resolve(root, args.prices!);
if (!existsSync(pricesPath)) {
  console.error(`価格データが見つかりません: ${args.prices}`);
  process.exit(1);
}

const pricesByCode = new Map<string, PriceRow[]>();
for (const row of toPriceRows(readFileSync(pricesPath, "utf8"))) {
  const bucket = pricesByCode.get(row.code) ?? [];
  bucket.push(row);
  pricesByCode.set(row.code, bucket);
}
for (const rows of pricesByCode.values()) {
  rows.sort((a, b) => a.date.localeCompare(b.date));
}

const snapshotsByDate = new Map<string, SignalSnapshot>();
const signalsDir = path.join(root, "data/history/signals");
if (existsSync(signalsDir)) {
  for (const file of readdirSync(signalsDir).filter((name) => name.endsWith(".json")).sort()) {
    const snapshot = JSON.parse(readFileSync(path.join(signalsDir, file), "utf8")) as SignalSnapshot;
    snapshotsByDate.set(snapshot.snapshotDate, snapshot);
  }
} else {
  console.error("warning: data/history/signals がありません。全トレードが no_signal_data になります。");
}

// ---- レビュー ----

const { closed, open } = pairExecutions(executions);
const closedFiltered = args.month === undefined ? closed : closed.filter((lot) => lot.sellDate.startsWith(args.month!));
const reviews = closedFiltered.map((lot) => reviewClosedLot(lot, snapshotsByDate, pricesByCode, options));
const openReviews = open.map((lot) => reviewOpenLot(lot, snapshotsByDate, pricesByCode, options));

const outDir = path.resolve(root, args.out!);
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "trade_review.csv"), reviewCsv(reviews));

printReport();

// ---- 出力 ----

function reviewCsv(records: LotReview[]): string {
  const headers = [
    "buyDate", "code", "name", "shares", "buyPrice", "sellDate", "sellPrice", "holdDays", "actualPnlYen",
    "signalDate", "signalStatus", "entryPrice", "entryUpperPrice", "stopLoss", "takeProfit1", "suggestedShares",
    "entrySlippagePct", "flags", "virtualExitDate", "virtualExitReason", "virtualPnlYen", "executionGapYen"
  ];

  const lines = records.map((record) => {
    const candidate = record.match?.candidate ?? null;
    return [
      record.lot.buyDate,
      record.lot.code,
      candidate?.name ?? "",
      record.lot.shares,
      record.lot.buyPrice,
      record.lot.sellDate,
      record.lot.sellPrice,
      record.holdDays ?? "",
      Math.round(record.lot.pnlYen),
      record.match?.snapshotDate ?? "",
      candidate?.status ?? "",
      candidate?.entryPrice?.toFixed(1) ?? "",
      candidate?.entryUpperPrice?.toFixed(1) ?? "",
      // 逸脱判定(late_stop/over_sized)と同じドクトリン基準。旧スナップショットはD-1安値基準にフォールバック
      candidate?.signalDayLow ?? candidate?.stopLoss ?? "",
      candidate?.takeProfit1 ?? "",
      candidate?.orderShares ?? candidate?.suggestedShares ?? "",
      record.entrySlippagePct === null ? "" : record.entrySlippagePct.toFixed(4),
      record.flags.join(";"),
      record.virtual?.exitDate ?? "",
      record.virtual?.filled === false ? `no_fill:${record.virtual.noFillReason}` : record.virtual?.exitReason ?? "",
      record.virtualPnlYen === null ? "" : Math.round(record.virtualPnlYen),
      record.executionGapYen === null ? "" : Math.round(record.executionGapYen)
    ]
      .map(csvCell)
      .join(",");
  });

  return [headers.join(","), ...lines, ""].join("\n");
}

function printHowToRecord(): void {
  console.log("\ndata/trades/executions.csv に1行=1約定で記録してください:");
  console.log("  executedAt,code,side,price,shares,memo");
  console.log("  2026-07-10,5803,buy,6210,100,寄り後に指値で約定");
  console.log("  2026-07-15,5803,sell,6580,100,第1利確");
}

function printReport(): void {
  const monthLabel = args.month === undefined ? "全期間" : args.month;
  console.log(`\n# 売買レビュー (${monthLabel}: 決済済み${reviews.length}ロット / オープン${openReviews.length}ロット)`);
  console.log(
    `executions: ${args.executions} / prices: ${args.prices} / スナップショット: ${snapshotsByDate.size}件 / ` +
      `lookback: ${options.lookbackDays}日 / stopTolerance: ${pct(options.stopTolerance)}`
  );

  if (reviews.length > 0) {
    console.log("\n## トレード別(決済済み)");
    console.log(
      formatTable(
        ["買い日", "銘柄", "株数", "シグナル日", "status", "スリッページ", "実現損益", "仮想損益", "差(実-仮想)", "フラグ"],
        reviews.map((record) => [
          record.lot.buyDate,
          `${record.lot.code} ${record.match?.candidate?.name ?? ""}`.trim(),
          String(record.lot.shares),
          record.match?.snapshotDate ?? "-",
          record.match?.candidate?.status ?? "-",
          record.entrySlippagePct === null ? "-" : pct(record.entrySlippagePct, 2),
          yen(record.lot.pnlYen),
          record.virtualPnlYen === null ? "-" : yen(record.virtualPnlYen),
          record.executionGapYen === null ? "-" : yen(record.executionGapYen),
          record.flags.join(";") || "-"
        ])
      )
    );

    console.log("\n## 月次サマリ(決済月ベース)");
    console.log(
      formatTable(
        ["月", "決済", "ルール内", "ルール外", "平均スリッページ", "実現損益", "仮想損益(対象数)", "執行差(実-仮想)"],
        monthlyReviews(reviews).map((row) => [
          row.month,
          String(row.closedLots),
          String(row.ruleCompliant),
          String(row.ruleViolations),
          row.avgEntrySlippagePct === null ? "-" : pct(row.avgEntrySlippagePct, 2),
          yen(row.actualPnlYen),
          row.virtualPnlYen === null ? "-" : `${yen(row.virtualPnlYen)} (${row.virtualCoveredLots})`,
          row.executionGapYen === null ? "-" : yen(row.executionGapYen)
        ])
      )
    );

    const flagCounts = new Map<string, number>();
    for (const record of reviews) {
      for (const flag of record.flags) {
        flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1);
      }
    }

    console.log("\n## 逸脱フラグ集計(決済済み)");
    if (flagCounts.size === 0) {
      console.log("フラグなし(全トレードがルール内)");
    } else {
      console.log(
        formatTable(
          ["フラグ", "件数"],
          Array.from(flagCounts.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([flag, count]) => [flag, String(count)])
        )
      );
    }
  }

  if (openReviews.length > 0) {
    console.log("\n## オープン建玉");
    console.log(
      formatTable(
        ["銘柄", "株数", "取得日", "取得単価", "最新終値", "含み損益", "損切りライン", "フラグ"],
        openReviews.map((record) => [
          `${record.lot.code} ${record.match?.candidate?.name ?? ""}`.trim(),
          String(record.lot.shares),
          record.lot.buyDate,
          num(record.lot.buyPrice, 1),
          record.lastClose === null ? "-" : num(record.lastClose, 1),
          record.unrealizedPnlYen === null ? "-" : yen(record.unrealizedPnlYen),
          record.stopLoss === null ? "-" : num(record.stopLoss, 1),
          record.flags.join(";") || "-"
        ])
      )
    );

    const belowStop = openReviews.filter((record) => record.flags.includes("holding_below_stop"));
    for (const record of belowStop) {
      console.error(
        `warning: ${record.lot.code} は損切りライン(${record.stopLoss})割れを保有中です。ドクトリンに従い決済を検討してください。`
      );
    }
  }

  console.log("\n## 注意事項");
  for (const caveat of CAVEATS) {
    console.log(`- ${caveat}`);
  }

  console.log(`\n出力: ${path.relative(root, outDir)}/trade_review.csv`);
}
