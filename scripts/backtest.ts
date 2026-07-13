import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { CohortRecord, runBacktest, ThemeDayRecord, TradeRecord } from "../lib/backtest/engine";
import {
  computeTradeStats,
  csvCell,
  EARNINGS_BANDS,
  earningsBand,
  formatTable,
  groupBy,
  individualScoreBand,
  MARKET_REGIME_BANDS,
  marketRegimeBand,
  meanOf,
  num,
  pct,
  positiveRateOf,
  STOP_ATR_BANDS,
  stopAtrBand,
  THEME_SCORE_BANDS,
  themeScoreBand,
  TradeStats,
  VOLUME_RATIO_BANDS,
  volumeRatioBand,
  yen
} from "../lib/backtest/report";
import { StopMode } from "../lib/backtest/simulate";
import { toEarningsRows, toPriceRows, toWatchlistRows } from "../lib/csv";
import { rulesHashOf } from "../lib/snapshot";
import { CandidateStatus, QualityFilterMode, Rules, SizingMode, ThemeScoringMode, ThemeStatus } from "../lib/types";

const CAVEATS = [
  "選択バイアス: 現在のウォッチリストは後知恵でテーマを選んでいるため、絶対値の成績は楽観的に出る。ルール間の相対比較に使うこと。",
  "日足近似: 5分足の下げ止まり確認や9:30-10:00の執行タイミングは再現していない。",
  "同日に損切りと利確の両方が成立した場合は損切り扱い(保守的仮定。成績を悲観方向に歪める)。",
  "分割調整済み価格を推奨(--auto-adjust)。本番のprices.csvは未調整のため円額は参考値。",
  "本番の場中実行は当日部分バーで評価するが、バックテストは確定日足で評価する(前日引け後評価→翌朝執行の近似)。"
];

const args = parseArgs({
  options: {
    prices: { type: "string", default: "data/prices_backtest.csv" },
    from: { type: "string" },
    to: { type: "string" },
    statuses: { type: "string", default: "buy_candidate" },
    "max-hold-days": { type: "string", default: "30" },
    "stop-mode": { type: "string", default: "prev-day" },
    // rules.json を編集せずにA/B比較するためのオーバーライド(未指定時はrules.jsonの値)
    sizing: { type: "string" },
    "stop-tight-filter": { type: "string" },
    "volume-filter": { type: "string" },
    "market-filter": { type: "string" },
    "earnings-filter": { type: "string" },
    "theme-scoring": { type: "string" },
    earnings: { type: "string", default: "data/earnings.csv" },
    out: { type: "string", default: "data/backtest" }
  }
}).values;

const root = process.cwd();
const pricesPath = path.resolve(root, args.prices!);

if (!existsSync(pricesPath)) {
  console.error(`価格データが見つかりません: ${args.prices}`);
  console.error("先に以下でバックテスト用データを取得してください:");
  console.error("  python3 scripts/fetch_prices.py --period 2y --output data/prices_backtest.csv --no-intraday --auto-adjust");
  process.exit(1);
}

const stopMode = args["stop-mode"] as StopMode;
if (stopMode !== "prev-day" && stopMode !== "signal") {
  console.error(`--stop-mode は prev-day か signal を指定してください: ${stopMode}`);
  process.exit(1);
}

const statuses = args.statuses!.split(",").map((status) => status.trim()) as CandidateStatus[];
const maxHoldDays = Number(args["max-hold-days"]);

const sizingOverride = args.sizing as SizingMode | undefined;
if (sizingOverride !== undefined && sizingOverride !== "fixed" && sizingOverride !== "risk") {
  console.error(`--sizing は fixed か risk を指定してください: ${sizingOverride}`);
  process.exit(1);
}

function filterModeOf(value: string | undefined, flag: string): QualityFilterMode | undefined {
  if (value === undefined) return undefined;
  if (value !== "off" && value !== "flag" && value !== "exclude") {
    console.error(`${flag} は off / flag / exclude を指定してください: ${value}`);
    process.exit(1);
  }
  return value;
}

const stopTightOverride = filterModeOf(args["stop-tight-filter"], "--stop-tight-filter");
const volumeOverride = filterModeOf(args["volume-filter"], "--volume-filter");
const marketOverride = filterModeOf(args["market-filter"], "--market-filter");
const earningsOverride = filterModeOf(args["earnings-filter"], "--earnings-filter");

const themeScoringOverride = args["theme-scoring"] as ThemeScoringMode | undefined;
if (themeScoringOverride !== undefined && themeScoringOverride !== "binary" && themeScoringOverride !== "continuous") {
  console.error(`--theme-scoring は binary か continuous を指定してください: ${themeScoringOverride}`);
  process.exit(1);
}

const rawRules = readFileSync(path.join(root, "config/rules.json"), "utf8");
const rules: Rules = {
  ...(JSON.parse(rawRules) as Rules),
  ...(sizingOverride !== undefined ? { sizingMode: sizingOverride } : {}),
  ...(stopTightOverride !== undefined ? { stopTightFilterMode: stopTightOverride } : {}),
  ...(volumeOverride !== undefined ? { volumeFilterMode: volumeOverride } : {}),
  ...(marketOverride !== undefined ? { marketFilterMode: marketOverride } : {}),
  ...(earningsOverride !== undefined ? { earningsFilterMode: earningsOverride } : {}),
  ...(themeScoringOverride !== undefined ? { themeScoringMode: themeScoringOverride } : {})
};
const watchlist = toWatchlistRows(readFileSync(path.join(root, "data/watchlist.csv"), "utf8"));
const prices = toPriceRows(readFileSync(pricesPath, "utf8"));

// data/earnings.csv はオプショナル(未作成なら空)。存在すれば決算日フィルターに使う
const earningsPath = path.resolve(root, args.earnings!);
const earnings = existsSync(earningsPath) ? toEarningsRows(readFileSync(earningsPath, "utf8")) : [];

// 市場指標の行が無いと地合いフィルター・レジーム集計は不発になる(既存 prices_backtest.csv には1306が無い)
if (!prices.some((row) => row.code === rules.marketIndexCode)) {
  console.error(
    `warning: 価格データに市場指標(${rules.marketIndexCode})の行がありません。` +
      "地合いフィルター・レジーム集計は不発になります。fetch_prices.py で再取得してください。"
  );
}

const result = runBacktest(watchlist, prices, rules, {
  from: args.from,
  to: args.to,
  maxHoldDays,
  stopMode,
  statuses,
  earnings
});

if (result.evaluatedDays.length === 0) {
  console.error(
    "warning: 評価対象の営業日がありません。デフォルトはウォームアップ252営業日+フォワード21営業日を確保するため、" +
      "2年分の価格データ(--period 2y)を使うか、--from/--to で期間を明示してください。"
  );
}

const outDir = path.resolve(root, args.out!);
mkdirSync(outDir, { recursive: true });

writeFileSync(path.join(outDir, "trades.csv"), tradesCsv(result.trades));
writeFileSync(path.join(outDir, "cohorts.json"), `${JSON.stringify(result.cohorts, null, 2)}\n`);

const overall = computeTradeStats(result.trades);
const summary = {
  params: {
    prices: args.prices,
    from: result.evaluatedDays[0] ?? null,
    to: result.evaluatedDays[result.evaluatedDays.length - 1] ?? null,
    statuses,
    maxHoldDays,
    stopMode,
    sizingMode: rules.sizingMode,
    stopTightFilterMode: rules.stopTightFilterMode,
    volumeFilterMode: rules.volumeFilterMode,
    marketFilterMode: rules.marketFilterMode,
    marketIndexCode: rules.marketIndexCode,
    earningsFilterMode: rules.earningsFilterMode,
    themeScoringMode: rules.themeScoringMode,
    lotSize: rules.lotSize,
    maxPositionYen: rules.maxPositionYen,
    defaultShares: rules.defaultShares,
    rulesHash: rulesHashOf(rawRules)
  },
  overall,
  skippedOpenPosition: result.skippedOpenPosition,
  evaluatedDayCount: result.evaluatedDays.length,
  breakdowns: {
    theme: breakdown(result.trades, (record) => record.theme),
    exitMode: breakdown(result.trades, (record) => record.exitMode),
    exitReason: breakdown(result.trades, (record) => record.trade.exitReason ?? `no_fill:${record.trade.noFillReason}`),
    individualScoreBand: breakdown(result.trades, (record) => individualScoreBand(record.individualScore)),
    // 連続テーマスコアでは離散値でのグループ化が破綻するため閾値(60/80/90)境界のバンドで集計する
    themeScoreBand: bandBreakdown(result.trades, (record) => themeScoreBand(record.themeScore), THEME_SCORE_BANDS),
    month: breakdown(result.trades, (record) => record.signalDate.slice(0, 7), "key"),
    stopAtrBand: bandBreakdown(result.trades, (record) => stopAtrBand(record.stopDistanceAtr), STOP_ATR_BANDS),
    volumeRatioBand: bandBreakdown(result.trades, (record) => volumeRatioBand(record.volumeRatio), VOLUME_RATIO_BANDS),
    marketRegime: bandBreakdown(result.trades, (record) => marketRegimeBand(record.marketRegimeOk), MARKET_REGIME_BANDS),
    earningsProximity: bandBreakdown(result.trades, (record) => earningsBand(record.daysToEarnings), EARNINGS_BANDS)
  },
  cohorts: cohortSummary(result.cohorts),
  // 執行モデル非依存の検証: バンド別のフォワードリターンで閾値(0.3 / 0.85)の妥当性を直接読む
  cohortsByBand: {
    stopAtr: {
      buy_candidate: cohortBandSummary(result.cohorts, "buy_candidate", (record) => stopAtrBand(record.stopDistanceAtr), STOP_ATR_BANDS),
      watch: cohortBandSummary(result.cohorts, "watch", (record) => stopAtrBand(record.stopDistanceAtr), STOP_ATR_BANDS)
    },
    volumeRatio: {
      buy_candidate: cohortBandSummary(result.cohorts, "buy_candidate", (record) => volumeRatioBand(record.volumeRatio), VOLUME_RATIO_BANDS),
      watch: cohortBandSummary(result.cohorts, "watch", (record) => volumeRatioBand(record.volumeRatio), VOLUME_RATIO_BANDS)
    },
    themeScore: {
      buy_candidate: cohortBandSummary(result.cohorts, "buy_candidate", (record) => themeScoreBand(record.themeScore), THEME_SCORE_BANDS),
      watch: cohortBandSummary(result.cohorts, "watch", (record) => themeScoreBand(record.themeScore), THEME_SCORE_BANDS)
    },
    // 本命: 執行モデル非依存で「地合いNG日の買い候補はその後のリターンが本当に悪いのか」を直接読む
    marketRegime: {
      buy_candidate: cohortBandSummary(result.cohorts, "buy_candidate", (record) => marketRegimeBand(record.marketRegimeOk), MARKET_REGIME_BANDS),
      watch: cohortBandSummary(result.cohorts, "watch", (record) => marketRegimeBand(record.marketRegimeOk), MARKET_REGIME_BANDS)
    },
    earningsProximity: {
      buy_candidate: cohortBandSummary(result.cohorts, "buy_candidate", (record) => earningsBand(record.daysToEarnings), EARNINGS_BANDS),
      watch: cohortBandSummary(result.cohorts, "watch", (record) => earningsBand(record.daysToEarnings), EARNINGS_BANDS)
    }
  },
  themeStability: themeStabilityOf(result.themeDays),
  caveats: CAVEATS
};

writeFileSync(path.join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

printReport();

function breakdown(
  records: TradeRecord[],
  keyOf: (record: TradeRecord) => string,
  order: "fills" | "key" = "fills"
): Record<string, TradeStats> {
  const entries = Array.from(groupBy(records, keyOf).entries())
    .map(([key, group]) => [key, computeTradeStats(group)] as const)
    .sort((a, b) =>
      order === "key" ? a[0].localeCompare(b[0], "ja") : b[1].fills - a[1].fills || a[0].localeCompare(b[0], "ja")
    );

  return Object.fromEntries(entries);
}

/** バンド別内訳。バンド定義の順で表示する(fills順や辞書順では境界の意味が読めないため) */
function bandBreakdown(
  records: TradeRecord[],
  keyOf: (record: TradeRecord) => string,
  bandOrder: readonly string[]
): Record<string, TradeStats> {
  const entries = Array.from(groupBy(records, keyOf).entries())
    .map(([key, group]) => [key, computeTradeStats(group)] as const)
    .sort((a, b) => bandOrder.indexOf(a[0]) - bandOrder.indexOf(b[0]));

  return Object.fromEntries(entries);
}

interface CohortStats {
  count: number;
  fwd5Mean: number | null;
  fwd5PositiveRate: number | null;
  fwd20Mean: number | null;
  fwd20PositiveRate: number | null;
}

function cohortStatsOf(group: CohortRecord[]): CohortStats {
  return {
    count: group.length,
    fwd5Mean: meanOf(group.map((record) => record.fwd5)),
    fwd5PositiveRate: positiveRateOf(group.map((record) => record.fwd5)),
    fwd20Mean: meanOf(group.map((record) => record.fwd20)),
    fwd20PositiveRate: positiveRateOf(group.map((record) => record.fwd20))
  };
}

function cohortSummary(cohorts: CohortRecord[]): Record<string, CohortStats> {
  const entries = Array.from(groupBy(cohorts, (record) => record.status).entries()).map(
    ([status, group]) => [status, cohortStatsOf(group)] as const
  );

  const order: Record<string, number> = { buy_candidate: 0, watch: 1, avoid: 2 };
  entries.sort((a, b) => (order[a[0]] ?? 9) - (order[b[0]] ?? 9));
  return Object.fromEntries(entries);
}

function cohortBandSummary(
  cohorts: CohortRecord[],
  status: CandidateStatus,
  keyOf: (record: CohortRecord) => string,
  bandOrder: readonly string[]
): Record<string, CohortStats> {
  const entries = Array.from(groupBy(cohorts.filter((record) => record.status === status), keyOf).entries())
    .map(([band, group]) => [band, cohortStatsOf(group)] as const)
    .sort((a, b) => bandOrder.indexOf(a[0]) - bandOrder.indexOf(b[0]));

  return Object.fromEntries(entries);
}

interface ThemeStability {
  themeDayCount: number;
  statusFlips: number;
  /** status変化回数 / (テーマ数×営業日数) × 100。binary vs continuous の境界安定性比較の主指標 */
  flipsPer100Days: number;
  avgAbsDailyScoreChange: number;
  statusDistribution: Record<ThemeStatus, number>;
}

function themeStabilityOf(themeDays: ThemeDayRecord[]): ThemeStability {
  const statusDistribution: Record<ThemeStatus, number> = { strong: 0, watch: 0, weak: 0 };
  let statusFlips = 0;
  let scoreChangeTotal = 0;
  let transitions = 0;

  for (const rows of groupBy(themeDays, (record) => record.theme).values()) {
    const ordered = rows.slice().sort((a, b) => a.date.localeCompare(b.date));
    ordered.forEach((row, index) => {
      statusDistribution[row.status] += 1;
      if (index === 0) {
        return;
      }

      const previous = ordered[index - 1];
      if (row.status !== previous.status) {
        statusFlips += 1;
      }
      scoreChangeTotal += Math.abs(row.themeScore - previous.themeScore);
      transitions += 1;
    });
  }

  return {
    themeDayCount: themeDays.length,
    statusFlips,
    flipsPer100Days: themeDays.length > 0 ? (statusFlips / themeDays.length) * 100 : 0,
    avgAbsDailyScoreChange: transitions > 0 ? scoreChangeTotal / transitions : 0,
    statusDistribution
  };
}

function tradesCsv(records: TradeRecord[]): string {
  const headers = [
    "signalDate", "code", "name", "theme", "status", "individualScore", "themeScore", "exitMode",
    "rewardR", "stopUsed", "filled", "noFillReason", "entryDate", "entryFillPrice",
    "exitDate", "exitPrice", "exitReason", "holdDays", "pnlYen", "rMultiple",
    "shares", "stopDistanceAtr", "volumeRatio", "marketRegimeOk", "daysToEarnings"
  ];

  const lines = records.map((record) =>
    [
      record.signalDate,
      record.code,
      record.name,
      record.theme,
      record.status,
      record.individualScore,
      record.themeScore,
      record.exitMode,
      record.rewardR === null ? "" : record.rewardR.toFixed(3),
      record.trade.stopUsed,
      record.trade.filled,
      record.trade.noFillReason ?? "",
      record.trade.entryDate ?? "",
      record.trade.entryFillPrice ?? "",
      record.trade.exitDate ?? "",
      record.trade.exitPrice ?? "",
      record.trade.exitReason ?? "",
      record.trade.holdDays ?? "",
      record.trade.pnlYen === undefined ? "" : Math.round(record.trade.pnlYen),
      record.trade.rMultiple === undefined ? "" : record.trade.rMultiple.toFixed(3),
      record.shares,
      record.stopDistanceAtr === null ? "" : record.stopDistanceAtr.toFixed(3),
      record.volumeRatio === null ? "" : record.volumeRatio.toFixed(3),
      record.marketRegimeOk === null ? "" : record.marketRegimeOk,
      record.daysToEarnings === null ? "" : record.daysToEarnings
    ]
      .map(csvCell)
      .join(",")
  );

  return [headers.join(","), ...lines, ""].join("\n");
}

function statsRow(label: string, stats: TradeStats): string[] {
  return [
    label,
    `${stats.fills}/${stats.signals}`,
    pct(stats.winRate),
    num(stats.expectancyR),
    yen(stats.expectancyYen),
    yen(stats.totalPnlYen)
  ];
}

function printBreakdown(title: string, records: Record<string, TradeStats>): void {
  console.log(`\n## ${title}`);
  console.log(
    formatTable(
      ["区分", "約定/シグナル", "勝率", "期待値R", "期待値(円)", "累積損益"],
      Object.entries(records).map(([key, stats]) => statsRow(key, stats))
    )
  );
}

function printCohortBands(title: string, records: Record<string, CohortStats>): void {
  console.log(`\n## コホート: ${title}`);
  console.log(
    formatTable(
      ["バンド", "件数", "5日後平均", "5日後プラス率", "20日後平均", "20日後プラス率"],
      Object.entries(records).map(([band, stats]) => [
        band,
        String(stats.count),
        pct(stats.fwd5Mean),
        pct(stats.fwd5PositiveRate),
        pct(stats.fwd20Mean),
        pct(stats.fwd20PositiveRate)
      ])
    )
  );
}

function printReport(): void {
  console.log(`\n# バックテスト結果 (${summary.params.from} 〜 ${summary.params.to}, ${result.evaluatedDays.length}営業日)`);
  console.log(
    `対象status: ${statuses.join(", ")} / stopMode: ${stopMode} / maxHoldDays: ${maxHoldDays} / rules: ${summary.params.rulesHash}`
  );
  console.log(
    `sizing: ${rules.sizingMode} / stopTightFilter: ${rules.stopTightFilterMode} / volumeFilter: ${rules.volumeFilterMode}` +
      ` / marketFilter: ${rules.marketFilterMode}(${rules.marketIndexCode}) / earningsFilter: ${rules.earningsFilterMode}` +
      ` / themeScoring: ${rules.themeScoringMode}` +
      (rules.maxPositionYen !== null ? ` / maxPositionYen: ${rules.maxPositionYen.toLocaleString("ja-JP")}円` : "")
  );

  console.log("\n## 全体");
  console.log(
    formatTable(
      ["指標", "値"],
      [
        ["シグナル数", String(overall.signals)],
        ["約定数(約定率)", `${overall.fills} (${pct(overall.fillRate)})`],
        ["勝率", pct(overall.winRate)],
        ["平均勝ちR", num(overall.avgWinR)],
        ["平均負けR", num(overall.avgLossR)],
        ["期待値R", num(overall.expectancyR)],
        ["期待値(円/トレード)", yen(overall.expectancyYen)],
        ["プロフィットファクター", num(overall.profitFactor)],
        ["累積損益", yen(overall.totalPnlYen)],
        ["最大ドローダウン", yen(overall.maxDrawdownYen)],
        ["平均保有日数", num(overall.avgHoldDays, 1)],
        ["同一銘柄保有中でスキップ", String(result.skippedOpenPosition)]
      ]
    )
  );

  printBreakdown("テーマ別", summary.breakdowns.theme);
  printBreakdown("exitMode別", summary.breakdowns.exitMode);
  printBreakdown("決済理由別", summary.breakdowns.exitReason);
  printBreakdown("個別スコア帯別", summary.breakdowns.individualScoreBand);
  printBreakdown("テーマスコア帯別", summary.breakdowns.themeScoreBand);
  printBreakdown("月別", summary.breakdowns.month);
  printBreakdown("損切り幅ATRバンド別", summary.breakdowns.stopAtrBand);
  printBreakdown("出来高比バンド別", summary.breakdowns.volumeRatioBand);
  printBreakdown("地合い(市場レジーム)別", summary.breakdowns.marketRegime);
  printBreakdown("決算接近バンド別", summary.breakdowns.earningsProximity);

  console.log("\n## コホート比較（status別フォワードリターン。執行モデルなしの素の値動き）");
  console.log(
    formatTable(
      ["status", "件数", "5日後平均", "5日後プラス率", "20日後平均", "20日後プラス率"],
      Object.entries(summary.cohorts).map(([status, stats]) => [
        status,
        String(stats.count),
        pct(stats.fwd5Mean),
        pct(stats.fwd5PositiveRate),
        pct(stats.fwd20Mean),
        pct(stats.fwd20PositiveRate)
      ])
    )
  );

  printCohortBands("損切り幅ATRバンド (buy_candidate)", summary.cohortsByBand.stopAtr.buy_candidate);
  printCohortBands("損切り幅ATRバンド (watch)", summary.cohortsByBand.stopAtr.watch);
  printCohortBands("出来高比バンド (buy_candidate)", summary.cohortsByBand.volumeRatio.buy_candidate);
  printCohortBands("出来高比バンド (watch)", summary.cohortsByBand.volumeRatio.watch);
  printCohortBands("テーマスコア帯 (buy_candidate)", summary.cohortsByBand.themeScore.buy_candidate);
  printCohortBands("テーマスコア帯 (watch)", summary.cohortsByBand.themeScore.watch);
  printCohortBands("地合い (buy_candidate)", summary.cohortsByBand.marketRegime.buy_candidate);
  printCohortBands("地合い (watch)", summary.cohortsByBand.marketRegime.watch);
  printCohortBands("決算接近 (buy_candidate)", summary.cohortsByBand.earningsProximity.buy_candidate);
  printCohortBands("決算接近 (watch)", summary.cohortsByBand.earningsProximity.watch);

  const stability = summary.themeStability;
  console.log(`\n## テーマ安定性 (themeScoringMode: ${rules.themeScoringMode})`);
  console.log(
    formatTable(
      ["指標", "値"],
      [
        ["テーマ×営業日", String(stability.themeDayCount)],
        ["status変化回数", String(stability.statusFlips)],
        ["100テーマ日あたりの変化", num(stability.flipsPer100Days)],
        ["日次スコア変化(平均絶対値)", num(stability.avgAbsDailyScoreChange)],
        [
          "strong/watch/weak日数",
          `${stability.statusDistribution.strong} / ${stability.statusDistribution.watch} / ${stability.statusDistribution.weak}`
        ]
      ]
    )
  );

  console.log("\n## 注意事項");
  for (const caveat of CAVEATS) {
    console.log(`- ${caveat}`);
  }

  console.log(`\n出力: ${path.relative(root, outDir)}/trades.csv, summary.json, cohorts.json`);
}
