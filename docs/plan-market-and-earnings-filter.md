# 実装計画: 地合い(市場レジーム)フィルター + 決算日フィルター

このドキュメントは、5日線押し目チェッカーに以下の2機能を追加するための実装計画である。実装者(AIエージェントを含む)がこのファイルだけを読んで作業を完遂できることを目的とする。

- **Part A(提案2): 地合いフィルター** — TOPIX連動ETF(1306)を市場レジーム指標として毎日取得し、「指標の終値が25日線より上 かつ 25日線が上向き」を地合いOKと定義する。地合いNGのとき買い候補を watch に降格できるマスタースイッチを入れる。現状はテーマの**相対**順位しか見ていないため、全テーマ下落中でも1位テーマが高得点になる穴を塞ぐ。
- **Part B(提案3): 決算日フィルター** — 手動管理の `data/earnings.csv` から銘柄ごとの次回決算発表日を引き、発表 `earningsExclusionDays` 営業日前(既定3・平日近似)から買い候補を watch に降格する。損切りを前日安値に置く設計は決算ギャップの前では機能しない(寄りで損切りラインを飛び越え、想定損失1.2万円の前提が崩れる)ための防御。
- **Part C: バックテスト・履歴統合** — 地合い・決算接近をトレード/コホート記録に載せ、「地合いOK日 vs NG日の成績」をデータで検証してから exclude 昇格を判断する。

## 0. 前提知識(現状のアーキテクチャ)

`docs/plan-signal-logger-and-backtest.md`・`docs/plan-atr-sizing-and-volume.md` の前提知識セクションがすべて有効。本計画に特に関係する点だけ再掲する。

- 判定ロジックの唯一の実装は `lib/evaluator.ts` の `evaluateCandidates(watchlist, prices, rules, generatedAt)`。**ロジックの二重実装は禁止**(Pythonは取得のみ)。
- `classifyCandidate(draft, themeScoreValue, rules)` が status を決める。buy_candidate を返す直前に品質フィルター(excludeモード時のみ)の **watch 降格ガード**が既にある(`lib/evaluator.ts` の `qualityExcluded`)。本計画の2フィルターも同じ箇所に同じ対称性で追加する。
- 品質フィルターの前例(ATR損切り・出来高): モードは `QualityFilterMode = "off" | "flag" | "exclude"`。flag は理由表示のみ、exclude は buy_candidate → watch 降格(avoid にはしない)。**測定不能(null)は罰しない**。flagの警告理由は `qualityFlagReasons()` で作られ、buy_candidate では `buy_setup_ready` の後ろに付く。
- 価格データ: `data/prices.csv`(本番・1年分・場中は当日部分バー入り)と `data/prices_backtest.csv`(2年分・確定日足・分割調整済み)。`scripts/fetch_prices.py` が `data/watchlist.csv` のユニーク code に `.T` を付けて yfinance から取得する。
- `lib/data.ts` の `readEvaluation()` は生成済み `data/candidates.json` + `data/theme_scores.json` から `EvaluationOutput` を**再構築**する(生成物が無ければその場で `evaluateCandidates` を実行)。新しい出力フィールドを追加するときは両方の経路を更新する必要がある。
- スナップショット: `scripts/snapshot_signals.ts` が `data/candidates.json` を読んで `lib/snapshot.ts` の `buildSnapshot` で `data/history/signals/YYYY-MM-DD.json` を作る。`SlimCandidate` に無いフィールドは履歴に残らない。`scripts/analyze_signals.ts` は旧スナップショットに存在しないフィールドを `?? null` で吸収する前例あり。
- バックテスト: `lib/backtest/engine.ts` の `runBacktest` が営業日ごとに `evaluateCandidates` を呼ぶ(価格は code ごとに直近252行へスライス)。`TradeRecord` / `CohortRecord` に candidate の測定値を転記し、`scripts/backtest.ts` が `bandBreakdown` / `cohortBandSummary` でバンド別集計を出す。バンド関数(`stopAtrBand` 等)とバンド順配列(`STOP_ATR_BANDS` 等)は `lib/backtest/report.ts`。CLIオーバーライド(`--sizing` 等)は rules のコピーに上書きする方式。
- 手動CSVの前例: `lib/csv.ts` の `toExecutionRows` — 不正行は黙ってスキップせず**行番号付きでエラー**にする。
- テスト: `npm test`(node:test + tsx)。型チェック: `npm run typecheck`。
- GitHub Actions(`.github/workflows/update-and-deploy.yml`)は fetch → evaluate → (16:30のみ)snapshot → build の順。**本計画でワークフローの変更は不要**(fetch が指標を自動で含むようになるため)。

## 1. 設計方針(先に読む・重要な決定事項)

1. **市場指標は「1306(NEXT FUNDS TOPIX連動ETF)」を prices.csv に同居させる**。指数そのもの(^TPXなど)は yfinance で不安定だが、1306.T は通常の日本株と同じ経路(日足+当日分足)で取れる。code をウォッチリスト銘柄と同じ `data/prices.csv` に入れることで、`evaluateCandidates` のシグネチャを変えずに(rules.marketIndexCode で引くだけで)本番にもバックテストにも自動で流れる。ウォッチリストに無い code の価格行は既存ロジックに一切影響しない(evaluator は watchlist 起点、engine の series は増えるだけ)。
2. **Part A(地合い)は段階導入に従う**: 既定 `marketFilterMode: "flag"` で入れ、M5のバックテストA/B(flag vs exclude)とコホート表(地合いOK日/NG日のフォワードリターン)で効果を確認してから exclude 昇格を判断する。地合いフィルターは「勝率・期待値を上げる」性能仮説なので、検証前に候補を落とさない。
3. **Part B(決算)は既定 `earningsFilterMode: "exclude"` で入れる — 段階導入方針からの意図的な逸脱**。理由: これは性能仮説ではなく**リスク上限の不変条件**(maxLossYen ≤ 1.2万円の前提が決算ギャップで崩れることへの防御)であり、該当イベントは銘柄あたり年4回・ギャップ事故は稀だが致命的という fat tail のため、2年分のバックテストでは統計的に検証できない。さらに導入時点の `earnings.csv` は空なので実質不発で始まり、ユーザーがデータを入れた分だけ効く(安全な既定)。モードスイッチ(off/flag/exclude)は他フィルターと同じく用意する。
4. **null不罰の原則を継続**: 指標データが prices に無い/行数不足 → `market = null` → フィルター不発(全候補が地合いOK扱い)。`earnings.csv` に銘柄の未来日付が無い → `daysToEarnings = null` → 不罰。
5. **降格先は watch であって avoid ではない**(既存品質フィルターと同じ)。地合いNGも決算接近も個別銘柄のシナリオ崩壊ではないため、監視リストに残して理由バッジで見せる。
6. **個別スコア(100点満点・6条件)とテーマスコアは無変更**。両フィルターはスコア外の独立ゲート。`scoreIndividual` / `ScoringWeights` / `scoreTheme` は触らない。
7. **営業日は平日(月〜金)近似**で数え、日本の祝日は考慮しない。祝日を挟むと除外窓が実質1営業日前後ずれることがあるが、決算日CSV自体が手動管理の近似データであり許容する(READMEに明記。心配なら `earningsExclusionDays` を増やす運用)。
8. 非目標(本計画ではやらない): 決算日の自動取得(yfinanceの日本株決算日は不安定)、地合いの多段階評価・複数指標合成(N225とのAND/OR)、地合いNG時の保有ポジション決済前倒し、祝日カレンダー、BB押し目(/bb-watch)への適用。

## 2. 全体像(新規・変更ファイル)

```
新規: data/earnings.csv           … ヘッダーのみで作成(手動管理データの置き場)
新規: lib/calendar.ts             … weekdaysBetween()(平日カウント)
変更: config/rules.json           … 新キー4個(セクション6に全文)
変更: lib/types.ts                … Rules拡張 / MarketCondition追加 / CandidateResult拡張 / EvaluationOutput拡張
変更: lib/csv.ts                  … EarningsRow / toEarningsRows() 追加
変更: lib/evaluator.ts            … 市場レジーム計算 / 決算接近計算 / 条件・理由・分類の拡張 / シグネチャにearnings追加
変更: lib/snapshot.ts             … SignalSnapshot.market / SlimCandidateへのフィールド追加
変更: lib/data.ts                 … readEvaluation両経路にmarket・earnings対応 / readEarnings()追加
変更: scripts/evaluate_candidates.ts … earnings読込 / data/market.json 出力
変更: scripts/snapshot_signals.ts … data/market.json をスナップショットへ転記
変更: scripts/fetch_prices.py     … marketIndexCode の取得追加
変更: lib/backtest/engine.ts      … EngineOptions.earnings / TradeRecord・CohortRecord拡張
変更: lib/backtest/report.ts      … marketRegimeBand() / earningsBand() 追加
変更: scripts/backtest.ts         … CLIオーバーライド / レジーム・決算バンド集計 / trades.csv列追加
変更: scripts/analyze_signals.ts  … 旧スナップショット互換 / CSV列追加 / 地合い別集計
変更: app/page.tsx                … 地合いメトリクスカード追加
変更: components/StockDetail.tsx  … 「次回決算」行の追加
変更: tests/evaluator.test.ts     … 市場・決算フィルターのテスト追加
変更: tests/calendar.test.ts(新規) … weekdaysBetweenのテスト
変更: tests/snapshot.test.ts      … 新フィールドのテスト追加
変更: tests/report.test.ts        … 新バンド関数の境界テスト
変更: README.md                   … 両機能の説明 / earnings.csv仕様 / 未実装リストから「TOPIX比較」「決算日フィルター」削除
新規: docs/backtest-results/2026-07-market-filter.md … M5の検証記録
```

依存パッケージの追加は不要(Python側も yfinance のみで変更なし)。

---

## Part A: 地合い(市場レジーム)フィルター

### A-1. 設定(`config/rules.json` / `Rules` 型)

```jsonc
"marketIndexCode": "1306",   // 市場レジーム指標のcode。prices.csv内で引く。"^"始まりはyfinanceティッカーそのまま扱い
"marketFilterMode": "flag",  // "off" | "flag" | "exclude"(QualityFilterMode を再利用)
```

- 1306 = NEXT FUNDS TOPIX連動型上場投信。日経平均で見たい場合は `"1321"`(日経225連動ETF)に変えるだけでよい(READMEに記載)。
- `QualityFilterMode` 型をそのまま使う(意味は既存と完全に同じ: off=無効 / flag=理由表示のみ / exclude=buy_candidate→watch降格)。

### A-2. データ取得(`scripts/fetch_prices.py`)

- `config/rules.json` を読んで `marketIndexCode` を取得し、ウォッチリストのユニークcode一覧の**末尾に追加**する(既にウォッチリストに含まれる場合は重複させない。既存の `unique_codes` の seen 集合を使う)。
- ティッカー変換は既存と同じ `f"{code}.T"`。ただし code が `"^"` で始まる場合(例 `^N225`)はそのまま使う(normalize_codeも通さない)。
- 末尾追加なので、当日分足から `prices_as_of` を決める既存ロジック(最初に成功したcodeで確定)には影響しない。
- これにより `data/prices.csv` / `data/prices_backtest.csv` に code=1306 の行が自動で入り、evaluator・バックテスト両方に流れる。**既存の prices_backtest.csv には1306が無いため、M5の検証前に再取得が必要**(セクション M5 参照)。

### A-3. 市場レジームの計算(`lib/evaluator.ts` / `lib/types.ts`)

`lib/types.ts` に追加:

```ts
/** 市場レジーム指標(TOPIX連動ETF等)の当日状態。指標データが無い/不足のときは EvaluationOutput.market = null */
export interface MarketCondition {
  code: string;
  date: string;
  close: number;
  ma25: number | null;
  ma25Deviation: number | null;
  ma25Trend: Trend;
  /** 地合いOK = 終値が25日線より上 かつ 25日線が上向き。ma25計算不能ならnull(不罰) */
  regimeOk: boolean | null;
}
```

`EvaluationOutput` に `market: MarketCondition | null;` を追加。

`lib/evaluator.ts` の `evaluateCandidates` 内、drafts を作る前に計算する:

```ts
function marketConditionOf(pricesByCode: Map<string, PriceRow[]>, rules: Rules): MarketCondition | null {
  const rows = pricesByCode.get(rules.marketIndexCode) ?? [];
  if (rows.length < rules.maMiddle + 1) return null;   // ma25 + 前日ma25(トレンド)に必要な行数
  // 最新行の close / movingAverageAt(closes, latest, maMiddle) / trendFrom(ma25, prevMa25, trendFlatTolerance)
  // deviation(close, ma25) を使う(いずれも既存の lib/indicators.ts)
  // regimeOk = ma25 !== null && close > ma25 && ma25Trend === "up"
}
```

- `pricesByCode` は既存の `groupPricesByCode(prices)` の結果を使う(date昇順ソート済み)。
- `trendFlatTolerance`(既定0)を `trendFrom` に渡す — 個別銘柄の25日線トレンド判定と同じ定義に揃える。"flat" は up ではないので regimeOk=false(地合いOKは「明確に上向き」のときだけ)。
- `EvaluationOutput` の `market` に入れて返す。

### A-4. 分類(`classifyCandidate`)

シグネチャに市場レジームを追加する: `classifyCandidate(draft, themeScoreValue, rules, marketRegimeOk: boolean | null)`。

buy_candidate を返す直前の既存 `qualityExcluded` ガードに条件を1つ足す(同じ式に || で追加):

```ts
const qualityExcluded =
  (rules.stopTightFilterMode === "exclude" && !draft.conditions.stopNotTooTight) ||
  (rules.volumeFilterMode === "exclude" && !draft.conditions.volumeDryUp) ||
  (rules.marketFilterMode === "exclude" && marketRegimeOk === false);
```

- `marketRegimeOk === false` の厳密比較が重要(null=測定不能は罰しない)。
- `"flag"` / `"off"` では分類に影響しない。

### A-5. 理由表示

新しい理由キー `market_regime_weak`:

```
label:  "地合いが弱い（市場が25日線条件を満たさない）"
detail: `${market.code} 終値 ${close.toFixed(0)} / 25日線 ${ma25.toFixed(1)}（乖離 ${(ma25Deviation*100).toFixed(2)}% / トレンド ${ma25Trend}）`
```

- `marketFilterMode !== "off"` かつ `regimeOk === false` のとき、**価格データのある全候補**(close !== null)の reasons に追加する。buy_candidate では既存の品質フラグと同様 `buy_setup_ready` の後ろに付ける(実装: `reasonsForCandidate` にmarketを渡し、`qualityFlagReasons` と同じ2箇所 — buy_candidate の早期return内と通常フロー — に追加。既存の `qualityFlags` 配列に混ぜてよい)。
- 全候補に付ける理由: 地合いは全銘柄に等しくかかるマスタースイッチであり、スナップショットの `reasonKeys` に残ることで `analyze:signals` の理由別成績集計にそのまま乗る。UI上のバッジ増加は許容する(1個だけ)。

### A-6. 出力・スナップショット・UI

- `scripts/evaluate_candidates.ts`: `result.market` を `data/market.json` へ書き出す(`JSON.stringify(result.market, null, 2)`。nullでも `null\n` を書く)。
- `lib/data.ts` の `readEvaluation()`: 生成済み分岐では `readJsonFile<MarketCondition | null>("data/market.json", null)` を market に入れる。フォールバック分岐(その場評価)は `evaluateCandidates` の結果に含まれる。
- `lib/snapshot.ts`: `SignalSnapshot` に `market: MarketCondition | null;` を追加し、`buildSnapshot(candidates, themeScores, rulesHash, market, generatedAt?)` に引数を追加する。`scripts/snapshot_signals.ts` は `data/market.json` を読んで渡す(ファイルが無ければ null)。旧スナップショットには market が無い → 読み手は `?? null` 吸収(A-8)。
- `app/page.tsx`: 「候補件数」メトリクス列に地合いカードを1枚追加する。表示例 — ラベル「地合い(1306)」、値「OK / NG / 不明」、下に小さく「25日線乖離 +1.2%・上向き」。スタイルは既存の `metric` クラスに合わせ、NG時は既存の警告系スタイル(無ければ `style={{color:"#dc2626"}}` 程度の最小限)で目立たせる。`app/candidates/page.tsx` のヘッダーにも同じ1行(「地合い: OK(+1.2%・上向き)」)をテキストで追加する。専用コンポーネントを作るなら `components/MarketBadge.tsx`(小さければインラインでも可)。

### A-7. バックテスト統合

- `lib/backtest/engine.ts`: 日次ループ内で `const marketRegimeOk = result.market?.regimeOk ?? null;` を取り、`TradeRecord` と `CohortRecord` に `marketRegimeOk: boolean | null` を追加・転記する。
- `lib/backtest/report.ts`:
  ```ts
  export const MARKET_REGIME_BANDS = ["OK", "NG", "不明"] as const;
  export function marketRegimeBand(v: boolean | null): string  // true→"OK", false→"NG", null→"不明"
  ```
- `scripts/backtest.ts`:
  1. CLIオーバーライド `--market-filter off|flag|exclude` を既存の `filterModeOf` で追加(rules コピーに上書き)。
  2. `summary.params` に `marketFilterMode` / `marketIndexCode` を追加。
  3. `summary.breakdowns.marketRegime`(bandBreakdown)と `summary.cohortsByBand.marketRegime`({buy_candidate, watch})を追加し、`printBreakdown` / `printCohortBands` で表示。**コホート表が本命**(執行モデル非依存で「地合いNG日の買い候補はその後のリターンが本当に悪いのか」を直接読む)。
  4. `trades.csv` に `marketRegimeOk` 列を追加(null は空文字)。
  5. prices 読み込み後、`marketIndexCode` の行が1行も無ければ `console.error` で警告を1回出す(「地合いフィルター・レジーム集計は不発になります。fetch_prices.py で再取得してください」)。exit はしない。

### A-8. analyze_signals の互換と集計

- 旧スナップショットに `market` フィールドは無い → `snapshot.market?.regimeOk ?? null` で吸収。
- 出力CSVに `marketRegimeOk` 列を追加(旧スナップショット由来の行は空)。
- サマリ表に「status × 地合い(OK/NG/不明)」の1表を追加する(buy_candidate と watch のみで十分。既存の status別表と同じ統計量)。

---

## Part B: 決算日フィルター

### B-1. データ(`data/earnings.csv`・手動管理)

```csv
code,earningsDate,memo
7011,2026-08-04,1Q決算
5803,2026-08-08,
```

- 1行 = 1決算イベント。`code`: 銘柄コード(watchlistと同じ扱い・normalize_codeで正規化)。`earningsDate`: 発表日 YYYY-MM-DD。`memo`: 自由記述(省略可)。
- **四半期ごとに手動で追記**する。発表日は証券会社アプリ・会社IRページ・適時開示カレンダーで確認する。
- **過去の行は消さない**。履歴として残すことで、将来 `earnings.csv` に決算履歴が溜まれば、バックテスト(`--earnings-filter` A/B)で「決算またぎ除外は本当に効いたか」を検証できるようになる。
- リポジトリには**ヘッダー行のみのファイルを新規作成**してコミットする(空でも全機能が動く=不発なだけ)。
- ファイルが存在しない場合も全読み手はエラーにせず空扱いにする(オプショナルなデータソース)。ただし**存在して不正な行があれば行番号付きでエラー**(手動データの前例 `toExecutionRows` と同じ思想)。

### B-2. ローダー(`lib/csv.ts`)

```ts
export interface EarningsRow {
  code: string;
  earningsDate: string; // YYYY-MM-DD
  memo: string;
}

/** data/earnings.csv のパース。不正行は行番号付きエラー(toExecutionRowsと同じ思想) */
export function toEarningsRows(text: string): EarningsRow[]
```

- 検証: `earningsDate` は `/^\d{4}-\d{2}-\d{2}$/`、`code` は空でないこと。code は `normalizeCode` を通す。
- 同一銘柄の複数行(四半期ごと)は当然許可。日付昇順にソートして返す。

### B-3. 平日カウント(`lib/calendar.ts`・新規)

```ts
/**
 * from(exclusive)からto(inclusive)までの平日(月〜金)の数。祝日は考慮しない(近似)。
 * to === from は 0。呼び出し側で to >= from を保証すること(from > to の入力は 0 を返す)。
 * O(1)(全週×5 + 端数)で計算する — バックテストで銘柄×営業日ごとに呼ばれるため。
 */
export function weekdaysBetween(from: string, to: string): number
```

- 日付は `Date.UTC` ベースでパースし、タイムゾーンに依存しないこと(`new Date("YYYY-MM-DD")` はUTC解釈なのでそのままでよいが、`getUTCDay()` を使うこと)。

### B-4. 設定と測定(`config/rules.json` / `lib/evaluator.ts`)

```jsonc
"earningsExclusionDays": 3,      // 発表の何営業日前から買い候補を除外するか(0=発表当日のみ)
"earningsFilterMode": "exclude", // "off" | "flag" | "exclude"(設計方針3の理由で既定exclude)
```

`evaluateCandidates` のシグネチャに earnings を追加する(後方互換のためデフォルト値付き):

```ts
export function evaluateCandidates(
  watchlist: WatchlistRow[],
  prices: PriceRow[],
  rules: Rules,
  generatedAt = new Date().toISOString(),
  earnings: EarningsRow[] = []
): EvaluationOutput
```

- 冒頭で `Map<code, string[]>`(日付昇順)を作り、`evaluateStock` にその銘柄の日付配列を渡す。
- `evaluateStock` 内(**基準日は必ず `latest.date`**。"今日"ではない — バックテストの過去日評価で正しく効かせるため):
  ```ts
  const nextEarningsDate = earningsDates.find((d) => d >= latest.date) ?? null;
  const daysToEarnings = nextEarningsDate === null ? null : weekdaysBetween(latest.date, nextEarningsDate);
  ```
- `CandidateResult` に追加(insufficientCandidate では両方 null):
  ```ts
  nextEarningsDate: string | null;
  daysToEarnings: number | null;
  ```
- conditions に追加(配点キーが無いため個別スコアには加点されない — 既存の stopNotTooTight と同じ仕組み):
  ```ts
  noEarningsSoon: daysToEarnings === null || daysToEarnings > rules.earningsExclusionDays
  ```
- `daysToEarnings === 0`(評価日=発表日)も除外窓に**含む**: 発表は通常引け後で、シグナル自体が発表前の株価に基づくため翌朝エントリーの根拠として無効。発表翌日以降は `nextEarningsDate` が次の四半期に飛ぶ(またはnull)ので自然に解除される。

### B-5. 分類・理由

- `classifyCandidate` の `qualityExcluded` に追加: `(rules.earningsFilterMode === "exclude" && !draft.conditions.noEarningsSoon)`。
- 理由キー `earnings_soon`(`qualityFlagReasons` に追加。mode !== "off" かつ条件false のとき):
  ```
  label:  "決算発表が近い"
  detail: `次回決算 ${nextEarningsDate}（あと${daysToEarnings}営業日） / 発表${rules.earningsExclusionDays}営業日前から買い見送り`
  ```

### B-6. 読み手の配線

- `scripts/evaluate_candidates.ts` と `lib/data.ts`: `data/earnings.csv` が存在すれば `toEarningsRows` で読み、`evaluateCandidates` に渡す。`lib/data.ts` には `readEarnings(): EarningsRow[]`(existsSyncガード付き)を追加し、フォールバック分岐で使う。
- `lib/backtest/engine.ts`: `EngineOptions` に `earnings?: EarningsRow[]` を追加し、日次の `evaluateCandidates` 呼び出しに渡す(全期間同じリストでよい — 各評価日で「その日以降の最初の日付」を引くので、履歴入りCSVなら過去日評価でも正しく効く)。
- `scripts/backtest.ts`: `--earnings <path>`(既定 `data/earnings.csv`。存在しなければ空)で読み込み、`--earnings-filter off|flag|exclude` オーバーライドを追加。`summary.params` に `earningsFilterMode` を追加。
- `TradeRecord` / `CohortRecord` に `daysToEarnings: number | null` を転記。
- `lib/backtest/report.ts`:
  ```ts
  export const EARNINGS_BANDS = ["0-3日", "4-10日", ">10日", "不明"] as const;
  export function earningsBand(v: number | null): string
  ```
  0-3 の境界は `earningsExclusionDays` 既定値に一致させる(変更時は読み替える旨をコメント)。
- `scripts/backtest.ts`: `summary.breakdowns.earningsProximity` と `summary.cohortsByBand.earningsProximity` を追加、`trades.csv` に `daysToEarnings` 列。今は earnings.csv が空でも全行「不明」で表が出るだけ(壊れない)。
- スナップショット: `SlimCandidate` に `nextEarningsDate` / `daysToEarnings` を追加・転記。`scripts/analyze_signals.ts` は `?? null` 吸収 + CSV列 `daysToEarnings` 追加。
- UI: `components/StockDetail.tsx` に Detail行「次回決算」を追加 — `nextEarningsDate`(あとX営業日)、null なら「未登録」。候補テーブルへの列追加はしない(理由バッジで見えるため)。

---

## 6. config/rules.json の差分(全文)

`volumeFilterMode` の後・`themeScoringMode` の前に追加:

```jsonc
"marketIndexCode": "1306",
"marketFilterMode": "flag",
"earningsExclusionDays": 3,
"earningsFilterMode": "exclude",
```

`lib/types.ts` の `Rules` に対応する型を追加:

```ts
// Rules に:
// marketIndexCode: string;
// marketFilterMode: QualityFilterMode;
// earningsExclusionDays: number;
// earningsFilterMode: QualityFilterMode;
```

`CandidateResult` への追加は B-4(nextEarningsDate / daysToEarnings)、`EvaluationOutput` への追加は A-3(market)を参照。

rules.json が変わるため rulesHash も変わる(設計どおり `data/history/rules/` で版が分かれる)。

## 7. テスト計画

### tests/calendar.test.ts(新規)

1. 同日 → 0。金→翌月 → 1。水→金 → 2。金→翌々月(週またぎ) → 6。
2. 2週間超のスパンで手計算と一致(O(1)式の検証)。from > to → 0。

### tests/evaluator.test.ts(追加)

市場フィルター(フィクスチャに code=1306 の価格系列を追加して検証):

1. **レジーム計算**: 終値>MA25かつMA25上向き → market.regimeOk=true / 終値<MA25 → false / MA25下向き → false / 指標行なし・行数不足 → market=null。
2. **flag**: regimeOk=false でも buy_candidate は buy のまま、全評価可能候補の reasons に `market_regime_weak` が付く。
3. **exclude**: buy相当のフィクスチャが watch に降格し理由が付く。watch/avoid の status は変わらない。
4. **off / market=null**: 理由も降格もなし(nullはexcludeモードでも罰しない)。
5. **個別スコア不変**: regimeOk=false でも individualScore が変わらない。

決算フィルター:

6. **最近接日付**: 過去日は無視し評価日以降の最初の日付を選ぶ(複数行・順不同入力)。評価日=発表日 → daysToEarnings=0。
7. **境界**: daysToEarnings=3(=earningsExclusionDays) → 条件false(除外窓内) / 4 → 条件true。
8. **モード動作**: exclude → buy→watch降格+理由 / flag → buyのまま+理由 / off → 影響なし / earnings空 → 影響なし。
9. **バックテスト整合**: `latest.date` 基準であること(過去日フィクスチャで、評価日より後の「当時の未来」決算日が効く)。

### tests/csv系(evaluator.test.ts 内か新設どちらでも)

10. `toEarningsRows`: 正常パース・日付昇順ソート・不正日付/空codeで行番号付きエラー。

### tests/snapshot.test.ts(追加)

11. `buildSnapshot` が market を転記する(null含む)。`toSlimCandidate` が nextEarningsDate / daysToEarnings を転記する。

### tests/report.test.ts(追加)

12. `marketRegimeBand`(true/false/null)と `earningsBand` の境界(0,3→"0-3日"、4,10→"4-10日"、11→">10日"、null→"不明")。

### 回帰(重要)

13. 既存テストが全部そのまま通ること = 「1306の価格行なし + earnings空 + 新モード既定値」で従来の判定結果が完全に一致することの担保。既存フィクスチャは市場データを含まないため、market=null(不罰)で全既存テストは無変更で通るはず。通らなければ実装が方針4(null不罰)に違反している。

### 手動検証(受け入れ確認)

- `npm run typecheck && npm test` が通る。
- `python3 scripts/fetch_prices.py` 後、`data/prices.csv` に code=1306 の行がある。
- `npm run evaluate` で `data/market.json` が生成され、`data/candidates.json` に新フィールドが載る。
- トップページに地合いカード、銘柄詳細に「次回決算」行が表示される。
- `earnings.csv` に「明日の日付+ウォッチリスト銘柄」を仮追記して evaluate すると、該当銘柄に `earnings_soon` が付き(買い候補だった場合)watchに降格する。確認後、仮行は削除する。
- `npm run backtest` がエラーなく完走し、summary.json の params に新モードが記録される(1306なしデータでは警告が出る)。

## 8. 実装順序(マイルストーン)

1. **M1(コア・Opus)**: types + rules.json + calendar + csvローダー + evaluator(A-3〜A-5, B-4〜B-5)+ snapshot + data.ts + evaluate_candidates.ts + snapshot_signals.ts + テスト(1〜11, 13)。この時点で市場データ・決算データが無い環境では**判定が完全に無変更**であることを既存テストで確認。
2. **M2(バックテスト・Opus)**: engine / report / backtest.ts / analyze_signals.ts + テスト(12)+ `npm run backtest` スモーク(既存 prices_backtest.csv で警告つき完走)。
3. **M3(周辺・Sonnet)**: fetch_prices.py + data/earnings.csv(ヘッダーのみ)+ UI(app/page.tsx, app/candidates/page.tsx, components/StockDetail.tsx)+ README(判定ロジック概要のreasonsリストに `market_regime_weak`/`earnings_soon` 追加、地合い・決算セクション新設、earnings.csv仕様、未実装リストから「TOPIX比較」「決算日フィルター」を削除)。
4. **M5(検証・既定値決定)**: データ再取得と地合いフィルターのA/B検証(下記)。結果と判断を `docs/backtest-results/2026-07-market-filter.md` に記録。昇格する場合の rules.json 変更(`marketFilterMode: "exclude"`)は**独立コミット**にする(問題時に設定だけ戻せるように)。

各マイルストーンで `npm run typecheck && npm test` を通すこと。

### M5の検証手順と採用基準

```bash
# 1306入りのデータを再取得
python3 scripts/fetch_prices.py                       # 本番用1y
python3 scripts/fetch_prices.py --period 2y --output data/prices_backtest.csv --no-intraday --auto-adjust

# ベースライン(地合い測定のみ・分類に影響なし)
npm run backtest -- --market-filter flag --out data/backtest/market-baseline
# 地合いexcludeの効果
npm run backtest -- --market-filter exclude --out data/backtest/market-exclude
```

読み方と採用基準:

- **主指標は最大ドローダウンと期待値R**。地合いフィルターの目的は「地合い崩壊時の連敗回避」なので、期待値Rの改善だけでなく **最大ドローダウン(円)の改善**を重視する。
- exclude採用の条件: (1)ベースライン比で期待値Rが改善または同等、(2)最大ドローダウンが明確に改善、(3)約定数がベースラインの60%以上残る、(4)コホート表(marketRegime別)で NG日の buy_candidate の fwd5/fwd20 が OK日より明確に劣る。
- 4条件を満たさなければ `"flag"` のまま運用し、シグナル履歴が溜まった時点で `npm run analyze:signals` の地合い別集計で再判定する。
- 注意: 2年データのうち地合いNG日が少ない場合、統計が薄いことをそのまま記録する(無理に昇格しない)。ウォッチリストの後知恵バイアス等、既存のCAVEATSはすべて適用される。
- 決算フィルターの検証は今回はスコープ外(earnings.csvに履歴が無いため)。履歴が溜まった後に `npm run backtest -- --earnings-filter off` とのA/Bで「決算またぎトレードの成績」を検証できる(そのための daysToEarnings バンド集計は M2 で実装済み)。

## 9. 将来の拡張(今回は実装しない)

- 地合いの複数指標合成(TOPIXとN225のAND/OR、グロース市場指数の分岐)や強度の連続値化(乖離%ベース)。
- 地合いNG時の**保有ポジション**の扱い(exit前倒し・トレイル切替)— 現状はエントリー抑制のみ。
- 決算日の半自動取得(J-Quants APIは無料プランで決算発表予定日が取れる。手動CSVの上書き元として)。
- 決算発表**後**N日間の再エントリー抑制(ギャップ後の乱高下回避)。
- 祝日カレンダー(内閣府CSV)による正確な営業日計算。
