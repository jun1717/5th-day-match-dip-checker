"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { bbWatchStatusLabel, bollingerLineLabel, formatNumber, formatPercent } from "../lib/format";
import { ColoredPercent } from "./ColoredPercent";
import { BbWatchResult, BbWatchStatus } from "../lib/types";
import { ScoreBadge } from "./ScoreBadge";

interface BbWatchTableProps {
  rows: BbWatchResult[];
}

const DEFAULT_VISIBLE_STATUSES: BbWatchStatus[] = ["timing_good", "watch"];

export function BbWatchTable({ rows }: BbWatchTableProps) {
  const [showAll, setShowAll] = useState(false);

  const visibleRows = useMemo(
    () => rows.filter((row) => showAll || DEFAULT_VISIBLE_STATUSES.includes(row.bbWatchStatus)),
    [rows, showAll]
  );

  if (rows.length === 0) {
    return <div className="empty">BB押し目データがありません</div>;
  }

  return (
    <div>
      <div className="toolbar">
        <span className="muted">{visibleRows.length}件表示</span>
        <label className="toggle">
          <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
          データ不足・押し目ラインから遠い銘柄も表示
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>判定</th>
              <th>コード</th>
              <th>銘柄名</th>
              <th>投資テーマ</th>
              <th>テーマスコア</th>
              <th className="text-right">終値</th>
              <th>得意ライン</th>
              <th>現在位置</th>
              <th className="text-right">反発成功率</th>
              <th className="text-right">接触回数</th>
              <th className="text-right">平均最大上昇率(5日)</th>
              <th className="text-right">平均最大下落率(5日)</th>
              <th>分析理由</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.watchlistKey}>
                <td>
                  <span className={`badge ${bbWatchStatusClass(row.bbWatchStatus)}`}>{bbWatchStatusLabel(row.bbWatchStatus)}</span>
                </td>
                <td>
                  <Link className="link" href={`/stocks/${row.code}`}>
                    {row.code}
                  </Link>
                </td>
                <td>{row.name}</td>
                <td>{row.theme}</td>
                <td>
                  <ScoreBadge score={row.themeScore} />
                </td>
                <td className="text-right">{formatNumber(row.close)}</td>
                <td>{bollingerLineLabel(row.preferredLine)}</td>
                <td>{bollingerLineLabel(row.currentLine)}</td>
                <td className="text-right">{formatPercent(row.successRate, 0)}</td>
                <td className="text-right">{formatNumber(row.touchCount)}</td>
                <td className="text-right">
                  <ColoredPercent value={row.avgMaxReturn5d} digits={2} />
                </td>
                <td className="text-right">
                  <ColoredPercent value={row.avgMaxDrawdown5d} digits={2} />
                </td>
                <td>
                  <div className="reason-badges">
                    {row.reasons.map((reason, index) => (
                      <span className="badge neutral" key={`${row.watchlistKey}-${reason.key}-${index}`}>
                        {reason.label}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function bbWatchStatusClass(status: BbWatchStatus): string {
  if (status === "timing_good") return "buy";
  if (status === "watch") return "watch";
  if (status === "insufficient_history") return "neutral";
  return "avoid";
}
