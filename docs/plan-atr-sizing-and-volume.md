# 実装計画: ATR損切り品質チェック・リスクベース建玉 + 出来高ドライアップ判定

このドキュメントは、5日線押し目チェッカーに以下の2機能を追加するための実装計画である。実装者(AIエージェントを含む)がこのファイルだけを読んで作業を完遂できることを目的とする。

- **Part A+B(提案4): 損切り幅と建玉サイズの設計** — ATR(平均的な値幅)に対して損切りラインが近すぎる「ノイズ狩られ」候補を検出する(Part A)。固定100株をやめ、「リスク許容額 ÷ 1株あたりリスク」から株数を決めるリスクベース建玉に切り替える(Part B)。
- **Part C(提案5): 出来高ドライアップ判定** — 押し目形成中に出来高が20日平均より減っている(売り圧力が枯れている)かを測定・判定する。
- **Part D: バックテスト統合** — 上記すべてを既存のバックテスト基盤(`lib/backtest/`)に接続し、「効くのか」をデータで検証してから既定値を決める。

## 0. 前提知識(現状のアーキテクチャ)

`docs/plan-signal-logger-and-backtest.md` の前提知識セクションがすべて有効。本計画に特に関係する点だけ再掲する。

- 判定ロジックの唯一の実装は `lib/evaluator.ts` の `evaluateCandidates(watchlist, prices, rules, generatedAt)`。**ロジックの二重実装は禁止**。
- 現状の主要な値: `entryPrice = MA5×1.005`、`stopLoss = 前日安値(previous.low)`、`riskR = entryPrice − stopLoss`(1株あたりリスク円)、`expectedLoss = riskR × rules.defaultShares(=100株固定)`、`takeProfit1 = 直近20日高値`。
- 個別スコアは `lib/scoring.ts` の `scoreIndividual` で6条件×固定配点=100点満点。閾値85(買い)/70(監視)はこの100点スケールに紐づいている。
- `classifyCandidate`(evaluator.ts)が status を決める: ハード除外(25日線下向き・25日線割れ・expectedLoss≤0または>maxLossYen)→avoid、個別85×テーマ80×リワードR≥1.0→buy_candidate、それ以外の一定条件→watch。
- `PriceRow` は `code,date,open,high,low,close,volume` を持ち、**volumeは既に取得済みだが判定に未使用**。
- 場中実行時は当日行が「部分バー」(その時点までの分足集計)。確定値のスナップショットは16:30 JSTのcronで取られる。
- バックテスト: `lib/backtest/engine.ts`(日次ループ)+ `lib/backtest/simulate.ts`(1トレードの約定・決済。`options.shares` は既に引数)+ `lib/backtest/report.ts`(統計・表示ヘルパー)+ `scripts/backtest.ts`(CLI)。
- スナップショット: `lib/snapshot.ts` の `SlimCandidate` が日次履歴(`data/history/signals/`)に保存される形式。`scripts/analyze_signals.ts` がそれを読む。
- テスト: `npm test`(node:test + tsx)。型チェック: `npm run typecheck`。
- 参考(考え方の移植元): `jp-momentum-monitor/src/momentum_monitor/analysis.py` の `calc_lot_price` / `calc_lots_possible` / `calc_first_lot_ratio`(資金量・単元制約の扱い)。コードは移植しない。考え方のみ。

## 1. 設計方針(先に読む・重要な決定事項)

1. **「測定 → flag → バックテスト検証 → exclude昇格」の段階導入**。新しい判定条件(損切りタイト・出来高)はいきなり候補を落とさず、まず全候補に測定値を付け、`flag`(理由として表示するだけ)で運用し、バックテストのバンド別成績で効果が確認できたものだけ `exclude`(買い候補から降格)に昇格する。モードは `rules.json` で切り替え可能にする: `"off" | "flag" | "exclude"`。
2. **個別スコアの配点(100点満点・6条件)は変えない**。85/70の閾値の意味を維持するため、新条件はスコア外の独立したゲートとして実装する。`scoreIndividual` と `ScoringWeights` は無変更。
3. **損切りドクトリン(前日安値・前日に決めた位置から下げない)は変えない**。ATRは損切り位置を動かすためではなく「その損切り位置は狩られやすくないか」の品質判定にのみ使う。ATRで損切りを広げる案は将来拡張(本計画のスコープ外)。
4. **リスクベース建玉は、単元100株・投入額上限なしの設定では現行と同じ銘柄集合を出す**(数学的に等価: `floor(maxLossYen/riskR/100)×100 ≥ 100 ⇔ riskR×100 ≤ maxLossYen`)。変わるのは「推奨株数」「想定損失の表示」「バックテストの損益額」のみ。この等価性(パリティ)はテストで保証する。したがって `sizingMode` の既定値を最初から `"risk"` にしても判定は変わらず、安全に切り替えられる。
5. **exclude時の降格先は watch であって avoid ではない**。損切りがタイト・出来高が減っていないのは「シナリオ崩壊」ではなく「押し目の質が低い」問題のため。
6. 非目標(本計画ではやらない): 地合いフィルター(TOPIX)、決算日フィルター、テーマスコアの連続値化、ATRによる損切り位置の変更、手数料・スリッページ。

## 2. 全体像(新規・変更ファイル)

```
変更: lib/indicators.ts        … averageTrueRangeAt() 追加
変更: lib/types.ts             … Rules拡張 / CandidateResult拡張(atr, stopDistanceAtr, volume系, suggestedShares, positionCost)
変更: config/rules.json        … 新キー11個(セクション9に全文)
変更: lib/evaluator.ts         … 測定値の計算 / 建玉計算 / 条件・理由・分類の拡張
変更: lib/snapshot.ts          … SlimCandidateへのフィールド追加
変更: lib/backtest/engine.ts   … トレード株数のsizing対応 / TradeRecord・CohortRecord拡張
変更: lib/backtest/report.ts   … stopAtrBand() / volumeRatioBand() 追加
変更: scripts/backtest.ts      … CLIオーバーライド / バンド別集計表 / trades.csv列追加
変更: scripts/analyze_signals.ts … 旧スナップショット互換(新フィールドundefined許容) / CSV列追加
変更: components/StockDetail.tsx / components/CandidateTable.tsx … 表示追加(最小限)
変更: tests/evaluator.test.ts  … ATR・建玉・パリティ・フィルターのテスト追加
変更: tests/snapshot.test.ts   … 新フィールドのテスト追加
変更: README.md                … ルール説明・検証手順・未実装リストから「出来高判定」削除
新規: docs/backtest-results/   … A/B検証結果の記録置き場(M5で作成)
```

依存パッケージの追加は不要。`scripts/evaluate_candidates.ts` は `CandidateResult` をそのまま直列化しているため変更不要(新フィールドは自動で `data/candidates.json` に載る)。

---

## Part A: ATRと損切り品質チェック(提案4前半)

### A-1. ATRの定義(`lib/indicators.ts`)

```ts
/** True Range: max(high-low, |high-prevClose|, |low-prevClose|)。endIndexの位置のTRを含む直近period本の単純平均。
    prevCloseが必要なため endIndex-period >= 0 でなければ null。 */
export function averageTrueRangeAt(rows: PriceRow[], endIndex: number, period: number): number | null
```

- Wilder平滑ではなく**TRの単純移動平均**を採用(実装が単純・決定的・テスト容易。目的は絶対値の精密さではなく相対的な値幅の物差し)。
- `rows` は date昇順前提(evaluatorの `groupPricesByCode` 済み配列を渡す)。
- 必要行数は `period+1`(prevClose分)。evaluatorの最低行数(26行)≥ atrPeriod(14)+1 なので、評価可能な銘柄では常に計算できる。
- 場中は当日行が部分バーのためTR(当日)が小さめに出る。これは既存のMA系と同じ性質であり許容する(確定判定は16:30スナップショット)。コードコメントで明記。

### A-2. 損切り距離の測定(`lib/evaluator.ts`)

`evaluateStock` に追加:

```ts
const atr = averageTrueRangeAt(prices, latestIndex, rules.atrPeriod);
const stopDistanceAtr = atr !== null && atr > 0 && riskR !== null ? riskR / atr : null;
```

- `riskR = entryPrice − stopLoss` は既存フィールドをそのまま使う(1株あたりリスク円)。
- `CandidateResult` に `atr: number | null` と `stopDistanceAtr: number | null` を追加。`insufficientCandidate` では両方 null。

### A-3. 条件とモード

`conditions` オブジェクトに追加(**`scoreIndividual` には渡るが配点キーが無いため加点されない**。`IndividualScoreInput` は構造的部分型なので型エラーにならない。`ScoringWeights` は変更しない):

```ts
stopNotTooTight: stopDistanceAtr === null || stopDistanceAtr >= rules.stopAtrMinMultiple
```

- **null(計算不能)は true 扱い**=罰しない。フラグは明確な違反時のみ立てる。
- `classifyCandidate`: `rules.stopTightFilterMode === "exclude"` かつ `!conditions.stopNotTooTight` のとき、buy_candidate 判定を満たしていても **watch に降格**する(avoidにしない。既存のhardFailには入れない)。実装は buy_candidate を返す直前のガードとして追加。
- `"flag"` / `"off"` では分類に影響しない。

### A-4. 理由表示(`reasonsForCandidate`)

新しい理由キー `stop_too_tight`:

```
label:  "損切りラインが近すぎる（ノイズ域）"
detail: `損切り幅 ${riskR.toFixed(0)}円 = ${stopDistanceAtr.toFixed(2)} ATR / 最低 ${rules.stopAtrMinMultiple} ATR`
```

- モードが `"flag"` または `"exclude"` で条件falseのとき理由に追加する。`"off"` では追加しない。
- **buy_candidate の早期return(`buy_setup_ready` のみ返す箇所)を変更**し、flagモードの警告理由(本キーとPart Cの `volume_not_dry`)は buy_candidate でも `buy_setup_ready` の後ろに付けて返す(passed=false)。UI(RuleBadge)は reasons をそのまま表示するので買い候補にも警告が見えるようになる。

---

## Part B: リスクベース建玉(提案4後半)

### B-1. 設定(`config/rules.json` / `Rules` 型)

```jsonc
"sizingMode": "risk",          // "fixed" | "risk"。fixed = 現行(defaultShares固定)
"lotSize": 100,                // 単元株数
"allowFractionalShares": false, // true = 単元未満株(S株等)を許可し1株単位で計算
"maxPositionYen": null         // 1銘柄あたり投入額上限(円)。null = 上限なし。number | null
```

- 既定値を `"risk"` にしてよい根拠は設計方針4(パリティ)。`maxPositionYen` の既定は **null**(現行too同様に上限なし。nullなら銘柄集合が変わらないことがパリティの前提)。READMEに「自分の1銘柄あたり投入上限に合わせて設定すること(例: 500000)」と明記する。
- `defaultShares` は残す(fixedモードとバックテストのフォールバックで使用)。

### B-2. 株数の計算(`lib/evaluator.ts`)

```ts
function suggestedSharesFor(entryPrice: number | null, riskR: number | null, rules: Rules): number | null {
  if (rules.sizingMode === "fixed") return rules.defaultShares;
  if (entryPrice === null || riskR === null || riskR <= 0) return null;
  let raw = rules.maxLossYen / riskR;                                   // リスク許容から決まる株数上限
  if (rules.maxPositionYen !== null) raw = Math.min(raw, rules.maxPositionYen / entryPrice); // 資金上限
  return rules.allowFractionalShares ? Math.floor(raw) : Math.floor(raw / rules.lotSize) * rules.lotSize;
}
```

- `suggestedShares: number | null` と `positionCost: number | null`(`= entryPrice × suggestedShares`)を `CandidateResult` に追加。
- **`expectedLoss` の定義を変更**: `riskR × suggestedShares`(riskモード。suggestedShares=0なら expectedLoss=0)。fixedモードでは現行どおり `max(0, riskR × defaultShares)`。
- `conditions.expectedLossWithinLimit` は式を変えない(`expectedLoss > 0 && expectedLoss <= maxLossYen`)。riskモードで株数0(=リスクが1単元でも予算超過)なら expectedLoss=0 で自然に落ちる — 現行の「riskR×100 > 12000で落ちる」と同値。
- stop ≥ entry(riskR ≤ 0)のケース: suggestedShares=null、expectedLoss=null → `classifyCandidate` の既存nullガードで avoid。現行も expectedLoss=0 → hardFail で avoid なので status は同じ(パリティテストの対象に含める)。

### B-3. パリティの保証(最重要テスト)

`lotSize=100` かつ `maxPositionYen=null` のとき、**全銘柄・全条件で status(buy_candidate/watch/avoid)と individualScore が sizingMode="fixed" と "risk" で一致**することをテストで保証する(tests/evaluator.test.ts。フィクスチャ価格系列で `evaluateCandidates` を両モードで実行し全candidateのstatus/scoreをdeepEqual)。境界ケース `riskR = maxLossYen/lotSize`(=ちょうど120円)を含めること。

### B-4. UI(最小限)

- `components/StockDetail.tsx`: Detail行を追加 — 「ATR(14日)」「損切り幅(ATR倍)」「推奨株数」「概算投入額」「出来高比(3日/20日)」(Part C含む)。
- `components/CandidateTable.tsx`: 「株数」列(suggestedShares)を「想定損失」の隣に追加(ソート可能キーにも追加)。理由バッジは reasons 経由で自動表示されるため追加作業なし。

---

## Part C: 出来高ドライアップ判定(提案5)

### C-1. 測定(`lib/evaluator.ts`)

既存の `movingAverageAt` を volume 配列に使い回す(新規指標関数は不要):

```ts
const volumes = prices.map((row) => row.volume);
const volumeShortAvg = movingAverageAt(volumes, latestIndex, rules.volumeShortWindow);  // 3日
const volumeLongAvg = movingAverageAt(volumes, latestIndex, rules.volumeLongWindow);    // 20日
const volumeRatio = volumeShortAvg !== null && volumeLongAvg !== null && volumeLongAvg > 0
  ? volumeShortAvg / volumeLongAvg : null;
```

- `CandidateResult` に `volumeShortAvg` / `volumeLongAvg` / `volumeRatio`(いずれも `number | null`)を追加。`insufficientCandidate` は null。
- 押し目局面(5日線乖離±1.5%圏)での「直近3日の出来高が20日平均に対してどれだけ枯れたか」を1つの比率で表す。1.0未満=減少、0.85以下=有意に枯れている、という初期仮説(閾値はPart Dで較正)。

### C-2. 条件とモード

```ts
volumeDryUp: volumeRatio === null || volumeRatio <= rules.volumeDryUpMaxRatio
```

- null は true 扱い(罰しない)。
- `rules.volumeFilterMode`(`"off" | "flag" | "exclude"`、既定 `"flag"`)。動作はPart Aの `stopTightFilterMode` と完全に対称: exclude時は buy_candidate → watch 降格、flag時は理由表示のみ。
- 理由キー `volume_not_dry`:
  ```
  label:  "押し目中も出来高が減っていない"
  detail: `直近${rules.volumeShortWindow}日出来高/20日平均 = ${volumeRatio.toFixed(2)} / 基準 ${rules.volumeDryUpMaxRatio} 以下`
  ```

### C-3. 部分バーの注意(コードコメント + README注意事項に明記)

場中実行では当日行の volume が「その時点までの累積」のため volumeRatio が実際より低く出て、ドライアップ条件が**通りやすく**なる(偽陽性方向)。確定判定は16:30スナップショット/バックテスト(確定日足)で行われる。既存のバックテスト注意事項5(部分バー問題)と同種の制約として README の注意リストに1行追加する。

---

## Part D: バックテスト統合と検証(効果測定の基盤)

### D-1. `lib/backtest/engine.ts`

- トレード株数(**実装時の重要な修正**): 当初案は `candidate.suggestedShares`(シグナル時 = low(D-1)基準)をそのまま使う予定だったが、`stopMode=prev-day` では実際の損切りが low(D) のため、押しの深い日ほど実リスクが maxLossYen を大きく超える(実測で最大ドローダウンが約25万円→309万円に悪化する)ことが判明した。そこで株数は**エントリー時に実際に使う損切り(stopUsed)の幅で再計算**する:
  ```ts
  const stopForSizing = options.stopMode === "prev-day" ? series.rows[series.ptr].low : candidate.stopLoss;
  const entryRiskR = candidate.entryPrice > stopForSizing ? candidate.entryPrice - stopForSizing : null;
  const sized = rules.sizingMode === "risk" ? suggestedSharesFor(candidate.entryPrice, entryRiskR, rules) : null;
  ```
  これはドクトリン(朝9:30に前日安値=low(D)を損切りとして想定損失を確認してから入る)に忠実な挙動でもある。`sized === 0`(1単元でも予算超過)の場合はエントリーせず、`noFillReason: "risk_over_budget"` のno-fillトレードとして記録する(`NoFillReason` 型に追加)。`sized === null`(stop≥entry)は従来どおり simulateTrade が `stop_at_or_above_entry` でno-fillにする。
  `simulateTrade` の `options.shares` に渡す(simulate.tsは型追加以外無変更)。
- `TradeRecord` に追加: `shares: number` / `stopDistanceAtr: number | null` / `volumeRatio: number | null`(candidateから転記)。
- `CohortRecord` に追加: `stopDistanceAtr: number | null` / `volumeRatio: number | null`(生値。バンド化はレポート側)。

### D-2. `lib/backtest/report.ts` — バンド関数

`individualScoreBand` と同じパターンで追加:

```ts
export function stopAtrBand(v: number | null): string
  // null→"不明", <0.3, 0.3-0.6, 0.6-1.0, 1.0-1.5, ≥1.5
export function volumeRatioBand(v: number | null): string
  // null→"不明", <0.6, 0.6-0.85, 0.85-1.0, 1.0-1.3, ≥1.3
```

境界は「0.3(stopAtrMinMultiple既定)」「0.85(volumeDryUpMaxRatio既定)」が必ずバンド境界に一致するように切る(閾値の妥当性を直接読めるようにするため)。

### D-3. `scripts/backtest.ts` — 集計とCSV

1. `trades.csv` に列追加: `shares, stopDistanceAtr, volumeRatio`(null は空文字)。
2. `summary.breakdowns` に追加: `stopAtrBand` / `volumeRatioBand`(既存の `breakdown()` に `stopAtrBand(record.stopDistanceAtr)` 等を渡すだけ)。コンソールにも `printBreakdown` で出力。
3. **コホートのバンド別表(本計画の主目的・執行モデル非依存の検証)**: `cohorts` を `status === "buy_candidate"` と `"watch"` それぞれに絞り、volumeRatioBand別・stopAtrBand別に 件数 / fwd5平均 / fwd5プラス率 / fwd20平均 / fwd20プラス率 を表示・summary.jsonに保存する。「出来高が枯れた押し目は本当にその後のリターンが良いのか」をこの表で直接読む。
4. `summary.params` に `sizingMode` / `stopTightFilterMode` / `volumeFilterMode` / `lotSize` / `maxPositionYen` を追加(rulesHashはファイル由来なのでCLIオーバーライド時の区別に必須)。

### D-4. CLIオーバーライド(A/B比較を rules.json を編集せずに行うため)

`scripts/backtest.ts` の parseArgs に追加し、読み込んだ rules のコピーに上書きしてから `runBacktest` に渡す:

```
--sizing fixed|risk                    (既定: rules.jsonの値)
--stop-tight-filter off|flag|exclude   (同上)
--volume-filter off|flag|exclude       (同上)
```

不正値は既存の `--stop-mode` と同様に exit 1。

### D-5. 検証手順と採用基準(M5で実施し、結果を docs/backtest-results/ に記録)

```bash
python3 scripts/fetch_prices.py --period 2y --output data/prices_backtest.csv --no-intraday --auto-adjust

# ベースライン(現行相当)
npm run backtest -- --sizing fixed --stop-tight-filter off --volume-filter off --out data/backtest/baseline
# リスクベース建玉のみ
npm run backtest -- --sizing risk --stop-tight-filter off --volume-filter off --out data/backtest/risk-sizing
# フィルターexcludeの効果
npm run backtest -- --sizing risk --stop-tight-filter exclude --volume-filter off --out data/backtest/stop-tight
npm run backtest -- --sizing risk --stop-tight-filter off --volume-filter exclude --out data/backtest/volume
npm run backtest -- --sizing risk --stop-tight-filter exclude --volume-filter exclude --out data/backtest/both
```

読み方と採用基準:

- **建玉**: fixed と risk で期待値R・勝率は原則同一(銘柄集合が同じでトレードごとの株数だけ違う)。見るのは **期待値(円)・累積損益・最大ドローダウン** — riskで1トレードあたりのリスクが1.2万円に揃うため、円建て指標が初めてトレード間で比較可能になる。ドローダウンが極端に悪化しないことを確認して採用(判定は変わらないため事実上の確認作業)。
- **フィルター**: exclude採用の条件は「ベースライン比で**期待値Rが改善**し、かつ**約定数がベースラインの60%以上**残る」こと。加えてD-3のコホート表で悪バンド(stopAtr <0.3 / volumeRatio ≥1.0)のfwd5・fwd20が良バンドより明確に劣ることを確認する。基準を満たさないフィルターは `"flag"` のまま運用し、シグナル履歴(実運用スナップショット)が溜まった時点で `npm run analyze:signals` で再判定する。
- ウォッチリストの選択バイアス等、既存の注意事項(backtest.tsのCAVEATS)はすべて本検証にも適用される。

---

## 5. スナップショット・履歴分析の変更

- `lib/snapshot.ts` の `SlimCandidate` / `toSlimCandidate` に追加: `atr, stopDistanceAtr, volumeRatio, suggestedShares, positionCost`(5フィールド。volumeShort/LongAvgは比率があれば復元不要のため保存しない)。
- `scripts/analyze_signals.ts`: 過去のスナップショットには新フィールドが**存在しない**。読み込み時に `undefined` を null に正規化して扱うこと(型は `SlimCandidate` を Partial 的に受ける読み込み専用の型を作るか、`?? null` で吸収)。出力CSVに `suggestedShares, stopDistanceAtr, volumeRatio` 列を追加(旧スナップショット由来の行は空)。
- スナップショット形式が変わるため rulesHash も変わる(config編集による)。これは設計どおり(`data/history/rules/` でルール版が分離される)。

## 6. config/rules.json の差分(全文)

既存キーの末尾(`bbThemeScoreThreshold` の後、`scoring` の前)に追加:

```jsonc
"atrPeriod": 14,
"stopAtrMinMultiple": 0.3,
"stopTightFilterMode": "flag",
"sizingMode": "risk",
"lotSize": 100,
"allowFractionalShares": false,
"maxPositionYen": null,
"volumeShortWindow": 3,
"volumeLongWindow": 20,
"volumeDryUpMaxRatio": 0.85,
"volumeFilterMode": "flag"
```

`lib/types.ts` の `Rules` に対応する型を追加:

```ts
export type QualityFilterMode = "off" | "flag" | "exclude";
export type SizingMode = "fixed" | "risk";
// Rules に: atrPeriod: number; stopAtrMinMultiple: number; stopTightFilterMode: QualityFilterMode;
// sizingMode: SizingMode; lotSize: number; allowFractionalShares: boolean; maxPositionYen: number | null;
// volumeShortWindow: number; volumeLongWindow: number; volumeDryUpMaxRatio: number; volumeFilterMode: QualityFilterMode;
```

`CandidateResult` に追加(すべて既存のnullパターンに合わせる):

```ts
atr: number | null;
stopDistanceAtr: number | null;
volumeShortAvg: number | null;
volumeLongAvg: number | null;
volumeRatio: number | null;
suggestedShares: number | null;
positionCost: number | null;
```

## 7. テスト計画

### tests/evaluator.test.ts(追加)

1. **ATR**: 手計算した3〜4本の人工バー(ギャップを含む: |high−prevClose| が最大になるバーを混ぜる)で `averageTrueRangeAt` の値を検証。行数不足(endIndex−period < 0)で null。
2. **建玉計算**: riskモードで (a) `riskR=30円 → 400株`(floor+単元)、(b) `riskR=120円 → 100株`(境界)、(c) `riskR=121円 → 0株 → expectedLoss=0 → expectedLossWithinLimit false`、(d) `allowFractionalShares=true` で1株単位、(e) `maxPositionYen` 設定時に投入額でキャップされる、(f) `riskR≤0 → null`。
3. **パリティ(B-3)**: フィクスチャ価格系列一式で fixed / risk 両モードの全candidateの status と individualScore が一致(lotSize=100, maxPositionYen=null)。stop≥entry のケースを含める。
4. **出来高**: volumeRatio の計算値検証。20行未満で null。境界(ratio = 0.85 ちょうど → 条件true)。
5. **モード動作**: buy_candidate 相当のフィクスチャで、(a) flagモード: statusは buy_candidate のまま reasons に `stop_too_tight` / `volume_not_dry` が付く、(b) excludeモード: watch に降格し理由が付く、(c) offモード: 理由も降格もなし、(d) 測定値null時はどのモードでも影響なし。
6. **スコア不変**: 新条件が false でも individualScore が変わらない(配点対象外であること)。

### tests/snapshot.test.ts(追加)

- `toSlimCandidate` が新5フィールドを転記すること。

### バックテスト系(tests/simulate.test.ts は無変更。engine/reportに軽く追加)

- `stopAtrBand` / `volumeRatioBand` の境界値(0.3 / 0.85 が正しいバンドに入る)。
- engine: riskモードのフィクスチャで `TradeRecord.shares` が `suggestedShares` になり、pnlYen が株数を反映すること(既存のengineテストがなければ backtest.ts のスモークで代替し、simulate経由の株数反映は evaluator+engine の小さな結合テストを1本書く)。

### 手動検証(受け入れ確認)

- `npm run typecheck && npm test` が通る。
- `npm run evaluate` で `data/candidates.json` に新フィールドが載り、既存フィールドの値が変わらない(sizingMode="risk"でも suggestedShares=100 の銘柄では expectedLoss が従来値と一致することをスポットチェック)。
- flagモードの警告が UI(候補テーブルのバッジ / 銘柄詳細)に表示される。
- D-5 の5本のバックテストがエラーなく完走し、summary.json の params にモードが記録される。

## 8. 実装順序(マイルストーン)

1. **M1(測定)**: indicators(ATR)+ types + rules.json + evaluator の測定フィールド追加(モードは一時的に `"off"`・sizingMode `"fixed"` で入れる)+ snapshot + テスト1,4。**この時点で判定・表示は完全に無変更**であることを `npm run evaluate` の diff で確認。
2. **M2(建玉)**: suggestedSharesFor + expectedLoss再定義 + パリティテスト(テスト2,3)+ UI追加。確認後 rules.json の sizingMode を `"risk"` に切替。
3. **M3(フィルター)**: flag/exclude ロジック + reasons + classifyCandidate ガード + テスト5,6。確認後 rules.json の両フィルターを `"flag"` に切替。
4. **M4(バックテスト統合)**: engine / report / backtest.ts(CLIオーバーライド・バンド集計・CSV列)+ analyze_signals 互換対応 + バンドテスト。
5. **M5(検証と既定値決定)**: D-5 の手順を実行し、結果と判断(excludeに昇格するか)を `docs/backtest-results/2026-07-atr-volume.md` に記録。README更新(ルール説明・注意事項・未実装リストから「出来高判定」を削除)。

各マイルストーンで `npm run typecheck && npm test` を通すこと。M2・M3の rules.json 切替はそれぞれ独立コミットにする(問題時に設定だけ戻せるように)。

## 9. 将来の拡張(今回は実装しない)

- ATRフロア型の損切り(`stop = min(前日安値, entry − k×ATR)`)— simulate.ts の stopMode 追加として実装可能。ドクトリン変更を伴うため、本計画のフィルター検証結果を見てから判断。
- 出来高条件の精緻化(陰線日出来高のみで枯れを測る、出来高急増ブレイクの検出)。
- momentum-monitor 型の資金配分スコア(増し玉段数・初回負担率)の移植 — maxPositionYen 導入後、テーマスコアと組み合わせる形で。
- 決算日フィルター・地合いフィルター(別計画として起こす)。
