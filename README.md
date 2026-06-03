# 5日線押し目チェッカー MVP

上昇トレンド銘柄が5日移動平均線付近まで押しているかを判定し、ユーザー定義の投資テーマ単位で資金が残っているかを確認するローカル用Next.jsアプリです。

目的は、毎回チェックシートを手で確認せず、テーマ資金、テーマ主役株、個別銘柄の押し目条件、買い基準価格、買い上限価格、損切りライン、想定損失をシステマチックに確認することです。

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

判定結果は `data/candidates.json` と `data/theme_scores.json` に保存されます。価格データがない銘柄はアプリ全体を止めず、`missing_price_data` を理由に出します。

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

最終判定は個別押し目スコア、テーマ資金スコア、想定損失、25日線割れなどのハード条件を組み合わせて、買い候補、監視、見送りに分類します。見送りや監視の理由は `reasons` 配列に、`ma5_too_far_above`、`entry_upper_exceeded`、`theme_weak`、`ma25_broken`、`ma25_trend_down`、`expected_loss_too_large`、`breakout_type`、`ma25_pullback_type`、`missing_price_data` などで保存します。

## MVPで未実装

- リアルタイム5分足判定
- TOPIX比較
- 出来高判定
- 決算日フィルター
- 自動売買
