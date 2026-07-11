# 実装計画: シグナル履歴ロガー + 過去1年バックテスト

このドキュメントは、5日線押し目チェッカーに以下の2機能を追加するための実装計画である。実装者(AIエージェントを含む)がこのファイルだけを読んで作業を完遂できることを目的とする。

- **Part A: シグナル履歴ロガー** — 毎営業日の大引け後に、その日の判定結果(候補・テーマスコア)をスナップショットとしてリポジトリに蓄積する。
- **Part B: バックテスト** — 過去約1年分の各営業日に本番と同じ評価ロジックを適用し、「買い候補→翌日エントリー→損切り/利確」をシミュレートして期待値を測定する。

## 0. 前提知識(現状のアーキテクチャ)

- 判定ロジックの唯一の実装は TypeScript の `lib/evaluator.ts`(`evaluateCandidates(watchlist, prices, rules, generatedAt)`)。`scripts/evaluate_candidates.py` は `npm run evaluate` を呼ぶだけの互換ラッパーであり、**ロジックをPythonに再実装してはならない**(二重管理による乖離を防ぐため)。
- `npm run evaluate`(= `tsx scripts/evaluate_candidates.ts`)が `data/candidates.json`(CandidateResult[])、`data/theme_scores.json`(ThemeScore[])、`data/bb_watch.json` を生成する。
- 価格データは `scripts/fetch_prices.py` が yfinance から `period="1y", interval="1d", auto_adjust=False` で取得し、`data/prices.csv`(列: code,date,open,high,low,close,volume)に保存する。場中は当日分足を集計した部分バーが当日行として入る。
- GitHub Actions(`.github/workflows/update-and-deploy.yml`)が平日9:00〜15:20 JSTに20分毎に fetch → evaluate → build → GitHub Pages デプロイを実行している。現在 `permissions: contents: read`。
- 型定義は `lib/types.ts`(`CandidateResult` / `ThemeScore` / `Rules` / `PriceRow` など)。ルールは `config/rules.json`。
- テストは `npm test`(= `node --test --import tsx tests/*.test.ts`)。型チェックは `npm run typecheck`。
- 売買の運用ルール(バックテストが再現すべき対象):
  - エントリー: 翌営業日9:30〜10:00。現在値が買い基準価格(`entryPrice` = MA5×1.005)より上なら買い基準価格で**指値**(約定しなければ追いかけない)。現在値が買い基準価格以下なら下げ止まり確認後に**成行**。
  - 損切り: 前日安値。「前日に決めた位置から下げない」= 固定。
  - 第1利確: `takeProfit1`(直近20営業日高値)。
  - `exitMode`: テーマスコア90以上なら `trend_follow_exit`(TP1到達後も5日線終値割れまで保有継続)、それ以外は `target_exit`。

## 1. 全体像(新規・変更ファイル)

```
変更: scripts/fetch_prices.py            … CLI引数追加(--period/--output/--no-intraday/--auto-adjust)
新規: scripts/snapshot_signals.ts        … 日次スナップショット生成
新規: lib/backtest/simulate.ts           … 1トレードの約定・決済シミュレーション(共有コア)
新規: lib/backtest/engine.ts             … 日次ループ・トレード収集・コホート集計
新規: scripts/backtest.ts                … バックテストCLI(レポート出力)
新規: scripts/analyze_signals.ts         … 実スナップショット履歴の成績分析CLI
変更: package.json                       … npmスクリプト追加
変更: .github/workflows/update-and-deploy.yml … cron追加・permissions変更・スナップショットcommitステップ
変更: .gitignore                         … data/backtest/ と data/analysis/ を除外
新規: tests/simulate.test.ts             … シミュレーションコアの単体テスト
新規: tests/snapshot.test.ts             … スナップショット整形の単体テスト
変更: README.md                          … 使い方の追記
新規: data/history/                      … コミットされる履歴置き場(Actionsが生成)
```

依存パッケージの追加は不要。TSのCLI引数は `node:util` の `parseArgs`、Pythonは `argparse` を使う。

---

## Part A: シグナル履歴ロガー

### A-1. スナップショット形式

保存先: `data/history/signals/YYYY-MM-DD.json`(日付は**株価データの日付**であり、実行日ではない)。

```jsonc
{
  "snapshotDate": "2026-07-10",        // candidates[].date の非null最大値
  "generatedAt": "2026-07-10T07:35:00.000Z",
  "rulesHash": "a1b2c3d4e5f6",         // config/rules.json 生バイト列のsha256先頭12桁
  "candidates": [ /* SlimCandidate[] */ ],
  "themeScores": [ /* ThemeScore[] そのまま全フィールド */ ]
}
```

`SlimCandidate` は `CandidateResult` から以下のフィールドのみ抽出したもの(表示用の `tomorrowAction` / `intradayMemo` / `profitWarnings` と、`reasons` の label/detail を落として容量を抑える):

```
watchlistKey, code, name, theme, isLeader, watchPriority, status, date,
close, volume, ma5, ma25, ma5Deviation, ma25Deviation, ma5Trend, ma25Trend,
yearHighDeviation, return5d, return20d,
individualScore, themeScore, themeRank,
entryPrice, entryUpperPrice, stopLoss, expectedLoss, takeProfit1,
riskR, reward, rewardR, exitMode,
reasonKeys: string[]   // reasons.map(r => r.key)
```

あわせてルール定義の履歴を `data/history/rules/<rulesHash>.json` に保存する(同名ファイルが既にあれば書かない)。これにより後の分析で「どのルール版のシグナルか」を分離できる。

### A-2. `scripts/snapshot_signals.ts` の仕様

1. `data/candidates.json`、`data/theme_scores.json`、`config/rules.json` を読む。
2. `snapshotDate` = candidates の `date` フィールドの非null最大値。全件nullなら stderr に警告を出して **exit 0**(デプロイを止めない)。
3. SlimCandidate へ変換し、上記JSONを `data/history/signals/<snapshotDate>.json` に書く。**同日ファイルは無条件で上書き**(冪等。1日の最後の実行が最終値になる)。
4. `data/history/rules/<rulesHash>.json` が無ければ rules.json の内容をコピーして書く。
5. stdout に `snapshot 2026-07-10: 101 candidates, 14 themes (rules a1b2c3d4e5f6)` の形式で出力。

`package.json` に追加: `"snapshot": "tsx scripts/snapshot_signals.ts"`

### A-3. GitHub Actions の変更

`.github/workflows/update-and-deploy.yml` に対して:

1. **permissions 変更**: `contents: read` → `contents: write`(履歴コミットのため)。
2. **cron 追加**(大引け15:30 JSTの後、確定足でスナップショットを取るための1本):
   ```yaml
   - cron: '30 7 * * 1-5'   # 16:30 JST 大引け後(確定日足でスナップショット)
   ```
3. **ステップ追加**(「Evaluate candidates」の直後、build の前)。スナップショットとコミットは大引け後cronと手動実行のみで行い、場中の20分毎実行ではコミットしない:
   ```yaml
   - name: Snapshot signals
     if: github.event_name == 'workflow_dispatch' || github.event.schedule == '30 7 * * 1-5'
     run: npm run snapshot

   - name: Commit signal history
     if: github.event_name == 'workflow_dispatch' || github.event.schedule == '30 7 * * 1-5'
     run: |
       git config user.name "github-actions[bot]"
       git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
       git add data/history
       if git diff --cached --quiet; then
         echo "no snapshot changes"
       else
         git commit -m "chore: snapshot signals $(TZ=Asia/Tokyo date +%Y-%m-%d) [skip ci]"
         git pull --rebase origin main
         git push origin HEAD:main
       fi
   ```

補足(実装者向けの根拠):
- `GITHUB_TOKEN` によるpushはワークフローを再トリガーしないのがGitHubの仕様だが、念のため `[skip ci]` も付ける。
- `concurrency: group: pages, cancel-in-progress: true` が既にあるため同時実行の競合は起きにくいが、push直前の `git pull --rebase` で保険をかける。
- checkout はデフォルトの shallow clone のままで commit/push は可能。変更不要。
- 16:30 JSTにしたのは、Yahooのデータ遅延(約20分)を見込んで15:30の大引け値が確定していることを保証するため。

### A-4. `scripts/analyze_signals.ts` の仕様(履歴の成績分析)

蓄積されたスナップショットに対して「その後どうなったか」を集計するCLI。**Part Bの `lib/backtest/simulate.ts` を再利用する**(実装順序上、Part Bを先に作るか、simulate.tsだけ先行して作る)。

- 入力: `data/history/signals/*.json` 全件、価格CSV(デフォルト `data/prices.csv`、`--prices` で `data/prices_backtest.csv` などに変更可)。
- 各スナップショットの `status ∈ {buy_candidate, watch}` の銘柄について(同一日・同一codeはthemeScore最大の行に重複排除):
  - フォワードリターン: `close(D)` → `close(D+5)` / `close(D+20)`(営業日ベース。価格データが足りない場合はnull)。
  - トレードシミュレーション: Part B と同一のルール(B-3参照)で約定・決済を再現し、R倍数と損益円を計算。
- 価格CSVがスナップショット日をカバーしていない銘柄・日付は集計から除外し、除外件数を警告表示する(prices.csv は1年ローリングなので古いスナップショットはいずれ範囲外になる。その場合は `--prices data/prices_backtest.csv` を案内するメッセージを出す)。
- 出力:
  - `data/analysis/signal_performance.csv` … 1シグナル1行(snapshotDate, code, name, theme, status, individualScore, themeScore, rewardR, exitMode, rulesHash, fwd5, fwd20, filled, entryDate, entryFillPrice, exitDate, exitPrice, exitReason, holdDays, pnlYen, rMultiple)。
  - コンソールにサマリ表: status別・rulesHash別に、件数 / 約定率 / 勝率 / 平均R / 期待値R / fwd5・fwd20平均。
- `package.json` に追加: `"analyze:signals": "tsx scripts/analyze_signals.ts"`

---

## Part B: バックテスト

### B-1. データ取得の変更(`scripts/fetch_prices.py`)

argparse で以下を追加する。**引数なし実行時の挙動は現状と完全に同一に保つ**(本番ワークフローに影響させない):

| 引数 | デフォルト | 用途 |
|---|---|---|
| `--period` | `1y` | yfinanceの取得期間。バックテストでは `2y` を指定 |
| `--output` | `data/prices.csv` | 出力先CSV |
| `--no-intraday` | off | 当日分足の集計・追記(`fetch_today_row`)をスキップ。バックテストでは部分バー混入を防ぐためON |
| `--auto-adjust` | off | `yf.download(auto_adjust=True)` で株式分割調整済みOHLCを取得 |

`--output` がデフォルト以外のときは `data/prices_as_of.json` を更新しない。

バックテスト用データの取得コマンド(README に記載する):

```bash
python3 scripts/fetch_prices.py --period 2y --output data/prices_backtest.csv --no-intraday --auto-adjust
```

**`--auto-adjust` が重要な理由**: 本番は `auto_adjust=False`(未調整)だが、未調整の2年データには株式分割による人工的なギャップが含まれ、バックテストの損切り・利確判定を破壊する(日本株は近年分割が多い)。バックテストは調整済みで行い、この差異をレポートの注記に含めること。

### B-2. `lib/backtest/engine.ts` — 日次ループ

```
入力: watchlist(WatchlistRow[]), prices(PriceRow[]), rules(Rules), オプション{from, to, maxHoldDays, stopMode, statuses}
出力: { trades: SimulatedTrade[], signals: SignalRecord[], cohorts: CohortRecord[] }
```

処理:

1. 価格をcode別にdate昇順でグループ化。全銘柄の日付の和集合をソートして「営業日リスト」とする。
2. 各営業日 D(`from`〜`to`。デフォルトは「先頭から252営業日目」〜「末尾から21営業日前」)についてループ:
   a. code別に「Dまでの直近252行」をスライスして結合し、`evaluateCandidates(watchlist, sliced, rules, D)` を呼ぶ。**252行スライスは本番の `period="1y"` 取得を再現するため**(evaluator の `yearHigh` は渡された全行のmaxを取るので、スライス幅がそのまま「年初来」の定義になる)。
   b. 返ってきた candidates から対象status(デフォルト `buy_candidate`。`--statuses buy_candidate,watch` で拡張可)を抽出。
   c. **同一codeの重複排除**: 同じ銘柄が複数テーマに登録されているため(例: 7011が重工・防衛と宇宙・衛星)、同一code・同一Dで複数行出た場合はthemeScore最大の1行だけ採用。二重カウント厳禁。
   d. 同一codeのポジションが既に建っている(前のシグナルのトレードが未決済)場合、新規シグナルはスキップし `skipped_open_position` として記録。
   e. 採用シグナルを `simulate.ts` に渡してトレードを生成。
   f. コホート集計用に、この日の全評価行(codeで重複排除)について `{date, code, status, individualScore, themeScore, reasonKeys, fwd5, fwd20}` を記録(fwd5/fwd20はclose(D)基準の営業日フォワードリターン)。
3. パフォーマンス: 約245日 × 101行の evaluateCandidates 呼び出しで、計算量は問題にならない(数秒〜数十秒)。最適化は不要。

### B-3. `lib/backtest/simulate.ts` — 1トレードのシミュレーション(共有コア)

Part A-4 の analyze_signals と Part B の両方から使う。純粋関数として実装しテスト可能にする。

```ts
interface SimulationInput {
  signal: {                       // シグナル日Dの評価値
    entryPrice: number;           // MA5(D)×1.005
    entryUpperPrice: number;
    takeProfit1: number;
    stopLossSignal: number;       // 評価時の stopLoss = low(D-1)
    exitMode: "target_exit" | "trend_follow_exit";
  };
  signalDayLow: number;           // low(D) — stopMode="prev-day" 用
  forwardBars: PriceRow[];        // D+1以降の日足(その銘柄)
  closesUpToSignal: number[];     // トレンドフォロー時のMA5計算用(D以前の終値)
  options: { maxHoldDays: number; stopMode: "prev-day" | "signal"; shares: number };
}

interface SimulatedTrade {
  filled: boolean;
  noFillReason?: "gap_below_stop" | "never_reached_limit" | "no_forward_data";
  entryDate?: string; entryFillPrice?: number;
  exitDate?: string; exitPrice?: number;
  exitReason?: "stop" | "take_profit" | "ma5_trail" | "timeout";
  holdDays?: number; pnlYen?: number; rMultiple?: number;
  stopUsed: number;
}
```

**損切りラインの決定(stopMode)** — 重要な設計判断:

- 本番の運用では、ユーザーはエントリー当日Tの朝にツールを見る。そのとき「前日安値」= low(T-1) = **シグナル日Dの安値**である(場中実行時のツールは当日部分バーをlatestとして扱うため)。
- 一方、シグナルの `stopLoss` フィールドは全営業日Dの終値確定データで評価した場合 low(D-1) になる。
- したがってデフォルトは `stopMode: "prev-day"` = **stop = low(D)(シグナル日の安値)** とし、運用ドクトリン「前日安値」に忠実にする。`--stop-mode signal` で `stopLossSignal`(low(D-1))を使う感度分析も可能にする。
- R倍数・想定損失の計算には実際に使ったstop(`stopUsed`)を用いる。

**約定判定**(エントリー日 E = forwardBars[0]。BUY_ACTIONに忠実):

```
if open(E) <= stopUsed        → 約定なし(寄りでシナリオ崩壊。noFillReason=gap_below_stop)
elif open(E) <= entryPrice    → open(E) で成行約定
elif low(E) <= entryPrice     → entryPrice で指値約定
else                          → 約定なし(追いかけない。noFillReason=never_reached_limit)
```

**決済判定**(約定日Eを含む各営業日について、以下の順で評価):

- `target_exit` モード:
  1. **損切り優先(保守的仮定)**: `low(day) <= stopUsed` → `min(open(day), stopUsed)` で決済(ギャップダウンは寄り値)。exitReason=stop。
  2. 利確: `high(day) >= takeProfit1` → `max(open(day), takeProfit1)` で決済(ギャップアップは寄り値)。exitReason=take_profit。
  3. 約定日から `maxHoldDays`(デフォルト30営業日)経過 → その日の終値で決済。exitReason=timeout。
- `trend_follow_exit` モード:
  - TP1タッチ(`high(day) >= takeProfit1`)**まで**は target_exit と同じ損切りルール(利確はしない)。
  - TP1タッチ**以降**は、毎日 MA5(直近5終値: closesUpToSignal + forwardBars の終値から計算)と終値を比較し、`close(day) < MA5(day)` になった日の**終値**で決済。exitReason=ma5_trail。損切りライン(stopUsed)もタッチ以降有効のまま(stopが先に当たればstop)。
  - maxHoldDays は trend_follow では適用しない(トレンド継続が趣旨のため)。ただし forwardBars が尽きたら最終バーの終値で決済し exitReason=timeout。
- 同一日に損切りと利確の両条件が成立した場合は**損切りとして扱う**(日足では順序が分からないため保守側に倒す)。この仮定は結果を悲観方向に歪めることをレポートに明記。

損益: `pnlYen = (exitPrice - entryFillPrice) × shares`(shares = rules.defaultShares = 100)。`rMultiple = (exitPrice - entryFillPrice) / (entryFillPrice - stopUsed)`。手数料・スリッページはv1では0(将来の拡張ポイントとしてコメントを残す)。

### B-4. `scripts/backtest.ts` — CLI とレポート

```bash
npm run backtest -- [--prices data/prices_backtest.csv] [--from 2025-08-01] [--to 2026-06-30] \
  [--statuses buy_candidate] [--max-hold-days 30] [--stop-mode prev-day] [--out data/backtest]
```

- デフォルト `--prices data/prices_backtest.csv`。ファイルが無ければ B-1 の取得コマンドを案内して exit 1。
- 出力(`--out` ディレクトリ、gitignore対象):
  - `trades.csv` … 1トレード1行(signalDate, code, name, theme, status, individualScore, themeScore, exitMode, rewardR(シグナル時), stopUsed, filled, noFillReason, entryDate, entryFillPrice, exitDate, exitPrice, exitReason, holdDays, pnlYen, rMultiple)。
  - `summary.json` … 下記サマリの機械可読版 + 実行時パラメータ + rulesHash。
  - `cohorts.json` … コホート集計(B-2-f)の結果。
- コンソールサマリ(最重要成果物。見やすい表で):
  - **全体**: シグナル数 / 約定数(約定率) / 勝率 / 平均勝ちR / 平均負けR / **期待値R** / 期待値(円/トレード) / プロフィットファクター / 累積損益(円) / 最大ドローダウン(円) / 平均保有日数。
  - **内訳別**(それぞれ 件数・勝率・期待値R): テーマ別 / exitMode別 / exitReason別 / individualScoreバンド別(85-89, 90-94, 95-100) / themeScoreバンド別(80, 90, 100) / 月別。
  - **コホート比較**: status別(buy_candidate / watch / avoid)の fwd5・fwd20 平均とプラス率 — 「買い候補は本当にwatch/avoidより良いのか」を直接検証する表。
- `package.json` に追加: `"backtest": "tsx scripts/backtest.ts"`

### B-5. バックテストの既知の限界(README とレポート出力に明記する)

1. **選択バイアス**: 現在のウォッチリストは「既に上がったテーマ」を後知恵で選んでいるため、絶対値の成績は楽観的に出る。結果は「ルールAとルールBの相対比較」に使い、絶対リターンを鵜呑みにしない。
2. **日足近似**: 5分足の下げ止まり確認・9:30-10:00の執行タイミングは再現できない。約定モデルは寄り値/指値の近似。
3. **同日stop/TP同時成立は損切り扱い**(保守的)。
4. **調整済み価格**: 分割調整のため本番(未調整)と価格水準が異なる場合がある。expectedLossの円額は参考値。
5. **シグナル日の部分バー問題**: 本番の場中実行は当日部分バーで評価するが、バックテストは確定日足で評価する(「前日の引け後に評価して翌朝執行」の近似)。
6. 200A、464A等の新規上場銘柄は履歴が短く、期間の大半で `missing_price_data` になる(正常動作)。

---

## テスト計画

### tests/simulate.test.ts(必須・最重要)

`simulate.ts` は金額計算の中核なので網羅的に。固定の人工バー列でケースを検証:

1. 寄りが entryPrice 以下 → open約定。
2. 寄りが entryPrice 超・ザラ場で指値到達 → entryPrice約定。
3. 一度も entryPrice まで下げない → 約定なし(never_reached_limit)。
4. 寄りが stop 以下にギャップダウン → 約定なし(gap_below_stop)。
5. 約定後、翌日lowがstop割れ → stopで決済。ギャップダウン寄りなら open で決済。
6. 約定後、highがTP1到達 → TP1で決済。ギャップアップ寄りなら open で決済。
7. 同日にstopとTP両方成立 → stop扱い。
8. maxHoldDays 経過 → 終値決済(target_exitのみ)。
9. trend_follow: TP1タッチ後、close < MA5 になった日の終値で決済。タッチ前にMA5を割っても決済しない。
10. trend_follow: TP1タッチ後でも stop 到達なら stop 決済。
11. rMultiple / pnlYen の計算値検証(stopMode両方)。

### tests/snapshot.test.ts

- フィクスチャの candidates/themeScores/rules から: snapshotDate の決定(非null最大)、SlimCandidate のフィールド構成、reasonKeys 変換、全date=nullのときファイルを書かないこと。

### 手動検証(受け入れ確認)

- `npm run typecheck && npm test` が通る。
- `python3 scripts/fetch_prices.py`(引数なし)の出力が変更前と同一形式(`git diff data/prices.csv` で列・行形式が不変)。
- `npm run evaluate && npm run snapshot` で `data/history/signals/<日付>.json` と `data/history/rules/<hash>.json` が生成され、再実行しても同一内容(冪等)。
- バックテストのスモーク: `python3 scripts/generate_sample_prices.py` のサンプルデータ、または `data/prices.csv`(1年分)を `--prices` に指定して `npm run backtest` がエラーなく完走し、trades.csv とサマリが出る。
- ワークフローは `workflow_dispatch` で手動実行し、`data/history/` へのコミットとPagesデプロイの両方が成功することを確認。

## 実装順序(マイルストーン)

1. **M1**: `scripts/fetch_prices.py` の引数追加(デフォルト挙動不変を最優先で確認)+ `scripts/snapshot_signals.ts` + npmスクリプト + tests/snapshot.test.ts。
2. **M2**: ワークフロー変更(cron追加・permissions・snapshot/commitステップ)。workflow_dispatchで動作確認。
3. **M3**: `lib/backtest/simulate.ts` + tests/simulate.test.ts(ここが品質の要)。
4. **M4**: `lib/backtest/engine.ts` + `scripts/backtest.ts` + 2年データ取得 + レポート確認。
5. **M5**: `scripts/analyze_signals.ts`(simulate.tsを再利用)+ .gitignore + README更新。

各マイルストーンごとに `npm run typecheck && npm test` を通すこと。M2はリポジトリへのpush権限に関わるため、コミットメッセージ形式と `[skip ci]` を必ず確認すること。

## 将来の拡張(今回は実装しない。コメントでフックだけ残す)

- 手数料・スリッページのモデル化(summary.jsonにパラメータ欄だけ用意)。
- 同時保有数上限・資金制約のシミュレーション。
- rules.json のパラメータスイープ(閾値グリッドサーチ)— engine.ts が rules を引数に取る設計なので呼び出し側の追加のみで可能。
- 実約定記録(売買日誌CSV)とシグナル履歴の突き合わせ。
