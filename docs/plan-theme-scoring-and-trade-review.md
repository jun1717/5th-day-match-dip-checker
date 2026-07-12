# 実装計画: テーマスコア連続値化 + 実際の売買とツールの突き合わせ

このドキュメントは、5日線押し目チェッカーに以下の2機能を追加するための実装計画である。実装者(AIエージェントを含む)がこのファイルだけを読んで作業を完遂できることを目的とする。

- **Part A+B(提案6): テーマスコアの連続値化** — 現状の4条件×二値×固定配点(0/20/30/50/70/80/100に飛び飛び)をやめ、各二値条件をその自然な連続量に置き換えた0〜100の連続スコアにする(Part A)。未使用だった20日騰落率を順位付けとスコアの両方に組み込む。既存のバックテスト基盤でbinary/continuousをA/B比較し、境界安定性(テーマstatusの日次フリップ)の改善を確認してから切り替える(Part B)。
- **Part C(提案7): 実際の売買とツールの突き合わせ** — 実際の約定(日付・価格・株数)を手動CSVに記録し、シグナル履歴スナップショット(`data/history/signals/`)と突き合わせて「スリッページ」「ルール逸脱」「ツール通りだった場合の仮想成績 vs 実成績」を月次で振り返るレビュー基盤を作る。

Part A+B と Part C は完全に独立しており、どちらを先に実装してもよい(並行も可)。

## 0. 前提知識(現状のアーキテクチャ)

`docs/plan-signal-logger-and-backtest.md` と `docs/plan-atr-sizing-and-volume.md` の前提知識セクションがすべて有効。本計画に特に関係する点だけ再掲する。

- 判定ロジックの唯一の実装は `lib/evaluator.ts` の `evaluateCandidates(watchlist, prices, rules, generatedAt)`。**ロジックの二重実装は禁止**。
- **テーマスコアの現状**: `lib/evaluator.ts` の `evaluateThemes` がテーマごとに `return5d`(テーマ内銘柄の5日騰落率平均)、`return20d`(同20日)、`leaderMa5AboveRatio` / `leaderMa25AboveRatio`(主役株の5日線/25日線維持率、主役株がいないテーマは全銘柄で代用)を集計し、**return5dの降順で rank を付け**、`lib/scoring.ts` の `scoreTheme` に渡す。`scoreTheme` は4つの二値条件×固定配点の合計:
  - `rank ≤ ceil(totalThemes × themeRankTopPercent(0.3))` → 30点
  - `leaderMa5AboveRatio ≥ 0.5` → 30点
  - `leaderMa25AboveRatio ≥ 0.5` → 20点
  - `return5d > 0` → 20点
  - **return20dは集計済みだがスコア・順位のどちらにも未使用**。
- テーマスコアの消費側: `themeStatus`(≥80 strong / ≥60 watch / それ未満 weak)、`classifyCandidate`(買い候補の条件 `themeScore ≥ themeBuyScoreThreshold(80)`、watchの条件に60)、`exitModeFor`(`≥ trendFollowThemeScoreThreshold(90)` でトレンドフォロー決済)、`computeProfitWarnings`、`bbWatch`(`bbThemeScoreThreshold(60)`)、複数テーマ登録銘柄のdedupe(themeScore最大の行を採用: `lib/backtest/engine.ts` と `scripts/analyze_signals.ts`)。
- 配点は `config/rules.json` の `scoring.theme`(30/30/20/20、合計100)。
- スナップショット: `lib/snapshot.ts` の `SignalSnapshot` は `candidates: SlimCandidate[]` と **`themeScores: ThemeScore[]` を丸ごと**保存する。`ThemeScore` にフィールドを足すと自動でスナップショットに載る(旧スナップショットには無いので読み手はundefined許容)。
- スナップショットは GitHub Actions が平日16:30 JST(確定日足)に `data/history/signals/YYYY-MM-DD.json` へ自動コミット。全statusの候補(avoid含む)が入っている。ルール版は `data/history/rules/<rulesHash>.json`。
- バックテスト: `lib/backtest/engine.ts`(日次ループ。`EngineResult { trades, cohorts, ... }`)+ `lib/backtest/report.ts`(統計・バンド関数・表示ヘルパー)+ `scripts/backtest.ts`(CLI。`--sizing` 等のrulesオーバーライドと `breakdowns` / `cohortsByBand` の前例あり)。現状 `breakdowns.themeScore` は `String(record.themeScore)` でグループ化しており、離散値だから成立している(連続値化で破綻する→Part Bで対応)。
- 約定シミュレーション: `lib/backtest/simulate.ts` の `simulateTrade({ signal, signalDayLow, forwardBars, closesUpToSignal, options: { maxHoldDays, stopMode, shares } })`。`scripts/analyze_signals.ts` がスナップショット+価格CSVから呼ぶ使用例あり(TRAIL_CLOSES_LOOKBACK=25、`stopMode: "prev-day"` 既定)。**Part Cはこれを再利用する。二重実装禁止**。
- CSV: `lib/csv.ts` の `parseCsv`(クォート対応)/ `normalizeCode`(数字コードは4桁ゼロ埋め)/ `toPriceRows` / `toWatchlistRows`。
- 運用ドクトリン: シグナルは大引け後(スナップショット日=D)に確定し、**執行は翌営業日D+1の9:30〜10:00**。買い基準価格(entryPrice)で指値、追いかけない。損切りは前日安値、第1利確は20日高値、テーマスコア90以上は5日線トレイル。
- テスト: `npm test`(node:test + tsx、`tests/*.test.ts`)。型チェック: `npm run typecheck`。
- 検証結果の記録場所: `docs/backtest-results/`(前例: `2026-07-atr-volume.md`)。

## 1. 設計方針(先に読む・重要な決定事項)

1. **「実装 → binary維持 → バックテスト検証 → continuous切替」の段階導入**。品質フィルターの off/flag/exclude と同じ思想で、テーマスコアは `rules.json` の `themeScoringMode: "binary" | "continuous"` で切り替える。**既定は `"binary"`(現行と完全同一の出力)** で実装し、Part Bの検証で採用基準を満たしたら独立コミットで `"continuous"` に切り替える。
2. **配点(30/30/20/20)と閾値(80/60/90)は変えない**。連続値化は「各二値条件を、その条件が測ろうとしていた連続量そのもの」に置き換えるだけにする(順位→相対強度パーセンタイル、維持率≥0.5→維持率そのまま、5日騰落率>0→絶対モメンタム)。これにより閾値80/60/90の意味(「満点の8割」等)が概ね保存され、閾値の再調整を最小限にできる。
3. **20日騰落率の組み込み方**: 相対強度(順位)と絶対モメンタムの両方を「5日:20日 = 0.6:0.4」でブレンドする(`themeMomentumBlend5d`)。continuousモードでは**テーマ順位(themeRank)自体もブレンド相対強度の降順**にする(提案6の「順位付けが5日騰落率のみ」への対応)。binaryモードの順位は現行どおりreturn5d降順(完全互換)。
4. **Part C(売買レビュー)は判定ロジックに一切触れない読み取り専用の分析**。`lib/evaluator.ts` / `lib/scoring.ts` は無変更。約定シミュレーションは既存の `simulateTrade` を再利用する。
5. **仮想成績は「実際の株数」で計算する**。ツールの推奨株数ではなく実際に買った株数で simulateTrade を回すことで、実成績との差分が「執行の差(エントリー/イグジットのタイミングと価格)」だけを表すようにする。建玉の逸脱は別フラグ(`over_sized`)で独立に検出する。
6. **手動記録CSVはfail fast**。`data/trades/executions.csv` は自分で書くファイルなので、不正行は黙ってスキップせず行番号付きでエラーにする(価格CSVの「壊れた行はフィルター」方針とは意図的に変える。記録のゴミは分析全体を静かに歪めるため)。
7. 非目標(本計画ではやらない): TOPIX地合いフィルター(提案2。別計画)、決算日フィルター(提案3。別計画)、テーマスコアのヒステリシス(状態を持つためstatelessなevaluatorと相性が悪い。将来拡張)、証券会社API/約定CSV自動取込、手数料・税・スリッページのシミュレーション反映、売買レビューのUIページ。

## 2. 全体像(新規・変更ファイル)

```
── Part A+B(提案6) ──
変更: lib/scoring.ts               … scoreThemeのモード分岐 / 連続版スコア / percentileヘルパー
変更: lib/evaluator.ts             … evaluateThemes: パーセンタイル計算・continuous時の順位・scoreComponents
変更: lib/types.ts                 … ThemeScoringMode / Rules拡張 / ThemeScore.scoreComponents
変更: config/rules.json            … 新キー4個(セクション6に全文)
変更: lib/backtest/engine.ts       … EngineResultにthemeDays(日次テーマスコア記録)を追加
変更: lib/backtest/report.ts       … themeScoreBand() / THEME_SCORE_BANDS
変更: scripts/backtest.ts          … --theme-scoring オーバーライド / themeScoreBand内訳・コホート / テーマ安定性指標
変更: components/ThemeRanking.tsx  … スコア内訳のtitleツールチップ(最小限)
新規: docs/backtest-results/2026-07-theme-scoring.md … A/B検証結果(M3で作成)

── Part C(提案7) ──
新規: data/trades/executions.csv   … 手動の約定記録(ヘッダー行のみで作成)
変更: lib/csv.ts                   … toExecutionRows() 追加
新規: lib/tradeReview.ts           … FIFOペアリング・シグナル突き合わせ・逸脱判定・月次集計(純ロジック)
新規: scripts/review_trades.ts     … CLI(レポート出力)
変更: package.json                 … "review:trades" スクリプト追加

── 共通 ──
新規: tests/scoring.test.ts        … 連続スコアの単体テスト
新規: tests/tradeReview.test.ts    … Part Cの単体テスト
変更: tests/evaluator.test.ts      … binary回帰テスト・continuous統合テスト追加
変更: README.md                    … テーマスコアの説明更新 / 売買記録・月次振り返り手順の追加
```

依存パッケージの追加は不要。`lib/snapshot.ts` は変更不要(`themeScores` は丸ごと保存されるため `scoreComponents` は自動で載る)。`scripts/evaluate_candidates.ts` も変更不要。

---

## Part A: テーマスコアの連続値化(提案6)

### A-1. 設定(`config/rules.json` / `Rules` 型)

```jsonc
"themeScoringMode": "binary",   // "binary" | "continuous"。binary = 現行(4条件×二値)
"themeMomentumBlend5d": 0.6,    // 5日:20日のブレンド比(5日側)。相対強度と絶対モメンタムの両方に使う
"themeMomentum5dRange": 0.05,   // 絶対モメンタムの正規化幅: 5日騰落率 ±5% を 0..1 に線形写像
"themeMomentum20dRange": 0.10   // 同、20日騰落率 ±10%
```

```ts
export type ThemeScoringMode = "binary" | "continuous";
// Rules に: themeScoringMode: ThemeScoringMode; themeMomentumBlend5d: number;
//           themeMomentum5dRange: number; themeMomentum20dRange: number;
```

正規化幅の初期値(±5% / ±10%)は「5営業日/20営業日でテーマ平均がこれだけ動けば十分に強い/弱い」という初期仮説であり、Part Bの検証(themeScore分布とバンド別成績)で較正する。閾値としてハードに効くのではなく飽和点(clamp)なので、多少ずれてもスコアが数点動く程度で頑健。

### A-2. スコア定義(`lib/scoring.ts`)

現行の `ThemeScoreInput` を拡張する(evaluatorが常に全フィールドを渡す。binaryパスは新フィールドを無視する):

```ts
export interface ThemeScoreInput {
  rank: number;
  totalThemes: number;
  leaderMa5AboveRatio: number;
  leaderMa25AboveRatio: number;
  return5d: number;
  return20d: number;        // 追加
  percentile5d: number;     // 追加: return5dの全テーマ内パーセンタイル(0..1、最強=1)
  percentile20d: number;    // 追加: return20dの同上
}
```

`scoreTheme(input, rules)` のシグネチャは変えず、内部で `rules.themeScoringMode` により分岐する(呼び出し側の変更を最小にするため):

```ts
export function scoreTheme(input: ThemeScoreInput, rules: Rules): number {
  return rules.themeScoringMode === "continuous"
    ? scoreThemeContinuous(input, rules)
    : scoreThemeBinary(input, rules);   // 現行実装をそのままリネーム
}
```

連続版。**4つの二値条件を、同じ配点のまま連続量に置き換える**:

```ts
export function scoreThemeContinuous(input: ThemeScoreInput, rules: Rules): number {
  const weights = rules.scoring.theme;
  const w5 = rules.themeMomentumBlend5d;

  // (1) 順位30点 → 相対強度: 5日/20日パーセンタイルのブレンド(0..1)
  const relativeStrength = w5 * input.percentile5d + (1 - w5) * input.percentile20d;

  // (2) 主役株5日線維持率30点 → 維持率そのまま(既に0..1)
  // (3) 主役株25日線維持率20点 → 同上

  // (4) 5日騰落率プラス20点 → 絶対モメンタム: ±range を 0..1 に線形写像してブレンド
  //     騰落率0%はちょうど0.5(=10点)。全テーマ下落時は全テーマこの項が沈む(相対順位だけでは満点にならない)
  const momentum =
    w5 * clamp01((input.return5d + rules.themeMomentum5dRange) / (2 * rules.themeMomentum5dRange)) +
    (1 - w5) * clamp01((input.return20d + rules.themeMomentum20dRange) / (2 * rules.themeMomentum20dRange));

  return Math.round(
    weights.rankTopPercent * relativeStrength +
    weights.leaderMa5AboveRatio * input.leaderMa5AboveRatio +
    weights.leaderMa25AboveRatio * input.leaderMa25AboveRatio +
    weights.return5dPositive * momentum
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
```

- 最終スコアは **`Math.round` で整数**にする(UI表示・スナップショット・`String(themeScore)` を使う既存コードとの整合、決定性のため)。配点合計が100なのでスコアは常に0〜100。
- `themeStatus`(80/60)と `trendFollowThemeScoreThreshold`(90)は無変更でそのまま適用される。

パーセンタイルの定義(タイ対応。`lib/scoring.ts` にexportして単体テストする):

```ts
/** valuesの中でのvalueのパーセンタイル(0..1、最大=1)。タイは0.5扱い。n=1は1を返す。
    pct = (自分より小さい個数 + 0.5×自分と等しい個数(自分を除く)) / (n - 1) */
export function percentileOf(value: number, values: number[]): number
```

- 全テーマ同値なら全テーマ0.5になる(タイの対称性)。`totalThemes = 1` なら1(ゼロ除算ガード)。
- 価格データ不足で騰落率が計算できないテーマは既存の `average()` の仕様どおり `return5d = 0` / `return20d = 0` として扱う(特別扱いしない。現行binaryと同じ)。

### A-3. evaluatorの変更(`lib/evaluator.ts` の `evaluateThemes`)

1. 集計後(baseThemes構築後)に全テーマの `return5d` / `return20d` 配列から各テーマの `percentile5d` / `percentile20d` を計算する。
2. **順位**: binaryモードは現行どおり `return5d` 降順。continuousモードは `relativeStrength = w5×percentile5d + (1−w5)×percentile20d` の降順(タイは `theme.localeCompare(theme, "ja")` で安定化)。rankはUI表示とbinaryの30点条件に使う。
3. `scoreTheme` に拡張済みinputを渡す。
4. `ThemeScore` に内訳を載せる(透明性・検証・UIツールチップ用):

```ts
// lib/types.ts の ThemeScore に追加
scoreComponents: {
  relativeStrength: number;  // 0..30(配点適用後、小数1桁に丸め)
  leaderMa5: number;         // 0..30
  leaderMa25: number;        // 0..20
  momentum: number;          // 0..20
} | null;                    // binaryモードでは null
```

- 旧スナップショットの `ThemeScore` にはこのフィールドが無い。現状 `themeScores` を読み返すコードはUI(`lib/data.ts` 経由で最新の `data/theme_scores.json` のみ)なので互換問題は起きないが、将来スナップショットの `themeScores` を読む場合は undefined 許容にすること(コードコメントで明記)。

### A-4. 消費側への影響(変更不要だが理解しておく点)

- `classifyCandidate` / `themeStatus` / `exitModeFor` / `computeProfitWarnings` / bbWatch: すべて `themeScore` の数値比較なので無変更で動く。
- **挙動が変わるのは境界付近の分布**: binaryでは80以上は実質{80, 100}の2値だったため `trendFollowThemeScoreThreshold(90)` は「100点のテーマだけ」を意味していた。continuousでは80〜100が連続になり、90〜99のテーマがトレンドフォロー決済に入るようになる。**exitMode別の成績が変わりうるので、Part BのA/B比較でexitMode別内訳を必ず確認する**。
- dedupe(themeScore最大の行を採用)はタイが減って安定する方向にしか変わらない。

### A-5. UI(最小限)

`components/ThemeRanking.tsx` のスコアセルに、`scoreComponents` が非nullのとき `title` 属性でツールチップを付ける:

```
相対強度 24.3/30 ・ 主役株5日線 20.0/30 ・ 主役株25日線 13.3/20 ・ モメンタム 12.1/20
```

新しい列・コンポーネントは追加しない(binaryモードでは従来表示のまま)。

---

## Part B: バックテスト統合と検証(binary vs continuous のA/B)

### B-1. `lib/backtest/engine.ts` — 日次テーマスコアの記録

境界安定性(本計画の主目的)を測るには「毎営業日のテーマスコアとstatus」の時系列が要る。engineは各評価日に `evaluateCandidates` を呼んでおり、その戻り値 `result.themeScores` を捨てているので、記録するだけでよい:

```ts
export interface ThemeDayRecord {
  date: string;
  theme: string;
  themeScore: number;
  status: ThemeStatus;
  rank: number;
}
// EngineResult に追加: themeDays: ThemeDayRecord[]
```

評価日ループ内で `result.themeScores` を `ThemeDayRecord` に写して push する(1日×テーマ数なので2年でも高々 500日×14テーマ=7,000行)。

### B-2. `lib/backtest/report.ts` — テーマスコアバンド

`stopAtrBand` と同じパターン。境界は既定閾値(60=watch / 80=buy / 90=trendFollow)に一致させる:

```ts
export const THEME_SCORE_BANDS = ["<60", "60-79", "80-89", "90-100"] as const;
export function themeScoreBand(score: number): string
```

### B-3. `scripts/backtest.ts`

1. **CLIオーバーライド追加**(`--sizing` と同じ流儀。不正値は exit 1):
   ```
   --theme-scoring binary|continuous   (既定: rules.jsonの値)
   ```
2. `breakdowns.themeScore`(`String(record.themeScore)` の離散グループ化)を **`themeScoreBand` バンド別に置き換える**(`bandBreakdown(result.trades, (r) => themeScoreBand(r.themeScore), THEME_SCORE_BANDS)`)。連続値では従来の離散グループ化が破綻するため。コンソール表示のタイトルは「テーマスコア帯別」。
3. **コホートのバンド別表を追加**: `cohortsByBand.themeScore` として buy_candidate / watch それぞれを `themeScoreBand` 別に集計(既存の `cohortBandSummary` を再利用)。テーマ閾値80の妥当性を執行モデル非依存で読むための表。
4. **テーマ安定性指標**を `themeDays` から計算して `summary.themeStability` に保存・コンソール表示する:
   ```ts
   {
     themeDayCount: number;          // 記録行数
     statusFlips: number;            // 全テーマ合計の日次status変化回数(前営業日とstatusが違う回数)
     flipsPer100Days: number;        // statusFlips / (テーマ数×営業日数) × 100 ※比較の主指標
     avgAbsDailyScoreChange: number; // |当日スコア−前日スコア| の平均(スコア自体の暴れ幅)
     statusDistribution: Record<ThemeStatus, number>; // strong/watch/weak の営業日数分布
   }
   ```
   実装は `themeDays` をテーマごとに日付順に並べ、隣接日を比較するだけ。**binaryとcontinuousで `flipsPer100Days` を直接比較する**のがこの機能の主目的。
5. `summary.params` に `themeScoringMode` を追加(A/B結果の区別に必須)。

### B-4. 検証手順と採用基準(M3で実施し、結果を `docs/backtest-results/2026-07-theme-scoring.md` に記録)

```bash
python3 scripts/fetch_prices.py --period 2y --output data/prices_backtest.csv --no-intraday --auto-adjust

# ベースライン(現行binary)
npm run backtest -- --theme-scoring binary --out data/backtest/theme-binary
# 連続値
npm run backtest -- --theme-scoring continuous --out data/backtest/theme-continuous
```

読み方と採用基準(**すべて満たしたら** `rules.json` の `themeScoringMode` を `"continuous"` に切り替える):

1. **境界安定性(主目的)**: `themeStability.flipsPer100Days` が binary 比で減少すること。
2. **成績が壊れていない**: buy_candidate の期待値Rが binary 比で −0.05R 以内(または改善)。
3. **候補数が激変しない**: シグナル数(buy_candidate)が binary 比 70%〜130% の範囲。連続化は境界を滑らかにするのが目的で、候補の量を変えるのが目的ではない。範囲を外れる場合は `themeMomentum5dRange` / `themeMomentum20dRange` を較正して再実行(較正結果と根拠を記録)。
4. **exitMode別の確認**(A-4の注意点): trend_follow の約定数比率が激増していないこと、していた場合はtrend_followの期待値Rが目標決済と遜色ないこと。必要なら `trendFollowThemeScoreThreshold` の引き上げ(90→95)を較正案として記録。
5. **テーマスコア帯別コホート**: `<60` → `60-79` → `80-89` → `90-100` でfwd5/fwd20が単調に改善する傾向があること(閾値80が機能している証拠。binaryでは80未満/以上の2値でしか読めなかった検証がここで初めて可能になる)。

基準を満たさない場合は binary のまま運用を続け、原因(正規化幅・ブレンド比・閾値)の較正案を記録して再検証する。切替時は `config/rules.json` の変更だけを独立コミットにする(問題時に設定だけ戻せるように。rulesHashも変わるのでシグナル履歴上も版が分離される)。

---

## Part C: 実際の売買とツールの突き合わせ(提案7)

### C-1. 約定記録CSV(`data/trades/executions.csv`)

手動で編集する。1行=1約定(部分約定・分割売りはそのまま複数行):

```csv
executedAt,code,side,price,shares,memo
2026-07-10,5803,buy,6210,100,寄り後に指値で約定
2026-07-15,5803,sell,6580,100,第1利確
2026-07-16,7011,buy,2350,200,
```

列の仕様:

- `executedAt`: 約定日 `YYYY-MM-DD`(時刻は持たない。ドクトリン上執行は9:30〜10:00で日付があれば十分。補足はmemoへ)
- `code`: 銘柄コード(`normalizeCode` を通す。watchlistと同じ扱い)
- `side`: `buy` | `sell`
- `price`: 約定単価(円)
- `shares`: 株数(正の整数)
- `memo`: 自由記述(省略可)

初期ファイルはヘッダー行のみで作成しコミットする。**プライバシー注意**: このリポジトリはGitHub上にあるため、リポジトリがpublicの場合は実際の売買記録が公開される。公開を避けたい場合は `data/trades/` を `.gitignore` に追加してローカル管理にする(READMEにこの選択肢を明記する。既定はシグナル履歴と同様にコミットして版管理)。

### C-2. パースとバリデーション(`lib/csv.ts` に `toExecutionRows` 追加)

```ts
export interface ExecutionRow {
  executedAt: string;
  code: string;
  side: "buy" | "sell";
  price: number;
  shares: number;
  memo: string;
}
export function toExecutionRows(text: string): ExecutionRow[]
```

- 既存の `parseCsv` / `normalizeCode` を使う。
- **不正行は行番号付きで throw**(設計方針6): 日付が `YYYY-MM-DD` 形式でない、sideが buy/sell 以外、priceが正の有限数でない、sharesが正の整数でない。例: `executions.csv 3行目: side は buy か sell を指定してください: "buy "`(※parseCsvがtrimするので実際は値の中身のみ検査)。
- 結果は `executedAt` 昇順(同日内はファイル記載順)にソートして返す。

### C-3. レビューロジック(`lib/tradeReview.ts` — 純ロジック、IOなし)

型と関数(すべてexportしてテストする):

```ts
export interface ClosedLot {
  code: string;
  shares: number;
  buyDate: string;  buyPrice: number;
  sellDate: string; sellPrice: number;
  pnlYen: number;          // (sellPrice - buyPrice) × shares。手数料・税は対象外(バックテストと整合)
  buyMemo: string; sellMemo: string;
}
export interface OpenLot {
  code: string; shares: number; buyDate: string; buyPrice: number; buyMemo: string;
}

/** FIFOで買いロットに売りを充当する。売り数量が保有を超えたらエラー(記録漏れの検出) */
export function pairExecutions(rows: ExecutionRow[]): { closed: ClosedLot[]; open: OpenLot[] }
```

- 銘柄ごとに時系列で処理。sellはオープンな買いロットへFIFO充当し、ロットをまたぐ・分割する場合は株数で按分してClosedLotを複数作る(buyPriceはロットごとに保持されるので加重平均は不要)。
- 売り超過は `throw new Error("code 5803: 2026-07-15 の売り200株が保有100株を超えています(記録漏れ?)")`。

シグナル突き合わせ:

```ts
export interface SignalMatch {
  snapshotDate: string;
  candidate: SlimCandidate;      // 複数テーマ行はthemeScore最大(タイはindividualScore最大)の1行。既存dedupe規則と同一
  sameDaySignal: boolean;        // snapshotDate === buyDate で採用した場合true
}

/** buyDateの直前のスナップショットからcodeのシグナルを引く。
    優先: snapshotDate < buyDate の最新(lookbackDays暦日以内)。無ければ snapshotDate === buyDate(場中判断とみなす)。 */
export function matchSignal(
  buyDate: string, code: string,
  snapshots: Map<string, SignalSnapshot>,   // snapshotDate -> snapshot(呼び出し側でロード)
  lookbackDays: number                      // 既定5(連休を跨いでもD-1営業日が引けるように)
): SignalMatch | null
```

逸脱フラグ(1つのClosedLot/OpenLotに複数付きうる。keyの一覧):

| key | 条件 | 意味 |
|---|---|---|
| `no_signal_data` | lookback内にスナップショットファイル自体が無い | ロガー停止中・履歴開始前の売買 |
| `off_watchlist` | スナップショットはあるがcodeの行が無い | ウォッチリスト外の売買 |
| `not_buy_candidate` | マッチした行の `status !== "buy_candidate"`(実際のstatusを詳細に記録) | ルール外エントリー |
| `same_day_signal` | 前営業日スナップショットが無く当日スナップショットでマッチ | 場中判断(参考情報) |
| `chase_entry` | `buyPrice > candidate.entryUpperPrice` | 買い上限超えの追いかけ買い |
| `over_sized` | `candidate.suggestedShares !== null && shares > candidate.suggestedShares` | 推奨株数超過(リスク超過) |
| `late_stop` | `sellPrice < candidate.stopLoss × (1 − stopTolerance)`(既定tolerance 0.5%) | 損切りラインより有意に下で売却=損切りが遅い |
| `holding_below_stop` | OpenLotのみ: 最新終値 < `candidate.stopLoss` | **損切りライン割れを保有中(最重要警告)** |

計測値(フラグではなく常に記録):

- `entrySlippagePct = (buyPrice − candidate.entryPrice) / candidate.entryPrice`(正=ツールの買い基準より高く買った)
- `holdDays`: その銘柄の価格行のうち `buyDate < date ≤ sellDate` の本数(営業日)。価格データに無い銘柄は null。

仮想成績(ツールに完全に従った場合):

```ts
export interface VirtualResult {
  trade: SimulatedTrade;   // 既存simulateTradeの結果そのまま
  pnlYen: number | null;   // shares=実際の株数で計算(設計方針5)
}
```

- `scripts/analyze_signals.ts` と同じ手順で、マッチしたスナップショット行の `entryPrice / entryUpperPrice / stopLoss / takeProfit1 / exitMode` と価格CSV(`snapshotDate` のインデックスから `forwardBars`、`closesUpToSignal` はTRAIL_CLOSES_LOOKBACK=25本)を使い `simulateTrade` を呼ぶ。`options: { maxHoldDays: 30, stopMode: "prev-day", shares: 実際の株数 }`。
- 価格CSVに `snapshotDate` が無い(1年ローリングの範囲外)場合は仮想成績なし(警告を出し、`--prices data/prices_backtest.csv` を案内する。analyze_signalsと同じ制約)。
- レビュー行の主要比較: `実現pnl − 仮想pnl`(執行差。恒常的に大きく負なら執行に問題がある)。

月次集計(ClosedLotの `sellDate` の月でグループ化):

```ts
export interface MonthlyReview {
  month: string;              // YYYY-MM
  closedLots: number;
  ruleCompliant: number;      // no_signal_data/off_watchlist/not_buy_candidateが無いロット数
  ruleViolations: number;
  avgEntrySlippagePct: number | null;
  actualPnlYen: number;
  virtualPnlYen: number | null;   // 仮想成績が計算できたロットのみの合計(件数も併記)
  executionGapYen: number | null; // actual − virtual(同上のサブセットで)
}
```

### C-4. CLI(`scripts/review_trades.ts`)

```
npm run review:trades
npm run review:trades -- --month 2026-07 --prices data/prices_backtest.csv
```

オプション(parseArgs。既存スクリプトの流儀):

- `--executions`(既定 `data/trades/executions.csv`)
- `--prices`(既定 `data/prices.csv`)
- `--month YYYY-MM`: ClosedLotをsellDateの月で絞る(OpenLotは常に全件表示)
- `--lookback-days`(既定 `5`)/ `--stop-tolerance`(既定 `0.005`)
- `--out`(既定 `data/analysis`)

処理: executions.csv・prices.csv・`data/history/signals/*.json` をロード → `pairExecutions` → 各ロットを `matchSignal` + 逸脱判定 + 仮想成績 → 出力。executions.csv が無い/ヘッダーのみの場合は記録手順を案内して exit 0(エラーにしない)。

出力:

1. `data/analysis/trade_review.csv` — 1行=1 ClosedLot。列: `buyDate, code, name, shares, buyPrice, sellDate, sellPrice, holdDays, actualPnlYen, signalDate, signalStatus, entryPrice, entryUpperPrice, stopLoss, takeProfit1, suggestedShares, entrySlippagePct, flags(セミコロン結合), virtualExitDate, virtualExitReason, virtualPnlYen, executionGapYen`(nullは空文字。`csvCell` 使用)
2. コンソール(`formatTable` 使用):
   - `## トレード別` — 上記CSVの要約列(日付・銘柄・スリッページ・フラグ・実現pnl・仮想pnl・差)
   - `## 月次サマリ` — MonthlyReviewの表
   - `## 逸脱フラグ集計` — flag key別の件数
   - `## オープン建玉` — code / 株数 / 取得日 / 取得単価 / 最新終値 / 含み損益 / 損切りライン / **`holding_below_stop` 警告**
3. 注意事項(CAVEATSの流儀で常時表示): 「手数料・税は含まない」「仮想成績はシグナル日の翌営業日執行の日足近似(バックテストと同じ制約)」「同名銘柄の複数テーマ行はthemeScore最大の行で突き合わせ」

`package.json` に追加: `"review:trades": "tsx scripts/review_trades.ts"`。

---

## 6. config/rules.json の差分(全文)

`volumeFilterMode` の後・`scoring` の前に追加:

```jsonc
"themeScoringMode": "binary",
"themeMomentumBlend5d": 0.6,
"themeMomentum5dRange": 0.05,
"themeMomentum20dRange": 0.10
```

Part Cにrules.jsonの新キーは無い(レビューは判定ルールではないため。lookback等はCLIオプション)。

## 7. テスト計画

### tests/scoring.test.ts(新規)

1. **percentileOf**: 昇順に並んだ値での位置(最強=1、最弱=0)、タイ(全同値→全て0.5、部分タイ)、n=1で1。
2. **scoreThemeContinuous の計算値検証**(手計算フィクスチャ): (a) 全成分満点(percentile=1、維持率=1、return5d≥+5%かつreturn20d≥+10%)で100点、(b) 全成分最低で0点、(c) return5d=0・return20d=0でモメンタム項がちょうど10点(0.5×20)、(d) clampの境界(return5d=+5%ちょうど→mom5=1、+6%でも1)、(e) ブレンド比0.6/0.4の反映、(f) Math.roundの整数性。
3. **binary回帰**: `themeScoringMode: "binary"` で現行 `scoreTheme` と同一値(既存テストの期待値が変わらないこと。scoreThemeBinaryへのリネーム後も公開シグネチャ `scoreTheme` 経由で検証)。

### tests/evaluator.test.ts(追加)

4. **binary完全互換**: 既存フィクスチャで `themeScoringMode: "binary"` のとき themeScores(score/rank/status)と candidates(status/themeScore)が本計画実装前と同一。`scoreComponents` は null。
5. **continuous統合**: 同フィクスチャで `"continuous"` にすると (a) scoreComponentsが非nullで4成分の合計≒score(丸め誤差±0.5以内)、(b) rankがブレンド相対強度順になる(return5dだけ高くreturn20dが最低のテーマAと、両方そこそこのテーマBで順位が入れ替わるフィクスチャを作る)、(c) themeStatusが閾値どおり。

### tests/tradeReview.test.ts(新規)

6. **toExecutionRows**: 正常系(ソート・normalizeCode・memo省略)、不正系(日付形式・side・負の株数・小数株数・非数priceがそれぞれ行番号付きでthrow)。
7. **pairExecutions**: 単純往復、分割売り(100買→60売+40売)、複数ロットまたぎ(100買+100買→150売でロット按分)、オープン建玉が残る、売り超過throw、複数銘柄の独立性。
8. **matchSignal**: 前営業日マッチ(D買いにD-1スナップショット)、連休またぎ(lookback内の最新を採用)、同日フォールバック(sameDaySignal=true)、lookback外→null、複数テーマ行のdedupe(themeScore最大)。
9. **逸脱フラグ**: 各フラグを1つずつ立てるフィクスチャ(not_buy_candidate / chase_entry / over_sized / late_stop / holding_below_stop)。境界: buyPrice = entryUpperPriceちょうど→フラグなし、sellPrice = stopLoss×(1−0.005)ちょうど→フラグなし。
10. **月次集計**: 2ヶ月分のClosedLotでmonth分割・ruleCompliant数・pnl合計。

### バックテスト系(tests/report.test.ts に追加)

11. `themeScoreBand` の境界値(59→"<60"、60→"60-79"、79/80/89/90/100)。
12. engine: 小さなフィクスチャで `themeDays` が評価日×テーマ数ぶん記録され、date/score/statusが `evaluateCandidates` の出力と一致すること。

### 手動検証(受け入れ確認)

- `npm run typecheck && npm test` が通る。
- `npm run evaluate`(binaryのまま)で `data/theme_scores.json` の score/rank/status が実装前と一致(diffで確認。`scoreComponents: null` の追加のみ)。`data/candidates.json` は無変化。
- `npm run backtest -- --theme-scoring continuous` が完走し、summary.jsonに `themeScoringMode` / `themeStability` / テーマスコア帯別が載る。
- executions.csv にダミー2行(買い→売り)を入れて `npm run review:trades` が表とCSVを出す(確認後ダミー行は削除)。

## 8. 実装順序(マイルストーン)

1. **M1(連続スコア実装・既定binary)**: types + rules.json + scoring.ts + evaluator.ts + ThemeRankingツールチップ + テスト1〜5。**この時点で判定・表示は完全に無変更**(themeScoringMode="binary")であることを `npm run evaluate` のdiffで確認。
2. **M2(バックテスト統合)**: engine(themeDays)+ report(themeScoreBand)+ backtest.ts(--theme-scoring / 帯別内訳・コホート / themeStability)+ テスト11〜12。
3. **M3(検証と切替判断)**: B-4の手順を実行し、結果と判断を `docs/backtest-results/2026-07-theme-scoring.md` に記録。採用基準を満たしたら `config/rules.json` の `themeScoringMode` を `"continuous"` に切り替え(**独立コミット**)、README更新(判定ロジック概要のテーマスコア説明)。
4. **M4(売買レビュー基盤)**: executions.csv(ヘッダーのみ)+ csv.ts + tradeReview.ts + review_trades.ts + package.json + テスト6〜10。
5. **M5(運用開始)**: README更新(記録の付け方・`npm run review:trades` の月次振り返り手順・プライバシー注意・注意事項)。実際の約定があれば初回レビューを実行して出力を確認。

各マイルストーンで `npm run typecheck && npm test` を通すこと。M3のrules.json切替を独立コミットにするのは、問題時に設定だけ戻せるようにするため(atr-sizing計画のM2/M3と同じ運用)。

## 9. 将来の拡張(今回は実装しない)

- **テーマstatusのヒステリシス**(strong入り80/strong落ち75のような非対称閾値)— 連続値化でフリップが十分減らなければ検討。evaluatorが前日状態を持つ必要があり、スナップショット履歴を入力に使う設計になる。
- **TOPIX地合いフィルター(提案2)** — 絶対モメンタム項が部分的に代替するが、マスタースイッチとしての地合い判定は別計画で。`fetch_prices.py` に指数コード追加+evaluatorにレジームゲート。
- **決算日フィルター(提案3)** — 手動CSV(四半期ごと更新)+「決算3営業日前から買い候補除外」。別計画で。
- 売買レビューのUIページ(/review)— trade_review.csv を読むテーブル表示。月次運用が定着してから。
- 証券会社の約定履歴CSV(SBI・楽天等)からexecutions.csvへの変換スクリプト。
- 「見送った買い候補のその後」との比較 — 既存の `npm run analyze:signals` が仮想成績を出すので、trade_review側のマッチ済みシグナルと突き合わせれば「従った候補 vs 見送った候補」の成績差が出せる。
