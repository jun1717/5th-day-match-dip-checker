---
name: backtest-ab
description: ルール変更案のA/B検証。ベースラインと変更案のバックテストを実行し、採用基準(期待値R改善かつ約定数60%以上残存)で判定して docs/backtest-results/ に記録する。config/rules.json の変更はこの手順を通過した場合のみ行う。引数は検証したい変更内容(例「volume-filterをexcludeに」「themeBuyScoreThresholdを85に」)。
argument-hint: "<検証したい変更内容>"
---

# ルール変更のA/B検証

[docs/運用マニュアル.md](../../../docs/運用マニュアル.md) のセクション6「ルールを変えたくなったら」を実行する手順。
目的は「思いつきでrules.jsonを触らない」規律の仕組み化。**検証→基準判定→記録→(採用時のみ)変更**の順を崩さない。

## 手順

### 1. 蒸し返しチェック(最初に必ず)

提案が以下の**検証済み確定事項**の再提案なら、まず該当の記録ドキュメントを提示して指摘する。そのうえでユーザーが明示的に再検証を望む場合のみ続行する(地合いフィルターのベア相場後再検証など、記録に「再検証予約」と明記されているものは正当な再検証)。

| 項目 | 結論 | 記録 |
|---|---|---|
| 建玉方式 | `risk` 採用(期待値R 0.546→0.619) | [2026-07-atr-volume.md](../../../docs/backtest-results/2026-07-atr-volume.md) |
| ATR損切り品質・出来高ドライアップ | `flag` 維持(excludeは基準未達。コホートは仮説と逆傾向) | 同上 |
| 地合いフィルター | `flag` 維持(excludeで期待値R 0.67→0.49)。**ベア相場経験後に再検証予約あり** | [2026-07-market-filter.md](../../../docs/backtest-results/2026-07-market-filter.md) |
| テーマスコア方式 | `binary` 維持(continuousは閾値80に中位テーマが流入しR劣化) | [2026-07-theme-scoring.md](../../../docs/backtest-results/2026-07-theme-scoring.md) |
| 決算フィルター | `exclude` 採用(リスク上限の不変条件。性能仮説ではないので成績を理由に外さない) | README |

### 2. データ鮮度の確認

`data/prices_backtest.csv` の更新日時を確認し、1週間より古ければ再取得:

```bash
python3 scripts/fetch_prices.py --period 2y --output data/prices_backtest.csv --no-intraday --auto-adjust
```

### 3. 変更の表現方法を決める

- **CLI上書きで表現できる場合**(rules.json編集不要): `--sizing fixed|risk` / `--stop-tight-filter off|flag|exclude` / `--volume-filter off|flag|exclude` / `--market-filter off|flag|exclude` / `--earnings-filter off|flag|exclude` / `--theme-scoring binary|continuous` / `--stop-mode prev-day|signal` / `--max-hold-days` / `--statuses`
- **閾値変更などCLIにない項目**: `config/rules.json` を一時編集して変更案を実行し、**実行後すぐ元に戻す**(現在値を控えてから編集する。summary.jsonのrulesHashで版は追跡される)。

### 4. ベースラインと変更案を実行

```bash
npm run backtest -- --out data/backtest/baseline
npm run backtest -- <変更> --out data/backtest/<実験名>
```

実験名は内容が分かる短い英語ケバブケース(例: `volume-exclude`, `theme-threshold-85`)。

### 5. 判定(事前基準を後から動かさない)

**採用基準: ベースライン比で期待値Rが改善し、かつ約定数がベースラインの60%以上残る。**

比較表に載せる指標: シグナル数 / 約定数 / 勝率 / 期待値R / 期待値(円) / PF / 累積損益 / 最大DD。
関連するバンド別コホート(`summary.json` の `cohortsByBand`: stopAtr・volumeRatio・themeScore・marketRegime・daysToEarnings)も、変更内容に関係するものを確認する。

解釈の注意(既存記録と同じ):
- ウォッチリスト自体が後知恵選択なので**絶対値は楽観的。構成間の相対比較にだけ使う**。
- 同日stop/TP同時成立は損切り扱い(保守的)、手数料・スリッページは0。
- 検証期間が単一の地合いに偏っていないかを必ず注記する。

### 6. 記録を書く(採用でも棄却でも必ず)

`docs/backtest-results/YYYY-MM-<テーマ>.md` を既存3件と同じ構成で作成:

1. タイトル(検証内容と日付)
2. 検証環境(価格データ・対象期間・status・stopMode・rulesHash・関連パラメータ)
3. A/B比較表(全体成績)
4. バンド別の検証(関連コホート)
5. 判断(事前基準を明記し、基準に対する成否で書く)
6. 注意事項(結果の解釈の限界)
7. 再現コマンド

### 7. 採用時のみ

1. `config/rules.json` を変更する
2. `npm run evaluate` で再評価し、買い候補の件数変化を報告する
3. 運用マニュアルのセクション6「検証済みで確定していること」の表に行を追加する
4. コミットはユーザーに確認してから(記録doc・rules.json・マニュアルをまとめて1コミット)

## してはいけないこと

- バックテストを実行する前に rules.json を恒久変更しない(一時編集は手順3の範囲で、必ず元に戻す)。
- 採用基準を満たさなかった結果を「惜しいので採用」しない。基準未達は棄却し、記録だけ残す。
- 検証をスキップして「理論的に正しいはずだから」で変更しない(stop_too_tight・volume_not_dryは理論が実データと逆だった前例)。
