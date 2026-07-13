# 5日線押し目チェッカー MVP

上昇トレンド銘柄が5日移動平均線付近まで押しているかを判定し、ユーザー定義の投資テーマ単位で資金が残っているかを確認するローカル用Next.jsアプリです。

目的は、毎回チェックシートを手で確認せず、テーマ資金、テーマ主役株、個別銘柄の押し目条件、買い基準価格、買い上限価格、損切りライン、想定損失をシステマチックに確認することです。

**日々の使い方(毎日・売買時・週次・月次・四半期に何をするか)は [docs/運用マニュアル.md](docs/運用マニュアル.md) を参照してください。** このREADMEは機能仕様のリファレンスです。

## セットアップ

```bash
npm install
python3 -m pip install -r requirements.txt
```

## watchlist.csv の仕様

`data/watchlist.csv` を手動で編集します。`sector` は参考情報、`theme` が資金流入判定の主軸です。

```csv
code,name,sector,theme,is_leader,watch_priority
5803,フジクラ,非鉄金属,電線・データセンター,true,A
7011,三菱重工,機械,重工・防衛,true,A
7011,三菱重工,機械,宇宙・衛星,true,B
```

列の意味:

- `code`: 銘柄コード。文字列として扱い、4桁コード、ETFコード、英数字コードに対応します。
- `name`: 銘柄名。
- `sector`: 参考情報としての東証業種など。
- `theme`: 投資テーマ。テーマ資金判定の主軸です。
- `is_leader`: そのテーマ内の主役株なら `true`。
- `watch_priority`: A/B/C。UIの表示優先度とAテーマ/Bテーマ分けに使います。

同じ銘柄を複数テーマに入れる場合は、同じ `code` で `theme` を変えた行を追加します。内部の一意キーは `code + theme` です。価格データは `code` 単位で1回だけ取得し、評価結果は `code + theme` 単位で作ります。

## 投資テーマ

初期ウォッチリストは、グロース・個別成長、バイオ、IPO、低位株、仕手株、小型材料株を除外し、以下のAテーマ/Bテーマで管理します。

Aテーマ: 電線・データセンター、半導体・生成AI、AIインフラ・通信、重工・防衛、銀行・金利上昇、商社・資源、電力・エネルギーインフラ、電子部品・AI端末。

Bテーマ: 造船・海運、宇宙・衛星、非鉄・資源素材、建設・国土強靭化、自動車・円安、機械・設備投資。

## 日足データ取得

Yahoo Finance形式へ変換して、日本株コードに `.T` を付けて取得します。同じ `code` が複数テーマに出てきても取得は1回だけです。

```bash
python scripts/fetch_prices.py
```

`yfinance` は非公式データソースのため、欠損や仕様変更がありえます。取得処理は評価ロジックと分離してあり、将来別データソースへ差し替えやすい構成にしています。取得に失敗した銘柄は警告を出してスキップします。

サンプルデータを再生成する場合:

```bash
python scripts/generate_sample_prices.py
```

## 候補判定の実行

```bash
npm run evaluate
```

互換用に次のコマンドでも実行できます。

```bash
python scripts/evaluate_candidates.py
```

判定結果は `data/candidates.json`、`data/theme_scores.json`、`data/bb_watch.json` に保存されます。価格データがない銘柄はアプリ全体を止めず、`missing_price_data` を理由に出します。

## Next.jsアプリの起動

```bash
npm run dev
```

起動後、表示されたローカルURLをブラウザで開きます。

## rules.json の変更

仮ルールは `config/rules.json` にあります。5日線乖離、買い基準価格、想定損失、テーマ順位、主役株維持率、スコア配点、買い候補/監視/見送りの閾値を変更できます。変更後は `npm run evaluate` を実行してください。

## 判定ロジック概要

個別銘柄は25日線の向き、25日線上の維持、5日線乖離、5日線の向き、年初来高値からの押し幅、想定損失で100点満点の個別押し目スコアを計算します。

投資テーマは5日騰落率平均、20日騰落率平均、テーマ順位、テーマ主役株の5日線/25日線維持率、5日騰落率がプラスかどうかでテーマ資金スコアを計算します。

### テーマスコアの計算方式（themeScoringMode）

`themeScoringMode` で切り替えます（既定 `binary`）。

- `binary`: 従来どおり4条件×二値×固定配点（順位30・主役株5日線維持30・同25日線維持20・5日騰落率プラス20）。スコアは0/20/30/50/70/80/100などに飛び飛びになります。
- `continuous`: 各二値条件を同じ配点のまま連続量に置き換えた0〜100の連続スコア。順位30点→5日/20日騰落率パーセンタイルのブレンド（`themeMomentumBlend5d`、既定0.6:0.4）、維持率→維持率そのまま、5日プラス20点→±`themeMomentum5dRange`/±`themeMomentum20dRange`（既定±5%/±10%）をclampした絶対モメンタム。テーマ順位もブレンド相対強度順になり、スコア内訳は `scoreComponents`（/themesのスコアバッジのツールチップ）で確認できます。

**2026年7月の検証で `binary` 維持を判断しました**（continuousは境界フリップが減らず、閾値80に中位テーマが流入して期待値Rが劣化。詳細と較正案は `docs/backtest-results/2026-07-theme-scoring.md`）。continuousの再検証は `npm run backtest -- --theme-scoring continuous` でいつでもできます。

最終判定は個別押し目スコア、テーマ資金スコア、想定損失、25日線割れなどのハード条件を組み合わせて、買い候補、監視、見送りに分類します。見送りや監視の理由は `reasons` 配列に、`ma5_too_far_above`、`entry_upper_exceeded`、`theme_weak`、`ma25_broken`、`ma25_trend_down`、`expected_loss_too_large`、`position_cost_too_large`、`breakout_type`、`ma25_pullback_type`、`missing_price_data`、`reward_r_too_low`、`profit_target_near`、`profit_warning_overheated`、`stop_too_tight`、`volume_not_dry`、`market_regime_weak`、`earnings_soon` などで保存します。

### 建玉（株数）の決め方

`sizingMode` で切り替えます（既定 `risk`）。

- `risk`: リスク許容額から株数を逆算します。`推奨株数 = floor(maxLossYen ÷ (買い基準価格 − 損切りライン) ÷ lotSize) × lotSize`。損切り幅が狭い銘柄ほど株数が増え、1トレードあたりのリスクが `maxLossYen`（既定1.2万円）に揃います。`maxPositionYen` を設定すると1銘柄あたりの投入額も上限で切ります（**既定は null = 上限なし。自分の1銘柄あたり投入上限に合わせて設定してください**。例: `500000`）。単元未満株（S株等）を使う場合は `allowFractionalShares: true` で1株単位になります。
- `fixed`: 従来どおり `defaultShares`（100株）固定。

`lotSize: 100`・`maxPositionYen: null` のとき、riskモードとfixedモードの買い候補/監視/見送りの判定結果は数学的に一致します（変わるのは推奨株数と想定損失の表示、バックテストの損益額のみ）。この等価性はテストで保証しています。

### 品質フィルター（ATR損切り品質・出来高ドライアップ）

買い候補の「押し目の質」を測る2つの独立したチェックです。個別スコアの配点（100点満点）には影響せず、`stopTightFilterMode` / `volumeFilterMode` で動作を切り替えます。

- `stop_too_tight`（損切りラインが近すぎる）: 損切り幅（買い基準価格 − 前日安値）が `stopAtrMinMultiple`（既定0.3）× ATR（`atrPeriod`日、既定14日）未満だと、日常のノイズで狩られやすいタイトすぎる損切りとみなします。ATRは損切り位置を動かすためではなく品質判定にのみ使います（損切りは前日安値のまま）。
- `volume_not_dry`（押し目中も出来高が減っていない）: 直近 `volumeShortWindow` 日（既定3日）の平均出来高 ÷ 直近 `volumeLongWindow` 日（既定20日）の平均出来高が `volumeDryUpMaxRatio`（既定0.85）以下なら売り圧力が枯れた質の良い押し目、超えていれば警告します。

モードは `off`（無効）/ `flag`（理由として表示するだけ。既定）/ `exclude`（買い候補を監視に降格。見送りにはしない）の3段階です。excludeへの昇格はバックテストのバンド別成績で効果を確認してから行ってください（下記バックテスト参照）。

注意: 場中の実行では当日の出来高が途中集計のため出来高比が実際より低く出ます（ドライアップ判定が通りやすい偽陽性方向）。確定判定は大引け後のスナップショットで行われます。

### 地合い（市場レジーム）フィルター・決算日フィルター

個別銘柄・テーマのスコアとは独立した、買い候補の採用を抑制するための2つのゲートです。どちらも個別スコア（100点満点）・テーマスコアの配点には影響しません。

**地合いフィルター**: `marketIndexCode`（既定 `"1306"` = NEXT FUNDS TOPIX連動型上場投信）を `data/prices.csv` の一部として毎日取得し、「終値が25日線より上 かつ 25日線が上向き（横ばいはNG）」を地合いOKと定義します。地合いNGのとき、`marketFilterMode`（既定 `flag`）が `exclude` なら買い候補を監視に降格します（見送りにはしません）。地合いは全銘柄に等しくかかるマスタースイッチなので、NG時は価格データのある全候補の `reasons` に `market_regime_weak` が付きます。日経平均で見たい場合は `marketIndexCode` を `"1321"`（日経225連動型上場投信）に変えるだけで切り替えられます。指標の価格データが無い・行数不足のときは地合い判定そのものが `null`（不明）になり、フィルターは不発（全候補が地合いOK扱い）になります——測定不能を罰しない、という他の品質フィルターと同じ原則です。

**決算日フィルター**: 手動管理の `data/earnings.csv` から銘柄ごとの次回決算発表日を引き、発表 `earningsExclusionDays`（既定3営業日）前（発表当日を含む）から買い候補を監視に降格します。損切りを前日安値に置く設計は決算ギャップ（発表を受けた寄り付きの急変動）の前では機能せず、寄りで損切りラインを飛び越えて想定損失（`maxLossYen`）の前提が崩れるための防御です。`earningsFilterMode` の既定は他の品質フィルターと異なり `exclude` です。これは性能仮説ではなくリスク上限の不変条件だからで、導入時点の `earnings.csv` は空なので実質不発（データを入れた分だけ効く安全な既定）で始まります。理由キーは `earnings_soon` です。

`data/earnings.csv` の仕様:

```csv
code,earningsDate,memo
7011,2026-08-04,1Q決算
5803,2026-08-08,
```

- 1行＝1決算イベント。`code`: 銘柄コード（watchlistと同じ扱い）。`earningsDate`: 発表日（YYYY-MM-DD）。`memo`: 自由記述（省略可）。
- **四半期ごとに手動で追記**します。発表日は証券会社アプリ・会社IRページ・適時開示カレンダーで確認してください。
- **過去の行は消さないでください**。履歴として溜めることで、将来バックテスト（`--earnings-filter` によるA/B比較）で「決算またぎ除外は本当に効いたか」を検証できるようになります。
- ファイルが存在しない・ヘッダーのみでも全機能が動きます（不発なだけで壊れません）。存在して不正な行（日付形式が `YYYY-MM-DD` でない、`code` が空など）があれば、実行時に行番号付きのエラーで止まります（黙ってスキップしません）。

営業日は**平日（月〜金）近似**で数え、日本の祝日は考慮しません。祝日を挟むと除外窓が実質1営業日前後ずれることがありますが、`earnings.csv` 自体が手動管理の近似データであるため許容しています（心配な場合は `earningsExclusionDays` を増やして運用してください）。

両フィルターとも `off`（無効）/ `flag`（理由表示のみ）/ `exclude`（買い候補を監視に降格）の3段階です。地合いフィルターは品質フィルターと同じ**段階導入方針**（既定flag、バックテストで効果を確認してからexclude昇格を判断）に従います。決算フィルターだけは上記の理由で既定exclude採用済みです。

**2026年7月の検証で地合いフィルターは `flag` 維持を判断しました**（excludeは期待値R 0.67→0.49・最大DDも悪化。個別・テーマ条件が実質的な地合いフィルターとして既に機能しており、検証期間の地合いNG日はむしろ深押しからの好機だった。ただしNG日サンプルが薄く持続的な下落相場を含まないため、**次の本格的なベア相場を経験した後に必ず再検証すること**。詳細は `docs/backtest-results/2026-07-market-filter.md`）。

地合いフィルターのA/B検証コマンド例（バックテスト用データに市場指標の価格行が入っている必要があります）:

```bash
python3 scripts/fetch_prices.py
python3 scripts/fetch_prices.py --period 2y --output data/prices_backtest.csv --no-intraday --auto-adjust

npm run backtest -- --market-filter flag --out data/backtest/market-baseline
npm run backtest -- --market-filter exclude --out data/backtest/market-exclude
```

読み方は「最大ドローダウン（円）の改善」を主指標にしつつ、期待値Rの改善・約定数の残存率・地合いOK日/NG日のコホート表（`summary.cohortsByBand.marketRegime`）を確認します。検証結果と判断は `docs/backtest-results/2026-07-market-filter.md` に記録済みです。決算フィルターは `earnings.csv` に履歴データが無いため2026年7月時点では検証スコープ外ですが、履歴が溜まった段階で `npm run backtest -- --earnings-filter off` とのA/Bで「決算またぎトレードの成績」を検証できます（`daysToEarnings` バンド別集計は実装済み）。

### 損切りライン

損切りラインは前日安値（T-1日の安値）を使います。5日線押し目買いは「前日に5日線付近で下げ止まった」シナリオで入るため、前日安値を割り込むことはそのサポートが崩れてシナリオが否定されたことを意味します。損切りは「シナリオが崩れた地点」に置くのが合理的であり、前日安値は前日引けで確定できる具体的な数値です。

### 利確ライン（第1利確）

第1利確ラインは直近20営業日の日中高値の最大値（`recentHigh20`）を使います。5日線押し目で買う理由は「上昇トレンド中の押し目から直近高値方向への再上昇」を狙うためであり、最初の目標は直近でつけた高値を再び試すことです。20営業日（約1ヶ月）を採用するのは、現在のトレンドサイクルで実際につけた上値抵抗を示すためで、それ以上古い高値はテーマが変化している可能性があります。

リワードR（`rewardR = reward ÷ riskR`）が1.0未満の場合、損切り幅に対して利確ラインまでの利幅が小さく期待値が低いため、買い候補から監視に格下げします。テーマ資金スコアが90点以上のときはトレンド継続モードとなり、第1利確到達後も5日線を維持する間は保有継続、5日線終値割れで売ります。

## BB押し目一覧（/bb-watch）

`/bb-watch` は、銘柄ごとにボリンジャーバンド（25日）上のどの押し目ライン（MA25・-1σ・-2σ）で反発しやすいかを分析する**監視・分析専用**ページです。

5日線買い候補とは完全に別物であり、現時点では正式な買い候補ではありません。トップページの買い候補件数や候補一覧の「買い候補」にはBB押し目監視の銘柄を含めません。ロジックも `lib/bollinger.ts`（BB計算）と `lib/bbWatch.ts`（押し目分析・ステータス判定）に分離してあり、5日線押し目ロジック（`lib/evaluator.ts`）には影響しません。

過去1年の日足データから各ライン（MA25・-1σ・-2σ）への接触イベント（`安値 <= ライン × 1.003`）を検出し、接触後5営業日以内の値動き（+3%以上で反発成功、-3%以上で反発失敗）を集計して `touchCount` / `successRate` / `avgMaxReturn5d` / `avgMaxDrawdown5d` を算出します。接触回数が3回以上あるラインの中で最も成功率が高いラインを `preferredLine`（得意ライン）とし、3回未満の場合は `insufficient_history`（データ不足）として扱います。

現在値（終値または安値）が各ラインの ±1.0% 以内に近づいている場合は `currentLine` としてそのラインを記録します。`bbWatchStatus` は次のように判定します。

- `timing_good`（タイミング良い）: 得意ラインに接近していて、その成功率が60%以上、テーマ資金スコアが基準以上、25日線も下向きすぎない
- `watch`（監視）: いずれかの押し目ラインに接近しているが、タイミング良いの基準には届いていない
- `insufficient_history`（データ不足）: 過去の接触回数が不足していて得意ラインを判定できない
- `not_near`（押し目ラインから遠い）: どの押し目ラインにも近づいていない

初期表示は `timing_good` と `watch` のみで、`insufficient_history` と `not_near` はチェックボックスで表示を切り替えられます。判定結果は `data/bb_watch.json` に保存され、`npm run evaluate` で再生成されます。条件は `config/rules.json` の `bollingerPeriod` / `bbTouchTolerance` / `bbNearTolerance` / `bbLookaheadDays` / `bbSuccessReturnThreshold` / `bbFailureReturnThreshold` / `bbMinTouchCount` / `bbTimingGoodSuccessRate` / `bbThemeScoreThreshold` で変更できます（5日線押し目ルールとは独立しています）。

将来的にBB押し目を正式な買い候補へ昇格させる可能性を見据え、ロジックを分離した設計にしています。

## シグナル履歴の蓄積（シグナルロガー）

GitHub Actions が平日16:30 JST（大引け後の確定日足）に、その日の判定結果を `data/history/signals/YYYY-MM-DD.json` へスナップショットとして自動コミットします。ファイル名は株価データの日付で、ルール定義は `data/history/rules/<rulesHash>.json` に版管理されます。手動で取る場合:

```bash
npm run evaluate
npm run snapshot
```

蓄積した履歴の「その後の成績」（フォワードリターン、約定シミュレーション）は次で分析できます:

```bash
npm run analyze:signals
# 古い履歴も分析する場合は2年分の価格データを使う
npm run analyze:signals -- --prices data/prices_backtest.csv
```

結果は `data/analysis/signal_performance.csv` とコンソールのサマリ表（status別・ルール版別）に出ます。

## バックテスト

過去の各営業日に本番と同じ評価ロジック（`lib/evaluator.ts`）を適用し、「買い候補→翌日エントリー→前日安値で損切り／直近20日高値で利確（テーマスコア90以上は5日線トレイル）」をシミュレートします。

```bash
# 1. バックテスト用データ取得（2年分・分割調整済み・確定日足のみ）
python3 scripts/fetch_prices.py --period 2y --output data/prices_backtest.csv --no-intraday --auto-adjust

# 2. 実行
npm run backtest
```

主なオプション:

- `--from` / `--to`: 対象期間（デフォルトはウォームアップ252営業日後〜フォワード21営業日前）
- `--statuses buy_candidate,watch`: 対象status（デフォルト buy_candidate）
- `--stop-mode prev-day|signal`: 損切りラインの取り方。デフォルト `prev-day` は「エントリー前日＝シグナル日の安値」で、運用ドクトリンの前日安値に忠実。`signal` は評価時の `stopLoss` フィールド（シグナル日前日の安値）を使う感度分析用
- `--max-hold-days`: 最大保有営業日数（デフォルト30。トレンドフォロー時は適用しない）
- `--sizing fixed|risk` / `--stop-tight-filter off|flag|exclude` / `--volume-filter off|flag|exclude` / `--theme-scoring binary|continuous`: rules.json を編集せずに建玉方式・品質フィルター・テーマスコア方式を一時的に上書きしてA/B比較するためのオプション（未指定時は rules.json の値）

出力は `data/backtest/` に `trades.csv`（全トレード）、`summary.json`（全体・テーマ別・スコア帯別などの統計）、`cohorts.json`（status別フォワードリターン）。コンソールにもサマリ表が出ます。損切り幅ATRバンド別・出来高比バンド別・テーマスコア帯別（60/80/90境界）の成績と、status×バンド別のコホート表（執行モデル非依存のフォワードリターン）も出るので、品質フィルターの閾値（0.3 ATR / 出来高比0.85）やテーマ閾値（80）の妥当性を直接確認できます。あわせてテーマ安定性指標（テーマstatusの日次フリップ回数・日次スコア変化。`summary.json` の `themeStability`）も出るため、テーマスコア方式の境界安定性を比較できます。

品質フィルターのA/B比較の例:

```bash
# ベースライン(フィルターなし)
npm run backtest -- --stop-tight-filter off --volume-filter off --out data/backtest/baseline
# フィルターexcludeの効果
npm run backtest -- --stop-tight-filter exclude --volume-filter off --out data/backtest/stop-tight
npm run backtest -- --stop-tight-filter off --volume-filter exclude --out data/backtest/volume
```

exclude採用の目安は「ベースライン比で期待値Rが改善し、かつ約定数がベースラインの60%以上残る」ことです。2026年7月の検証結果と既定値の判断根拠は `docs/backtest-results/2026-07-atr-volume.md` を参照してください（結論: sizingMode=risk採用、両フィルターはflag維持）。

結果を読むときの注意（コンソールにも表示されます）: ウォッチリスト自体が後知恵選択なので絶対値は楽観的に出ます。ルール変更の相対比較に使ってください。同日に損切りと利確が両方成立した場合は損切り扱い（保守的仮定）です。

## 実際の売買とツールの突き合わせ（トレードレビュー）

実際の約定を `data/trades/executions.csv` に手動で記録すると、シグナル履歴スナップショットと突き合わせて「スリッページ」「ルール逸脱」「ツールに完全に従った場合の仮想成績 vs 実成績」を月次で振り返れます。

### 記録の付け方

1行=1約定。部分約定・分割売りはそのまま複数行にします。

```csv
executedAt,code,side,price,shares,memo
2026-07-10,5803,buy,6210,100,寄り後に指値で約定
2026-07-15,5803,sell,6580,100,第1利確
```

- `executedAt`: 約定日（YYYY-MM-DD）。`side`: buy/sell。`price`: 約定単価。`shares`: 株数（正の整数）。`memo`: 自由記述（省略可）。
- 不正な行は行番号付きでエラーになります（黙ってスキップしません）。
- **プライバシー注意**: リポジトリがpublicの場合、コミットすると実際の売買記録が公開されます。避けたい場合は `data/trades/` を `.gitignore` に追加してローカル管理にしてください。

### 月次振り返りの実行

```bash
npm run review:trades
# 月で絞る / 古い売買は2年分の価格データで
npm run review:trades -- --month 2026-07 --prices data/prices_backtest.csv
```

売り買いはFIFOでロット化し、各買いを直前のスナップショット（`--lookback-days`、既定5暦日。無ければ当日分を場中判断として採用）と突き合わせます。出力は `data/analysis/trade_review.csv` とコンソールの表（トレード別・月次サマリ・逸脱フラグ集計・オープン建玉）。仮想成績は実際の株数で計算するため、実成績との差は純粋に執行の差を表します。

逸脱フラグ: `no_signal_data`（履歴なし）/ `off_watchlist`（ウォッチリスト外）/ `not_buy_candidate`（ルール外エントリー）/ `same_day_signal`（場中判断）/ `chase_entry`（買い上限超え）/ `over_sized`（推奨株数超過）/ `late_stop`（損切りラインより`--stop-tolerance`（既定0.5%）超下で売却）/ `holding_below_stop`（**損切りライン割れを保有中**。オープン建玉の最重要警告）。

月次サマリの「ルール外」は `no_signal_data` / `off_watchlist` / `not_buy_candidate` を数えます（`same_day_signal` と `late_stop` は執行タイミングの問題として別枠）。手数料・税は含みません（バックテストと整合）。

## MVPで未実装

- リアルタイム5分足判定
- 自動売買
