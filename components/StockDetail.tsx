import {
  bbWatchStatusLabel,
  bollingerLineLabel,
  exitModeLabel,
  formatNumber,
  formatPercent,
  formatRewardR,
  formatYen,
  statusLabel,
  trendLabel
} from "../lib/format";
import { ColoredPercent } from "./ColoredPercent";
import { BbWatchResult, CandidateResult, PriceRow } from "../lib/types";
import { CandleChart } from "./CandleChart";
import { PriorityBadge } from "./PriorityBadge";
import { RuleBadge } from "./RuleBadge";
import { ScoreBadge } from "./ScoreBadge";

interface StockDetailProps {
  candidates: CandidateResult[];
  prices: PriceRow[];
  bbWatch?: BbWatchResult;
}

export function StockDetail({ candidates, prices, bbWatch }: StockDetailProps) {
  const primary = candidates[0];
  const sectors = Array.from(new Set(candidates.map((candidate) => candidate.sector))).join(" / ");

  const yahooUrl = `https://finance.yahoo.co.jp/quote/${primary.code}.T`;
  const kabutanUrl = `https://kabutan.jp/stock/chart?code=${primary.code}`;

  return (
    <div className="grid">
      <section className="surface span-two">
        <div className="surface-header">
          <h2 className="surface-title">日足チャート（直近90営業日）</h2>
          <div className="external-links">
            <a href={yahooUrl} target="_blank" rel="noopener noreferrer" className="external-link">
              Yahoo!ファイナンス ↗
            </a>
            <a href={kabutanUrl} target="_blank" rel="noopener noreferrer" className="external-link">
              株探チャート ↗
            </a>
          </div>
        </div>
        <CandleChart
          prices={prices}
          entryPrice={primary.entryPrice}
          entryUpperPrice={primary.entryUpperPrice}
          stopLoss={primary.stopLoss}
        />
      </section>

      <section className="surface">
        <div className="surface-header">
          <h2 className="surface-title">基本情報</h2>
          <span className={`badge ${primary.status === "buy_candidate" ? "buy" : primary.status}`}>
            {statusLabel(primary.status)}
          </span>
        </div>
        <div className="surface-body">
          <div className="detail-grid">
            <Detail label="コード" value={primary.code} />
            <Detail label="銘柄名" value={primary.name} />
            <Detail label="所属テーマ数" value={String(candidates.length)} />
            <Detail label="参考セクター" value={sectors} />
            <Detail label="終値" value={formatNumber(primary.close)} />
            <Detail label="出来高" value={formatNumber(primary.volume)} />
            <Detail label="個別押し目スコア" value={<ScoreBadge score={primary.individualScore} />} />
            <Detail label="最上位テーマ資金スコア" value={<ScoreBadge score={primary.themeScore} />} />
          </div>
        </div>
      </section>

      <section className="surface">
        <div className="surface-header">
          <h2 className="surface-title">所属テーマごとの判定</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>投資テーマ</th>
                <th>優先度</th>
                <th>判定</th>
                <th>テーマスコア</th>
                <th>判定理由</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr key={candidate.watchlistKey}>
                  <td>{candidate.theme}</td>
                  <td>
                    <PriorityBadge priority={candidate.watchPriority} />
                  </td>
                  <td>
                    <span className={`badge ${candidate.status === "buy_candidate" ? "buy" : candidate.status}`}>
                      {statusLabel(candidate.status)}
                    </span>
                  </td>
                  <td>
                    <ScoreBadge score={candidate.themeScore} />
                  </td>
                  <td>
                    <ReasonBadges candidate={candidate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="summary-row">
        <section className="surface">
          <div className="surface-header">
            <h2 className="surface-title">{primary.theme} の判定理由</h2>
          </div>
          <div className="surface-body">
            <ul className="reason-list">
              {primary.reasons.map((reason, index) => (
                <li className="reason-item" key={`${reason.key}-${index}`}>
                  <span className="reason-main">
                    <strong>{reason.label}</strong>
                    <span className="muted">{reason.detail}</span>
                  </span>
                  <RuleBadge passed={reason.passed} />
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="surface">
          <div className="surface-header">
            <h2 className="surface-title">5日線・25日線</h2>
          </div>
          <div className="surface-body">
            <div className="detail-grid">
              <Detail label="5日線" value={formatNumber(primary.ma5, 1)} />
              <Detail label="25日線" value={formatNumber(primary.ma25, 1)} />
              <Detail label="5日線乖離率" value={<ColoredPercent value={primary.ma5Deviation} digits={2} />} />
              <Detail label="25日線乖離率" value={<ColoredPercent value={primary.ma25Deviation} digits={2} />} />
              <Detail label="5日線傾き" value={<span style={{ color: slopeColor(primary.ma5Slope) }}>{formatNumber(primary.ma5Slope, 2)}</span>} />
              <Detail label="25日線傾き" value={<span style={{ color: slopeColor(primary.ma25Slope) }}>{formatNumber(primary.ma25Slope, 2)}</span>} />
              <Detail label="5日線方向" value={trendLabel(primary.ma5Trend)} />
              <Detail label="25日線方向" value={trendLabel(primary.ma25Trend)} />
            </div>
          </div>
        </section>
      </div>

      <section className="surface">
        <div className="surface-header">
          <h2 className="surface-title">価格計画</h2>
        </div>
        <div className="surface-body">
          <div className="detail-grid">
            <Detail label="買い基準価格" value={formatNumber(primary.entryPrice)} />
            <Detail label="買い上限価格" value={formatNumber(primary.entryUpperPrice)} />
            <Detail label="損切りライン" value={formatNumber(primary.stopLoss)} />
            <Detail label="推奨株数" value={formatNumber(primary.suggestedShares)} />
            <Detail label="概算投入額" value={formatYen(primary.positionCost)} />
            <Detail label="想定損失" value={formatYen(primary.expectedLoss)} />
            <Detail label="ATR(14日)" value={formatNumber(primary.atr, 1)} />
            <Detail label="損切り幅(ATR倍)" value={primary.stopDistanceAtr === null ? "-" : `${primary.stopDistanceAtr.toFixed(2)} ATR`} />
            <Detail label="出来高比(3日/20日)" value={primary.volumeRatio === null ? "-" : primary.volumeRatio.toFixed(2)} />
            <Detail label="年初来高値" value={formatNumber(primary.yearHigh)} />
            <Detail label="年初来高値乖離" value={<ColoredPercent value={primary.yearHighDeviation} digits={2} />} />
            <Detail label="5日騰落率" value={<ColoredPercent value={primary.return5d} digits={2} />} />
            <Detail label="20日騰落率" value={<ColoredPercent value={primary.return20d} digits={2} />} />
          </div>
        </div>
      </section>

      <section className="surface span-two">
        <div className="surface-header">
          <h2 className="surface-title">売買シナリオ</h2>
        </div>
        <div className="surface-body">
          <div className="detail-grid">
            <Detail
              label="買いシナリオ"
              value="上昇トレンド中の一時的な押し目から、直近高値方向への再上昇を狙う"
            />
            <Detail
              label="損切りシナリオ"
              value={`前日安値（${formatNumber(primary.stopLoss)}円）を終値で割り込んだら即撤退`}
            />
            <Detail
              label="利確シナリオ"
              value={exitModeLabel(primary.exitMode)}
            />
            <Detail label="第1利確ライン（直近20日高値）" value={formatNumber(primary.takeProfit1)} />
            <Detail
              label="リワードR"
              value={
                <span className={primary.rewardR !== null && primary.rewardR < 1.0 ? "badge fail" : ""}>
                  {formatRewardR(primary.rewardR)}
                </span>
              }
            />
            <Detail
              label="通常モードの売却条件"
              value={`第1利確ライン（${formatNumber(primary.takeProfit1)}円）到達で全決済`}
            />
            <Detail
              label="トレンド継続モードの売却条件"
              value="第1利確到達後もテーマ資金スコア90点以上かつ5日線上を維持している間は保有継続。5日線終値割れで売却"
            />
          </div>
        </div>
      </section>

      {primary.profitWarnings.length > 0 && (
        <section className="surface span-two">
          <div className="surface-header">
            <h2 className="surface-title">利確警戒</h2>
          </div>
          <div className="surface-body">
            <ul className="reason-list">
              {primary.profitWarnings.map((warning) => (
                <li className="reason-item" key={warning.key}>
                  <span className="reason-main">
                    <strong>{warning.label}</strong>
                  </span>
                  <span className="badge fail">警戒</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="surface">
        <div className="surface-header">
          <h2 className="surface-title">明日の行動プラン</h2>
        </div>
        <div className="surface-body">{primary.tomorrowAction}</div>
      </section>

      <section className="surface">
        <div className="surface-header">
          <h2 className="surface-title">当日9:30〜10:00の判断メモ</h2>
        </div>
        <div className="surface-body">
          <ul className="memo-list">
            {primary.intradayMemo.map((memo) => (
              <li className="memo-item" key={memo}>
                {memo}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {bbWatch && <BbWatchSection bbWatch={bbWatch} />}
    </div>
  );
}

function BbWatchSection({ bbWatch }: { bbWatch: BbWatchResult }) {
  const ma25Stats = bbWatch.lineStats.find((stats) => stats.line === "ma25");
  const lower1Stats = bbWatch.lineStats.find((stats) => stats.line === "bb_minus_1sigma");
  const lower2Stats = bbWatch.lineStats.find((stats) => stats.line === "bb_minus_2sigma");

  return (
    <section className="surface span-two">
      <div className="surface-header">
        <h2 className="surface-title">ボリンジャーバンド押し目分析</h2>
        <span className={`badge ${bbWatchStatusClass(bbWatch.bbWatchStatus)}`}>{bbWatchStatusLabel(bbWatch.bbWatchStatus)}</span>
      </div>
      <div className="surface-body">
        <p className="muted" style={{ marginBottom: 12 }}>
          BB押し目分析は監視・分析用の情報であり、現時点では正式な買い候補ではありません。5日線買い候補の判定とは独立して計算しています。
        </p>

        <div className="detail-grid">
          <Detail label="得意ライン（preferredLine）" value={bollingerLineLabel(bbWatch.preferredLine)} />
          <Detail label="現在位置（currentLine）" value={bollingerLineLabel(bbWatch.currentLine)} />
          <Detail label="MA25" value={formatNumber(bbWatch.ma25, 1)} />
          <Detail label="BB +1σ" value={formatNumber(bbWatch.bbUpper1, 1)} />
          <Detail label="BB +2σ" value={formatNumber(bbWatch.bbUpper2, 1)} />
          <Detail label="BB -1σ" value={formatNumber(bbWatch.bbLower1, 1)} />
          <Detail label="BB -2σ" value={formatNumber(bbWatch.bbLower2, 1)} />
          <Detail label="25日線方向" value={trendLabel(bbWatch.ma25Trend)} />
        </div>

        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>反発分析対象ライン</th>
                <th className="text-right">接触回数</th>
                <th className="text-right">反発成功率</th>
                <th className="text-right">平均最大上昇率(5日)</th>
                <th className="text-right">平均最大下落率(5日)</th>
              </tr>
            </thead>
            <tbody>
              <BbLineStatsRow label="MA25反発成功率" stats={ma25Stats} />
              <BbLineStatsRow label="BB -1σ反発成功率" stats={lower1Stats} />
              <BbLineStatsRow label="BB -2σ反発成功率" stats={lower2Stats} />
            </tbody>
          </table>
        </div>

        <div className="reason-badges" style={{ marginTop: 16 }}>
          {bbWatch.reasons.map((reason, index) => (
            <span className="badge neutral" key={`${reason.key}-${index}`}>
              {reason.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function BbLineStatsRow({ label, stats }: { label: string; stats?: { touchCount: number; successRate: number; avgMaxReturn5d: number; avgMaxDrawdown5d: number } }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="text-right">{stats ? formatNumber(stats.touchCount) : "-"}</td>
      <td className="text-right">{stats ? formatPercent(stats.successRate, 0) : "-"}</td>
      <td className="text-right">{stats ? <ColoredPercent value={stats.avgMaxReturn5d} digits={2} /> : "-"}</td>
      <td className="text-right">{stats ? <ColoredPercent value={stats.avgMaxDrawdown5d} digits={2} /> : "-"}</td>
    </tr>
  );
}

function bbWatchStatusClass(status: BbWatchResult["bbWatchStatus"]): string {
  if (status === "timing_good") return "buy";
  if (status === "watch") return "watch";
  if (status === "insufficient_history") return "neutral";
  return "avoid";
}

function slopeColor(value: number | null | undefined): string | undefined {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return undefined;
  return value > 0 ? "#b42318" : "#1d5d90";
}

function ReasonBadges({ candidate }: { candidate: CandidateResult }) {
  return (
    <div className="reason-badges">
      {candidate.reasons.map((reason, index) => (
        <span className={`badge ${reason.passed ? "pass" : "fail"}`} key={`${candidate.watchlistKey}-${reason.key}-${index}`}>
          {reason.label}
        </span>
      ))}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="detail-item">
      <div className="detail-label">{label}</div>
      <div className="detail-value">{value}</div>
    </div>
  );
}
