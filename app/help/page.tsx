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
                <h3 className="help-h3">BB押し目一覧 <span className="muted">（/bb-watch）</span></h3>
                <ul className="help-list">
                  <li>銘柄ごとにボリンジャーバンド（25日）の押し目ライン（MA25・-1σ・-2σ）への過去の反発実績を集計</li>
                  <li>得意ライン（過去最も反発しやすかったライン）と現在の接近状況を確認できる<strong>監視・分析専用</strong>のページ</li>
                  <li>初期表示は「タイミング良い」「監視」のみ。チェックボックスで「データ不足」「押し目ラインから遠い」銘柄も表示可能</li>
                  <li>5日線買い候補とは別物であり、買い候補件数や候補一覧には含まれません</li>
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

        {/* BB押し目一覧について */}
        <section className="surface span-two">
          <div className="surface-header">
            <h2 className="surface-title">BB押し目一覧について</h2>
          </div>
          <div className="surface-body">
            <p>
              BB押し目一覧は、ボリンジャーバンドを使って銘柄ごとの反発しやすい押し目ラインを分析する監視ページです。
            </p>
            <p style={{ marginTop: 12 }}>
              5日線買い候補とは別物であり、現時点では正式な買い候補ではありません。
            </p>
            <p style={{ marginTop: 12 }}>
              MA25、-1σ、-2σのうち、過去にどのラインで反発しやすかったかを集計し、現在そのラインに近づいている銘柄を表示します。
            </p>
            <p style={{ marginTop: 12 }}>
              将来的に売買ルールへ昇格させる可能性はありますが、現時点では補助分析として使います。
            </p>
            <table style={{ marginTop: 16 }}>
              <thead>
                <tr>
                  <th>判定（bbWatchStatus）</th>
                  <th>意味</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><span className="badge buy">タイミング良い</span></td>
                  <td>得意ラインに接近していて、その反発成功率が60%以上、テーマ資金スコアも基準以上、25日線も下向きすぎない状態</td>
                </tr>
                <tr>
                  <td><span className="badge watch">監視</span></td>
                  <td>MA25・-1σ・-2σのいずれかに接近しているが、タイミング良いの基準には届いていない状態</td>
                </tr>
                <tr>
                  <td><span className="badge neutral">データ不足</span></td>
                  <td>過去の接触回数が不足していて、得意ライン（preferredLine）を判定できない状態</td>
                </tr>
                <tr>
                  <td><span className="badge avoid">押し目ラインから遠い</span></td>
                  <td>どの押し目ラインにも近づいていない状態</td>
                </tr>
              </tbody>
            </table>
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

        {/* 損切り・利確の考え方 */}
        <section className="surface span-two">
          <div className="surface-header">
            <h2 className="surface-title">損切りラインと利確ラインの考え方</h2>
          </div>
          <div className="surface-body">
            <div className="help-screens">

              <div className="help-screen-item">
                <h3 className="help-h3">損切りライン＝前日安値</h3>
                <p>
                  5日線押し目買いは「前日に5日線付近で下げ止まった」というシナリオで入る。
                  前日安値を終値で割り込むということは、その日のサポートが崩れてシナリオが否定されたことを意味する。
                  損切りは「シナリオが崩れた地点」に置くのが合理的であり、前日安値はその地点として最も明確で、前日引け後に確定できる具体的な数値。
                </p>
                <p className="muted" style={{marginTop: 8}}>
                  算出式: <code>stopLoss = 前日（T-1）の安値</code>
                </p>
                <p className="muted" style={{marginTop: 4}}>
                  想定損失 = （買い基準価格 − 損切りライン）× 株数（デフォルト100株）。
                  この値が <code>maxLossYen</code>（デフォルト12,000円）を超える場合は「見送り」に分類される。
                </p>
              </div>

              <div className="help-screen-item">
                <h3 className="help-h3">第1利確ライン＝直近20営業日の高値</h3>
                <p>
                  5日線押し目で買う理由は「上昇トレンド中の一時的押し目から、直近高値方向への再上昇」を狙うため。
                  第1利確の目標は「直近でつけた高値を再び試すこと」であり、それが最も自然な利確水準。
                  20営業日（約1ヶ月）を使うのは、現在のトレンドサイクルで実際につけた上値抵抗を示すから。
                  それ以上古い高値はテーマが変わっている可能性があり、参考にならない。
                </p>
                <p className="muted" style={{marginTop: 8}}>
                  算出式: <code>takeProfit1 = 直近{"{recentHighLookback}"}営業日の日中高値の最大値</code>（デフォルト20日）
                </p>
              </div>

              <div className="help-screen-item">
                <h3 className="help-h3">リワードR（rewardR）と格下げ条件</h3>
                <p>
                  リワードRは「利確ラインまでの利幅÷損切り幅」で計算するリスクリワード比。
                  1R = 損切り幅1本分の利益を意味する。
                </p>
                <p style={{marginTop: 8}}>
                  5日線押し目シナリオでは、リワードRが1.0未満（利益が損失より小さい）の場合は
                  <strong>「買い候補」から「監視」に格下げ</strong>される。
                  利確ラインまでの余地が少ない状態でリスクを取ることは、期待値が下がるため。
                </p>
                <p className="muted" style={{marginTop: 8}}>
                  算出式: <code>riskR = 買い基準価格 − 損切りライン</code><br />
                  <code>reward = 第1利確ライン − 買い基準価格</code><br />
                  <code>rewardR = reward ÷ riskR</code>
                </p>
              </div>

              <div className="help-screen-item">
                <h3 className="help-h3">利確モードと利確警戒</h3>
                <p>
                  利確方針は2つのモードで表示される。
                </p>
                <ul className="help-list" style={{marginTop: 8}}>
                  <li>
                    <strong>第1利確で全決済（通常モード）</strong>：
                    テーマ資金スコアが90点未満の場合。第1利確ライン到達で全株売却する。
                  </li>
                  <li>
                    <strong>トレンド継続なら保有（トレンド継続モード）</strong>：
                    テーマ資金スコアが90点以上の場合。第1利確到達後も終値が5日線を維持する間は保有を続け、5日線終値割れで売る。
                  </li>
                </ul>
                <p style={{marginTop: 8}}>
                  また、以下の条件が重なる場合は<strong>「利確警戒」</strong>として詳細ページに表示される。
                  ポジションを持っているときの撤退判断に使う。
                </p>
                <ul className="help-list" style={{marginTop: 8}}>
                  <li>25日線乖離率が +8% 以上（過熱感が出ている）</li>
                  <li>テーマ資金スコアが60点未満に低下（テーマの勢いが衰えた）</li>
                  <li>主役株の半数以上が5日線を割り込んだ（テーマ全体が崩れ始めた）</li>
                </ul>
              </div>

            </div>
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
                <tr><td>損切りライン</td><td>前日安値。この水準を終値で割ると買いシナリオが崩れたと判断する</td></tr>
                <tr><td>想定損失</td><td>損切りした場合の想定損失額（円）。上限超過は赤表示</td></tr>
                <tr><td>第1利確ライン</td><td>直近20営業日の高値。5日線押し目シナリオの最初の利確目標</td></tr>
                <tr><td>リワードR</td><td>利確ラインまでの利幅÷損切り幅。1R未満（利確余地が少ない）は赤表示で監視に格下げ</td></tr>
                <tr><td>利確方針</td><td>テーマスコアが90点以上なら「トレンド継続なら保有」、未満なら「第1利確で全決済」</td></tr>
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
                <tr><td>recentHighLookback</td><td>第1利確ライン（直近高値）の参照日数。デフォルト20営業日（約1ヶ月）</td></tr>
                <tr><td>minRewardR</td><td>買い候補と判定するリワードRの最低値。デフォルト1.0（損切り幅と同等以上の利幅が必要）</td></tr>
                <tr><td>profitWarningMa25Deviation</td><td>利確警戒を表示する25日線乖離率の閾値。デフォルト0.08（+8%以上で過熱とみなす）</td></tr>
                <tr><td>trendFollowThemeScoreThreshold</td><td>トレンド継続モードに切り替えるテーマスコアの閾値。デフォルト90点</td></tr>
                <tr><td>individualBuyScoreThreshold</td><td>買い候補と判定する個別スコアの最低値</td></tr>
                <tr><td>individualWatchScoreThreshold</td><td>監視と判定する個別スコアの最低値</td></tr>
                <tr><td>themeBuyScoreThreshold</td><td>買い候補と判定するテーマスコアの最低値</td></tr>
                <tr><td>themeWatchScoreThreshold</td><td>監視と判定するテーマスコアの最低値（利確警戒の閾値も兼ねる）</td></tr>
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
                <tr><td>利確余地が1R未満</td><td>リワードRが1.0未満。損切り幅に対して利確ラインまでの利幅が小さく、期待値が低い。買い候補から監視に格下げ</td></tr>
                <tr><td>直近高値が近すぎる</td><td>第1利確ライン（直近20日高値）が買い基準価格以下。利確ラインより高い位置でしか買えない状態</td></tr>
                <tr><td>25日線乖離大・過熱気味</td><td>25日線乖離率が +8% 以上。短期的な過熱感があり押し目とは言いにくい状態</td></tr>
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
              <li>出来高増の上ヒゲ陰線による利確警戒（出来高データの取得が必要）</li>
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
