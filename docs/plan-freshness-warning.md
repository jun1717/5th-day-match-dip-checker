# 実装計画: データ鮮度警告バナー(確定前データ・履歴保存停止の可視化)

このドキュメントは、トップページに「表示中のデータが確定日足でない」「シグナル履歴の保存が止まっている」の2つの警告バナーを追加するための実装計画である。実装者(AIエージェントを含む)がこのファイルだけを読んで作業を完遂できることを目的とする。

**背景**: 2026-07-13〜17、GitHub Actionsの16:30 JSTラン(確定日足の反映+シグナル履歴スナップショット)が「Commit signal history」ステップのgit失敗(`git pull --rebase` が未ステージ変更で拒否)により全滅し、履歴が1件も蓄積されず、夜にサイトで見えていたのは15:20時点の場中データだった。この障害に**1週間誰も気づけなかった**。ワークフロー自体は修正済み(`--autostash` 追加+コミットステップをデプロイ後へ移動)だが、この運用は「毎日見るのはサイトだけ。ローカルでコマンドを打つのは月次だけ」(docs/運用マニュアル.md)という設計のため、**自動化の静かな失敗はユーザーが毎日見る唯一の場所=サイト上で警告する**必要がある。

追加する警告は2つ:

- **W1 確定前データ警告(赤・クライアント時刻依存)**: 判断開始時刻(平日16:40 JST)を過ぎているのに、表示中データの終値基準(`pricesAsOf`)がその営業日の大引け(15:30 JST)より前 → 「この画面で翌朝の注文を組んではいけない」と明示する。
- **W2 履歴保存停止警告(黄・ビルド時確定)**: 最新スナップショット日付がデータ日付から2営業日以上遅れている → 当日の判定には影響しないが、月次レビュー(`analyze:signals`)の基盤が静かに死んでいることを知らせる。

## 0. 前提知識(現状のアーキテクチャ)

- サイトはNext.jsの**静的エクスポート**(`next.config.ts` の `output: "export"`、`basePath` は環境変数)。ページはビルド時にファイルを読むサーバーコンポーネントで、**デプロイ後の閲覧時刻には一切追従しない**(時刻依存の判定はクライアントでしかできない)。
- `app/page.tsx`(トップページ)は `readEvaluation()`(`lib/data.ts`)で評価結果を読み、`page-header` 内に「データ日付: {candidates[0]?.date} 終値基準: {formatPricesAsOf(evaluation.pricesAsOf)}」を表示している。`formatPricesAsOf` は `lib/format.ts`。
- `pricesAsOf` の実体は `data/prices_as_of.json`(`{"as_of": "2026-07-13T15:24:00+09:00"}` 形式・`scripts/fetch_prices.py` が書く)。**場中実行では場中時刻になる**。null になり得る(`lib/data.ts` の `readPricesAsOf()` 参照)。
- デプロイ頻度(`.github/workflows/update-and-deploy.yml`): 平日09:00〜15:20 JSTは20分毎(場中データ)、16:30 JSTに確定日足+スナップショット。**GitHub Actionsのcronは最大2時間程度遅延した実績がある**(16:30ランが18:27 JST開始の例)。つまり16:40を過ぎても確定版が未デプロイなのは異常時だけでなく平常運転でも起こる — W1はその間「まだ確定前」と正しく警告し、ユーザーは再読み込みして消えるのを待てばよい、という設計にする。
- スナップショットは `data/history/signals/YYYY-MM-DD.json`(ファイル名=**価格データの日付**)。16:30ランでのみ生成・コミットされる。ワークフローは snapshot → build の順なので、**16:30ランのビルド時には当日分がワークスペースに存在する**。場中ビルドでは前日16:30分までしか無い(=1営業日遅れが正常)。
- `lib/calendar.ts` の `weekdaysBetween(from, to)`: from**排他**・to**包含**の平日(月〜金)数。祝日非考慮の平日近似。`to <= from` は 0。
- CSSトークンは `app/globals.css` の `:root` に定義済み: `--red` / `--red-bg` / `--yellow` / `--yellow-bg` など。バッジの前例は `.badge.danger` 等。
- テスト: `npm test`(node:test + tsx、`tests/*.test.ts`)。型チェック: `npm run typecheck`。
- **hydration注意**: 静的HTMLと初回クライアント描画が一致しないとNext.jsはhydrationエラーを出す。現在時刻に依存する表示は「マウント前はnullを返し、`useEffect` 後に描画する」定石を使う。

## 1. 設計方針(先に読む・重要な決定事項)

1. **判定ロジックは純関数として `lib/freshness.ts` に置き、現在時刻(epoch ms)を引数注入する**。UIコンポーネントは薄く保ち、境界条件はすべてユニットテストで固定する(このプロジェクトの他ロジックと同じ流儀)。
2. **W1はクライアント側でのみ判定する**。マウント前は何も描画せず(hydration対策)、マウント後に `Date.now()` で判定し、60秒間隔で再評価する(タブを開きっぱなしで16:40を跨ぐケース)。
3. **W2はビルド時に確定する**(入力がすべてビルド時のファイル)。propsから決定的に計算できるため、マウント前から描画してよい(hydration mismatchは起きない)。場中の20分毎デプロイで自動的に最新化される。
4. **JSTはUTC+9固定**で計算する(日本にDSTなし)。閲覧者の端末タイムゾーン設定に依存させないため、比較はすべてepoch msで行い、JSTの暦日・時刻が必要な箇所は `new Date(ms + 9*3600*1000)` の `getUTC*` 系アクセサで取る。
5. **平日近似(祝日非考慮)を踏襲**する(決算フィルターと同じ既存方針)。祝日はW1が偽陽性になる(休場なのに「確定前」と出る)が、休場日に翌朝の注文を組むことはないため実害はない。READMEに明記する。
6. **W2のしきい値は2営業日**。場中ビルドでは最新スナップショット=前営業日分が正常(遅れ1)のため、1では毎日午前中に偽陽性になる。2以上は「前営業日の16:30スナップショットがコミットされなかった」ことを意味する。
7. **正常時は何も出さない**(緑の「正常」表示はノイズ。既存の「終値基準:」表示がそのまま残る)。
8. 非目標(本計画ではやらない): 祝日カレンダー対応、トップページ以外への展開、プッシュ/メール通知(GitHub標準のワークフロー失敗通知で代替可能)、W1のためのサーバー側リアルタイムAPI。

## 2. 全体像(新規・変更ファイル)

```
新規: lib/freshness.ts               … 判定純関数(latestDecisionDay / confirmedCloseWarning / snapshotLagWarning)
新規: components/FreshnessBanner.tsx … "use client" のバナーコンポーネント
新規: tests/freshness.test.ts        … 境界テスト
変更: lib/data.ts                    … readLatestSnapshotDate() 追加
変更: app/page.tsx                   … page-header 直下にバナー設置
変更: app/globals.css                … .freshness-banner スタイル追加
変更: README.md                      … 機能説明を1段落追加
```

## 3. `lib/freshness.ts` の仕様

```ts
/** 直近の「判断開始済み営業日」(YYYY-MM-DD、JST基準)。
 *  now(JST)が平日Dの16:40以降ならD、それ以外(平日16:40前・土日)は直前の平日。 */
export function latestDecisionDay(nowMs: number): string;

export interface ConfirmedCloseWarning {
  decisionDay: string;        // 確定日足が期待される営業日
  pricesAsOf: string | null;  // 表示に使う(nullは取得時刻不明)
}
/** W1: 確定前データ警告。警告不要なら null。
 *  D = latestDecisionDay(nowMs) とし、pricesAsOf が「D の 15:30:00 JST」以上なら確定済み(null)。
 *  pricesAsOf が null / パース不能な場合は警告する。境界: ちょうど15:30:00は確定扱い(>=)。 */
export function confirmedCloseWarning(pricesAsOf: string | null, nowMs: number): ConfirmedCloseWarning | null;

export interface SnapshotLagWarning {
  latestSnapshotDate: string | null; // null = スナップショットが1件も無い
  lagDays: number | null;            // weekdaysBetween(latestSnapshotDate, dataDate)。latestSnapshotDate=nullならnull
}
/** W2: 履歴保存停止警告。警告不要なら null。
 *  dataDate(評価に使った最新価格バーの日付)が null → null(データ欠損は別系統の問題)。
 *  latestSnapshotDate が null → 警告(lagDays: null)。
 *  それ以外 → lag = weekdaysBetween(latestSnapshotDate, dataDate)。lag >= 2 で警告。 */
export function snapshotLagWarning(latestSnapshotDate: string | null, dataDate: string | null): SnapshotLagWarning | null;
```

実装メモ:

- `latestDecisionDay`: `nowMs + 9h` の `Date` を作り `getUTCDay()` / `getUTCHours()` / `getUTCMinutes()` で判定。当日が平日かつ 16:40以降ならその日。そうでなければ1日ずつ遡り、最初の平日を返す(過去の平日は16:40を常に過ぎている)。返り値は `YYYY-MM-DD`(0埋め)。
- `confirmedCloseWarning`: Dの15:30 JST のepochは `Date.UTC(y, m-1, d, 6, 30)`(= 06:30 UTC)。`pricesAsOf` は `Date.parse()`(ISO 8601 + `+09:00` オフセット付きなのでそのまま解釈できる)。`Number.isNaN` ならパース不能として警告。
- `snapshotLagWarning`: `weekdaysBetween` を `lib/calendar.ts` からインポートして使う(再実装しない)。`latestSnapshotDate > dataDate`(未来のスナップショット)は `weekdaysBetween` が 0 を返すので自然に警告なしになる。

## 4. `lib/data.ts` の追加仕様

```ts
/** data/history/signals/ にある YYYY-MM-DD.json の最大日付。ディレクトリ不存在・0件は null */
export function readLatestSnapshotDate(): string | null;
```

- `existsSync` でガードし、`readdirSync` の結果を `/^\d{4}-\d{2}-\d{2}\.json$/` でフィルタ、ファイル名の文字列比較で最大を取り、`.json` を除いて返す。
- 既存の `resolvePath` を使う。ソートに `Date` パースは不要(ゼロ埋めISO日付は辞書順=時系列順)。

## 5. `components/FreshnessBanner.tsx` の仕様

```tsx
"use client";
interface Props {
  pricesAsOf: string | null;
  latestSnapshotDate: string | null;
  dataDate: string | null; // evaluation.candidates[0]?.date ?? null
}
```

- `const [nowMs, setNowMs] = useState<number | null>(null)`。`useEffect` で `setNowMs(Date.now())` + `setInterval` 60秒(クリーンアップ必須)。
- **W2**(propsのみで決定的)は `nowMs` に関係なく描画してよい。**W1**は `nowMs !== null` になってから判定・描画する。
- 警告文言(絵文字ではなくテキスト記号を使う):
  - W1(class `freshness-banner danger`): 「⚠ 表示中の判定は確定日足ではありません(終値基準: {formatPricesAsOf(pricesAsOf)})。16:30の自動更新が未反映か失敗しています。反映されるまでこの画面で翌朝の注文を組まないでください(時間をおいて再読み込み)。」
  - W2(class `freshness-banner warning`): 「⚠ シグナル履歴の保存が止まっています(最終スナップショット: {latestSnapshotDate ?? "なし"})。当日の判定には影響しませんが、月次レビュー用の履歴が欠けていきます。GitHub Actionsの実行ログを確認してください。」
- `formatPricesAsOf` は `lib/format.ts` の既存関数を再利用。
- 両方成立時は両方縦に並べる(W1が上)。

## 6. `app/page.tsx` / `app/globals.css` の変更

- `page-header` の閉じ `</div>` 直後(metricsセクションの前)に設置:

```tsx
<FreshnessBanner
  pricesAsOf={evaluation.pricesAsOf}
  latestSnapshotDate={readLatestSnapshotDate()}
  dataDate={evaluation.candidates[0]?.date ?? null}
/>
```

- CSS(既存トークンを使用。数値は既存の `.surface` / `.badge` の角丸・余白の流儀に合わせて微調整してよい):

```css
.freshness-banner { padding: 10px 14px; border-radius: 8px; margin-top: 12px; font-size: 14px; line-height: 1.6; border: 1px solid transparent; }
.freshness-banner.danger  { color: var(--red);    background: var(--red-bg);    border-color: var(--red); }
.freshness-banner.warning { color: var(--yellow); background: var(--yellow-bg); border-color: var(--yellow); }
.freshness-banner + .freshness-banner { margin-top: 8px; }
```

## 7. テスト計画(`tests/freshness.test.ts`)

時刻はすべて「JSTでの意味」をコメントに書き、`Date.UTC(...)` で組み立てる(例: JST 2026-07-17(金) 16:40 = `Date.UTC(2026, 6, 17, 7, 40)`)。

`latestDecisionDay`:

1. 金曜16:39 JST → 前日木曜。金曜16:40 JST → 当日金曜(境界は「以降」)。
2. 土曜10:00 → 金曜。日曜 → 金曜。月曜09:00 → 前週金曜。月曜16:40 → 月曜。
3. JST日付境界: JST月曜00:30(= UTC日曜15:30)→ 前週金曜(UTCの曜日ではなくJSTの曜日で判定できていること)。

`confirmedCloseWarning`:

4. 平日17:00、asOf=同日16:31+09:00 → null(確定済み)。
5. 平日17:00、asOf=同日15:24+09:00 → 警告(場中データ)。
6. 平日17:00、asOf=前営業日16:31 → 警告(丸1日更新なし)。
7. 土曜、asOf=金曜16:31 → null。月曜09:00、asOf=金曜16:31 → null。
8. asOf=null → 警告。asOf="invalid" → 警告。
9. 境界: asOf=ちょうど同日15:30:00+09:00 → null(>= は確定扱い)。

`snapshotLagWarning`:

10. snapshot == dataDate → null(遅れ0)。
11. snapshot=金曜、dataDate=月曜 → lag 1 → null(場中ビルドの正常形)。
12. snapshot=水曜、dataDate=金曜 → lag 2 → 警告。snapshot=木曜、dataDate=月曜(週末跨ぎ)→ lag 2 → 警告。
13. snapshot=null → 警告(lagDays null)。dataDate=null → null。

## 8. マイルストーン

- **M1**: `lib/freshness.ts` + `tests/freshness.test.ts`。`npm test` と `npm run typecheck` が通ること。
- **M2**: `readLatestSnapshotDate()` + `FreshnessBanner` + `app/page.tsx` 統合 + CSS + README追記。
- **M3**: 手動確認 — `npm run dev` で通常表示(警告なし)を確認後、`data/prices_as_of.json` の時刻を一時的に前営業日15:00へ書き換えてW1が出ること、`data/history/signals` の状態でW2が出ること(現状は最新スナップショットが古いのでそのまま出るはず)を確認。**確認後は `git checkout -- data/prices_as_of.json` で必ず戻す**。

## 9. 将来拡張(本計画ではやらない)

- 正常時の小さな緑チップ(「確定日足・履歴正常」)— ノイズと相談。
- `/candidates` など他ページへの展開(コンポーネントは再利用可能な形で作ってあるので設置だけ)。
- 祝日カレンダー(内閣府「国民の祝日」CSV)による偽陽性排除。
- ワークフロー失敗時のプッシュ通知(まずはGitHubの標準通知設定=Actions失敗メールを有効にすれば足りる)。
