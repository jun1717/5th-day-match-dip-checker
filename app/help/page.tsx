export const metadata = {
  title: "使い方 | 5日線押し目チェッカー"
};

export default function HelpPage() {
  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">使い方</h1>
          <p className="page-meta">5日線押し目チェッカーの操作手順と画面説明</p>
        </div>
      </div>

      <div className="grid" style={{ gap: 16 }}>

        {/* 概要 */}
        <section className="surface span-two">
          <div className="surface-header">
            <h2 className="surface-title">このツールの目的</h2>
          </div>
          <div className="surface-body">
            <p>
              上昇トレンドにある銘柄が5日移動平均線付近まで押し目をつけているかを自動判定し、
              投資テーマ単位で資金が流入しているかを合わせて確認するツールです。
              毎朝チェックシートを手で確認する作業を置き換え、
              テーマ資金・主役株・個別銘柄の押し目条件・価格計画・想定損失をシステマチックに把握できます。
            </p>
          </div>
        </section>

        {/* 毎朝の手順 */}
        <section className="surface span-two">
          <div className="surface-header">
            <h2 className="surface-title">毎朝の作業手順</h2>
          </div>
          <div className="surface-body">
            <ol className="help-steps">
              <li>
                <strong>価格データを取得する</strong>
                <code className="help-code">python scripts/fetch_prices.py</code>
                <span className="muted">前日終値をyfinanceで取得し <code>data/prices.csv</code> を更新します。ネットワーク接続が必要です。</span>
              </li>
              <li>
                <strong>候補を評価する</strong>
                <code className="help-code">npm run evaluate</code>
                <span className="muted">個別押し目スコアとテーマ資金スコアを計算し、<code>data/candidates.json</code> と <code>data/theme_scores.json</code> を更新します。</span>
              </li>
              <li>
                <strong>アプリを起動する（初回のみ）</strong>
                <code className="help-code">npm run dev</code>
                <span className="muted">ブラウザで <code>http://localhost:3000</code> を開きます。起動済みなら不要です。</span>
              </li>
              <li>
                <strong>トップページで全体を確認する</strong>
                <span className="muted">買い候補件数・テーマランキング・買い候補一覧を確認します。</span>
              </li>
              <li>
                <strong>気になる銘柄コードをクリックして詳細を確認する</strong>
                <span className="muted">価格計画（買い基準価格・損切りライン）と当日9:30〜10:00の判断メモを確認します。</span>
              </li>
            </ol>
          </div>
        </section>

        {/* 画面説明 */}
        <section className="surface span-two">
          <div className="surface-header">
            <h2 className="surface-title">画面の説明</h2>
          </div>
          <div className="surface-body">
            <div className="help-screens">

              <div className="help-screen-item">
                <h3 className="help-h3">トップ <span className="muted">（/）</span></h3>
                <ul className="help-list">
                  <li>今日の買い候補件数・監視候補件数・見送り件数をカード表示</li>
                  <li>Aテーマ・Bテーマのランキング上位5件をサイドバイサイドで表示</li>
                  <li>買い候補のみの一覧テーブルを表示（見送りは非表示デフォルト）</li>
                </ul>
              </div>

              <div className="help-screen-item">
                <h3 className="help-h3">候補一覧 <span className="muted">（/candidates）</span></h3>
                <ul className="help-list">
                  <li>全銘柄を買い候補→監視→見送りの順に表示</li>
                  <li>各列ヘッダーをクリックするとその列でソートできます（再クリックで昇降切替）</li>
                  <li>「見送りを表示」チェックボックスで見送り銘柄の表示/非表示を切り替えます</li>
                  <li>銘柄コードリンクをクリックすると銘柄詳細ページへ移動します</li>
                </ul>
              </div>

              <div className="help-screen-item">
                <h3 className="help-h3">投資テーマランキング <span className="muted">（/themes）</span></h3>
                <ul className="help-list">
                  <li>AテーマとBテーマを分けてテーマ順位順に表示</li>
                  <li>5日騰落率平均・20日騰落率平均・主役株の移動平均線維持率でテーマの強さを確認</li>
                  <li>状態が <span className="badge buy" style={{fontSize: '0.75rem'}}>strong</span> のテーマが買いやすい環境です</li>
                </ul>
              </div>

              <div className="help-screen-item">
                <h3 className="help-h3">銘柄詳細 <span className="muted">（/stocks/[code]）</span></h3>
                <ul className="help-list">
                  <li>基本情報・テーマごとの判定・移動平均線の数値・価格計画を一覧表示</li>
                  <li>判定理由の各ルールが <span className="badge pass" style={{fontSize: '0.75rem'}}>pass</span> / <span className="badge fail" style={{fontSize: '0.75rem'}}>fail</span> で色分けされます</li>
                  <li>明日の行動プランと当日9:30〜10:00の判断メモを確認して売買を判断します</li>
                </ul>
              </div>

            </div>
          </div>
        </section>

        {/* 判定ステータス */}
        <section className="surface">
          <div className="surface-header">
            <h2 className="surface-title">判定ステータス</h2>
          </div>
          <div className="surface-body">
            <table>
              <thead>
                <tr>
                  <th>ステータス</th>
                  <th>意味</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><span className="badge buy">買い候補</span></td>
                  <td>個別押し目スコアとテーマ資金スコアが閾値以上で、ハード条件をすべてクリアしている</td>
                </tr>
                <tr>
                  <td><span className="badge watch">監視</span></td>
                  <td>スコアが監視閾値以上だが買い候補には届いていない、またはハード条件に引っかかっている</td>
                </tr>
                <tr>
                  <td><span className="badge avoid">見送り</span></td>
                  <td>スコアが低い、または25日線割れ・想定損失超過などのハード条件で除外</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* テーマステータス */}
        <section className="surface">
          <div className="surface-header">
            <h2 className="surface-title">テーマステータス</h2>
          </div>
          <div className="surface-body">
            <table>
              <thead>
                <tr>
                  <th>ステータス</th>
                  <th>意味</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><span className="badge buy">strong</span></td>
                  <td>テーマ資金スコアが高く、テーマ全体に買い圧力がある</td>
                </tr>
                <tr>
                  <td><span className="badge watch">watch</span></td>
                  <td>テーマがやや弱いが監視に値する</td>
                </tr>
                <tr>
                  <td><span className="badge avoid">weak</span></td>
                  <td>テーマ資金が流出傾向にあり、買いを避けるべき状態</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* スコアの仕組み */}
        <section className="surface span-two">
          <div className="surface-header">
            <h2 className="surface-title">スコアの仕組み</h2>
          </div>
          <div className="surface-body">
            <div className="help-screens">

              <div className="help-screen-item">
                <h3 className="help-h3">個別押し目スコア（0〜100点）</h3>
                <p>銘柄単体の押し目状態を評価します。以下の条件が配点に応じて加算されます。</p>
                <table style={{marginTop: 8}}>
                  <thead>
                    <tr><th>条件</th><th>内容</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>25日線方向</td><td>25日移動平均線が上向きかどうか</td></tr>
                    <tr><td>25日線上維持</td><td>終値が25日移動平均線より上かどうか</td></tr>
                    <tr><td>5日線乖離</td><td>終値が5日移動平均線に対して適切なレンジ内かどうか</td></tr>
                    <tr><td>5日線方向</td><td>5日移動平均線が上向きまたは横ばいかどうか</td></tr>
                    <tr><td>年初来高値からの押し幅</td><td>高値から適切な範囲まで押しているかどうか</td></tr>
                    <tr><td>想定損失</td><td>損切りした場合の損失が上限以内かどうか</td></tr>
                  </tbody>
                </table>
              </div>

              <div className="help-screen-item">
                <h3 className="help-h3">テーマ資金スコア（0〜100点）</h3>
                <p>銘柄が属するテーマ全体のモメンタムを評価します。以下の条件が配点に応じて加算されます。</p>
                <table style={{marginTop: 8}}>
                  <thead>
                    <tr><th>条件</th><th>内容</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>テーマ順位</td><td>全テーマ中の相対ランキングが上位かどうか</td></tr>
                    <tr><td>主役株5日線維持率</td><td>テーマ内の主役株が5日線を上回る割合</td></tr>
                    <tr><td>主役株25日線維持率</td><td>テーマ内の主役株が25日線を上回る割合</td></tr>
                    <tr><td>5日騰落率</td><td>テーマ全体の5日騰落率平均がプラスかどうか</td></tr>
                  </tbody>
                </table>
              </div>

            </div>
          </div>
        </section>

        {/* 候補テーブルの列説明 */}
        <section className="surface span-two">
          <div className="surface-header">
            <h2 className="surface-title">候補一覧テーブルの列説明</h2>
          </div>
          <div className="surface-body">
            <table>
              <thead>
                <tr>
                  <th>列名</th>
                  <th>説明</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>判定</td><td>買い候補 / 監視 / 見送りのステータス</td></tr>
                <tr><td>コード</td><td>銘柄コード（クリックで詳細へ移動）</td></tr>
                <tr><td>銘柄名</td><td>銘柄名</td></tr>
                <tr><td>投資テーマ</td><td>ウォッチリストで設定した投資テーマ</td></tr>
                <tr><td>優先度</td><td>表示優先度。A が最優先、Bが次点</td></tr>
                <tr><td>終値</td><td>前日終値</td></tr>
                <tr><td>5日線</td><td>5日移動平均線の値</td></tr>
                <tr><td>25日線</td><td>25日移動平均線の値</td></tr>
                <tr><td>5日線乖離率</td><td>終値と5日線の乖離率（マイナスは5日線を下回っている）</td></tr>
                <tr><td>25日線方向</td><td>25日線の方向（↑上向き / →横ばい / ↓下向き）</td></tr>
                <tr><td>個別スコア</td><td>個別押し目スコア（0〜100点）</td></tr>
                <tr><td>テーマスコア</td><td>テーマ資金スコア（0〜100点）</td></tr>
                <tr><td>買い基準価格</td><td>5日線に小さなプレミアムを加えた価格</td></tr>
                <tr><td>買い上限価格</td><td>これを超えて買わない上限価格</td></tr>
                <tr><td>損切りライン</td><td>直近安値ベースの損切りライン</td></tr>
                <tr><td>想定損失</td><td>損切りした場合の想定損失額（円）。上限超過は赤表示</td></tr>
                <tr><td>判定理由</td><td>各ルールのpass/fail判定バッジ</td></tr>
                <tr><td>明日の行動</td><td>明日の行動プラン（自動生成テキスト）</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ウォッチリストの編集 */}
        <section className="surface span-two">
          <div className="surface-header">
            <h2 className="surface-title">ウォッチリスト（watchlist.csv）の編集</h2>
          </div>
          <div className="surface-body">
            <p style={{marginBottom: 12}}>
              <code>data/watchlist.csv</code> を直接編集してウォッチ対象を管理します。
              編集後は <code>npm run evaluate</code> を再実行してください。
            </p>
            <table>
              <thead>
                <tr>
                  <th>列</th>
                  <th>説明</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>code</td><td>銘柄コード（4桁、ETF、英数字いずれも可）</td></tr>
                <tr><td>name</td><td>銘柄名（任意の表示名）</td></tr>
                <tr><td>sector</td><td>東証業種など（参考情報のみ）</td></tr>
                <tr><td>theme</td><td>投資テーマ名。テーマ資金判定の主軸</td></tr>
                <tr><td>is_leader</td><td><code>true</code> でそのテーマの主役株として扱う</td></tr>
                <tr><td>watch_priority</td><td>A / B / C で表示優先度を指定</td></tr>
              </tbody>
            </table>
            <p className="muted" style={{marginTop: 12}}>
              同一銘柄を複数テーマに登録する場合は、同じ code で theme を変えた行を追加します。
              内部の一意キーは <code>code + theme</code> です。
            </p>
          </div>
        </section>

        {/* ルールの変更 */}
        <section className="surface span-two">
          <div className="surface-header">
            <h2 className="surface-title">判定ルールの変更（config/rules.json）</h2>
          </div>
          <div className="surface-body">
            <p style={{marginBottom: 12}}>
              <code>config/rules.json</code> を編集することで、スコア配点や閾値を変更できます。
              変更後は必ず <code>npm run evaluate</code> を再実行してください。
            </p>
            <table>
              <thead>
                <tr>
                  <th>パラメータ</th>
                  <th>説明</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>ma5DeviationMin / Max</td><td>5日線乖離率の許容レンジ（例: -3% 〜 +2%）</td></tr>
                <tr><td>yearHighDeviationMin / Max</td><td>年初来高値からの押し幅の許容レンジ</td></tr>
                <tr><td>maxLossYen</td><td>1回の取引での最大許容損失額（円）</td></tr>
                <tr><td>defaultShares</td><td>想定損失計算に使う株数</td></tr>
                <tr><td>individualBuyScoreThreshold</td><td>買い候補と判定する個別スコアの最低値</td></tr>
                <tr><td>individualWatchScoreThreshold</td><td>監視と判定する個別スコアの最低値</td></tr>
                <tr><td>themeBuyScoreThreshold</td><td>買い候補と判定するテーマスコアの最低値</td></tr>
                <tr><td>themeWatchScoreThreshold</td><td>監視と判定するテーマスコアの最低値</td></tr>
                <tr><td>scoring.*</td><td>各ルール条件の配点ウェイト</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* 見送り理由コード */}
        <section className="surface span-two">
          <div className="surface-header">
            <h2 className="surface-title">主な見送り・監視理由バッジ</h2>
          </div>
          <div className="surface-body">
            <table>
              <thead>
                <tr>
                  <th>判定理由バッジ</th>
                  <th>意味</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>25日線割れ</td><td>終値が25日移動平均線を下回っている（ハード見送り条件）</td></tr>
                <tr><td>25日線下向き</td><td>25日移動平均線が下向きトレンドにある</td></tr>
                <tr><td>5日線乖離大</td><td>終値が5日線から大きく乖離していて押し目と言えない</td></tr>
                <tr><td>買い上限超え</td><td>終値が買い上限価格を上回っており追いかけ買いのリスクがある</td></tr>
                <tr><td>テーマ弱い</td><td>テーマ資金スコアが低くテーマ全体の勢いがない</td></tr>
                <tr><td>想定損失超過</td><td>損切りした場合の損失が上限を超える</td></tr>
                <tr><td>価格データなし</td><td>yfinanceで価格データを取得できなかった</td></tr>
                <tr><td>ブレイクアウト型</td><td>高値更新中で押し目でなく上抜けパターン</td></tr>
                <tr><td>25日線押し目型</td><td>5日線より25日線への押し目が深い状態</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* 未実装機能 */}
        <section className="surface span-two">
          <div className="surface-header">
            <h2 className="surface-title">現時点で未実装の機能</h2>
          </div>
          <div className="surface-body">
            <ul className="help-list">
              <li>リアルタイム5分足判定（現在は前日終値ベース）</li>
              <li>TOPIX比較によるβ補正</li>
              <li>出来高フィルター</li>
              <li>決算日フィルター（決算前後の銘柄の自動除外）</li>
              <li>自動売買連携</li>
            </ul>
          </div>
        </section>

      </div>
    </main>
  );
}
