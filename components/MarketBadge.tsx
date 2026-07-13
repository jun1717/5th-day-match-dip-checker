import { trendLabel } from "../lib/format";
import { MarketCondition } from "../lib/types";
import { ColoredPercent } from "./ColoredPercent";

interface MarketRegimeProps {
  market: MarketCondition | null;
  marketIndexCode: string;
}

/** トップページの「候補件数」メトリクス列に並べる地合いカード */
export function MarketMetricCard({ market, marketIndexCode }: MarketRegimeProps) {
  const regimeOk = market?.regimeOk ?? null;

  return (
    <div className="metric">
      <div className="metric-label">地合い（{marketIndexCode}）</div>
      <div className="metric-value" style={{ color: regimeColor(regimeOk) }}>
        {regimeLabel(regimeOk)}
      </div>
      {market && (
        <div className="metric-note">
          25日線乖離 <ColoredPercent value={market.ma25Deviation} digits={2} />・{trendLabel(market.ma25Trend)}
        </div>
      )}
    </div>
  );
}

/** 候補一覧ページのヘッダーに1行で出すテキスト表示 */
export function MarketSummaryLine({ market, marketIndexCode }: MarketRegimeProps) {
  const regimeOk = market?.regimeOk ?? null;

  return (
    <p className="page-meta">
      地合い（{marketIndexCode}）:{" "}
      <span style={{ color: regimeColor(regimeOk), fontWeight: 700 }}>{regimeLabel(regimeOk)}</span>
      {market && (
        <>
          （25日線乖離 <ColoredPercent value={market.ma25Deviation} digits={2} />・{trendLabel(market.ma25Trend)}）
        </>
      )}
    </p>
  );
}

function regimeLabel(regimeOk: boolean | null): string {
  if (regimeOk === true) return "OK";
  if (regimeOk === false) return "NG";
  return "不明";
}

function regimeColor(regimeOk: boolean | null): string | undefined {
  if (regimeOk === true) return "var(--green)";
  if (regimeOk === false) return "var(--red)";
  return undefined;
}
