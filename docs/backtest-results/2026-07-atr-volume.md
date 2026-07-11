# 検証記録: ATR損切り品質・リスクベース建玉・出来高ドライアップ (2026-07-12)

`docs/plan-atr-sizing-and-volume.md` のM5(A/B検証と既定値決定)の実施記録。

## 検証環境

- 価格データ: `data/prices_backtest.csv`(2年分・分割調整済み・確定日足。2026-07-11取得)
- 対象期間: 2025-07-23 〜 2026-06-12(216営業日)、対象status: buy_candidate、stopMode: prev-day、maxHoldDays: 30
- rulesHash: `377015a8abd7`(atrPeriod=14 / stopAtrMinMultiple=0.3 / volumeShortWindow=3 / volumeLongWindow=20 / volumeDryUpMaxRatio=0.85 / lotSize=100 / maxPositionYen=null)
- エンジン注記: riskモードの株数は**エントリー時に実際に使う損切り(stopMode=prev-dayならシグナル日安値)の幅で再計算**する(plan D-1の実装時修正)。シグナル時の損切り幅(前日比)で計算すると、押しの深い日に1トレードの実リスクがmaxLossYenを大きく超え、最大DDが約27万円→309万円に悪化することを感度分析で確認済み。1単元でも予算超過の場合は `risk_over_budget` としてエントリーしない(38件発生)。

## A/B比較(全体成績)

| 構成 | sizing | stopTight | volume | シグナル | 約定 | 勝率 | 期待値R | 期待値(円) | PF | 累積損益 | 最大DD |
|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | fixed | off | off | 569 | 293 | 22.5% | 0.546 | 970円 | 1.39 | 28.4万円 | 11.5万円 |
| **risk-sizing** | **risk** | off | off | 575 | 271 | 22.1% | **0.619** | **4,115円** | **1.60** | **111.5万円** | 26.9万円 |
| stop-tight | risk | **exclude** | off | 400 | 198 | 22.7% | 0.471 | 3,652円 | 1.55 | 72.3万円 | 16.2万円 |
| volume | risk | off | **exclude** | 219 | 122 | 23.0% | 0.437 | 4,872円 | 1.74 | 59.4万円 | 27.3万円 |
| both | risk | exclude | exclude | 159 | 91 | 22.0% | 0.215 | 2,514円 | 1.37 | 22.9万円 | 23.4万円 |

シグナル数がbaselineと異なるのは、riskモードで `risk_over_budget` により見送られたトレードがポジションを塞がず、同一銘柄の後続シグナルが評価されるため。

## バンド別の検証(risk-sizing構成、フィルターoff)

コホート(buy_candidate、執行モデルなしのフォワードリターン):

| 損切り幅ATRバンド | n | fwd5 | fwd20 |
|---|---|---|---|
| <0.3(フラグ対象) | 247 | +2.37% | **+9.15%** |
| 0.3-0.6 | 299 | +1.50% | +5.49% |
| 0.6-1.0 | 173 | +1.71% | +4.66% |
| 1.0-1.5 | 32 | +0.85% | +4.07% |

| 出来高比バンド | n | fwd5 | fwd20 |
|---|---|---|---|
| <0.6(枯れ) | 61 | +2.67% | +4.73% |
| 0.6-0.85(枯れ) | 213 | +0.86% | +5.05% |
| 0.85-1.0 | 186 | +1.58% | +6.48% |
| 1.0-1.3(フラグ対象) | 218 | +1.86% | +7.50% |
| ≥1.3(フラグ対象) | 75 | **+4.25%** | **+8.71%** |

トレード側(約定ベース)でも同傾向: stopAtr <0.3 の期待値R 0.701 は悪くなく、出来高比 ≥1.3 は期待値R 1.938 で最良バンド。

## 判断(事前基準: 期待値R改善 かつ 約定数がベースラインの60%以上)

1. **sizingMode = "risk" を採用**(既定値のまま)。分類はfixedと完全一致(パリティ)のうえ、エントリー時の想定損失再チェック(`risk_over_budget` 見送り)込みで期待値R 0.546→0.619、PF 1.39→1.60、期待値(円)は970→4,115円。最大DDは26.9万円で、1トレードのリスクが1.2万円に揃った状態の約22R相当=リスクモデルとして誠実な数字。
2. **stopTightFilterMode = "flag" 維持**(excludeに昇格しない)。exclude時の期待値R 0.471 < 0.619 で基準未達。コホートでも「損切りがタイト(<0.3 ATR)な候補ほどfwd20が良い」(+9.15%)という**仮説と逆**の結果。タイトな損切りは銘柄の質の問題ではなく執行リスク(ノイズ狩られ)の問題であり、riskモードのエントリー時再サイジングが実質的な守りになっている。
3. **volumeFilterMode = "flag" 維持**。exclude時は約定数45%(基準の60%未満)かつ期待値R 0.437 < 0.619。コホートは「出来高が増えながらの押し目ほどfwd20が良い」(≥1.3で+8.71%)という**ドライアップ仮説と逆**の単調傾向。テーマ株ユニバースでは押し目での出来高増=資金流入継続を示す可能性がある。逆張り(出来高増を買う)への転換は、実運用のシグナル履歴(`npm run analyze:signals`)で再確認してから検討する。

## 注意事項(結果の解釈)

- ウォッチリスト自体が後知恵選択のため絶対値は楽観的。判断はすべて構成間の相対比較に基づく。
- 期間が約10.5ヶ月(216営業日)の単一の強気局面であり、バンド別の傾向(特に出来高)は地合いが変わると反転しうる。
- 同日stop/TP同時成立は損切り扱い(保守的)、手数料・スリッページは0。
- `maxPositionYen` は null(上限なし)で検証した。riskモードは損切りが狭い銘柄で数百〜数千株を提案するため、**実運用では自分の1銘柄あたり投入上限を `config/rules.json` の `maxPositionYen` に必ず設定すること**(設定すると候補の選別自体も変わるので、設定後に再度バックテストで確認を推奨)。

## 再現コマンド

```bash
python3 scripts/fetch_prices.py --period 2y --output data/prices_backtest.csv --no-intraday --auto-adjust
npm run backtest -- --sizing fixed --stop-tight-filter off --volume-filter off --out data/backtest/baseline
npm run backtest -- --sizing risk  --stop-tight-filter off --volume-filter off --out data/backtest/risk-sizing
npm run backtest -- --sizing risk  --stop-tight-filter exclude --volume-filter off --out data/backtest/stop-tight
npm run backtest -- --sizing risk  --stop-tight-filter off --volume-filter exclude --out data/backtest/volume
npm run backtest -- --sizing risk  --stop-tight-filter exclude --volume-filter exclude --out data/backtest/both
```
