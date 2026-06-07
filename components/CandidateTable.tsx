"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatNumber, formatPercent, formatYen, formatRewardR, exitModeLabel, statusLabel, trendLabel } from "../lib/format";
import { ColoredPercent } from "./ColoredPercent";
import { CandidateResult, CandidateStatus } from "../lib/types";
import { PriorityBadge } from "./PriorityBadge";
import { ScoreBadge } from "./ScoreBadge";

interface CandidateTableProps {
  candidates: CandidateResult[];
  maxLossYen: number;
  defaultShowAvoid?: boolean;
}

type SortKey =
  | "status"
  | "code"
  | "name"
  | "theme"
  | "watchPriority"
  | "close"
  | "ma5"
  | "ma25"
  | "ma5Deviation"
  | "ma25Trend"
  | "individualScore"
  | "themeScore"
  | "entryPrice"
  | "entryUpperPrice"
  | "stopLoss"
  | "expectedLoss"
  | "takeProfit1"
  | "rewardR";

const statusOrder: Record<CandidateStatus, number> = {
  buy_candidate: 0,
  watch: 1,
  avoid: 2
};

export function CandidateTable({ candidates, maxLossYen, defaultShowAvoid = false }: CandidateTableProps) {
  const [showAvoid, setShowAvoid] = useState(defaultShowAvoid);
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");

  const rows = useMemo(() => {
    return candidates
      .filter((candidate) => showAvoid || candidate.status !== "avoid")
      .slice()
      .sort((a, b) => compareCandidates(a, b, sortKey, direction));
  }, [candidates, direction, showAvoid, sortKey]);

  const updateSort = (nextKey: SortKey) => {
    if (nextKey === sortKey) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setDirection(nextKey === "status" ? "asc" : "desc");
  };

  if (candidates.length === 0) {
    return <div className="empty">候補データがありません</div>;
  }

  return (
    <div>
      <div className="toolbar">
        <span className="muted">{rows.length}件表示</span>
        <label className="toggle">
          <input type="checkbox" checked={showAvoid} onChange={(event) => setShowAvoid(event.target.checked)} />
          見送りを表示
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <SortableHeader label="判定" sortKey="status" currentKey={sortKey} direction={direction} onSort={updateSort} />
              <SortableHeader label="コード" sortKey="code" currentKey={sortKey} direction={direction} onSort={updateSort} />
              <SortableHeader label="銘柄名" sortKey="name" currentKey={sortKey} direction={direction} onSort={updateSort} />
              <SortableHeader label="投資テーマ" sortKey="theme" currentKey={sortKey} direction={direction} onSort={updateSort} />
              <SortableHeader label="優先度" sortKey="watchPriority" currentKey={sortKey} direction={direction} onSort={updateSort} />
              <SortableHeader label="終値" sortKey="close" currentKey={sortKey} direction={direction} onSort={updateSort} />
              <SortableHeader label="5日線" sortKey="ma5" currentKey={sortKey} direction={direction} onSort={updateSort} />
              <SortableHeader label="25日線" sortKey="ma25" currentKey={sortKey} direction={direction} onSort={updateSort} />
              <SortableHeader label="5日線乖離率" sortKey="ma5Deviation" currentKey={sortKey} direction={direction} onSort={updateSort} />
              <SortableHeader label="25日線方向" sortKey="ma25Trend" currentKey={sortKey} direction={direction} onSort={updateSort} />
              <SortableHeader label="個別スコア" sortKey="individualScore" currentKey={sortKey} direction={direction} onSort={updateSort} />
              <SortableHeader label="テーマスコア" sortKey="themeScore" currentKey={sortKey} direction={direction} onSort={updateSort} />
              <SortableHeader label="買い基準価格" sortKey="entryPrice" currentKey={sortKey} direction={direction} onSort={updateSort} />
              <SortableHeader label="買い上限価格" sortKey="entryUpperPrice" currentKey={sortKey} direction={direction} onSort={updateSort} />
              <SortableHeader label="損切りライン" sortKey="stopLoss" currentKey={sortKey} direction={direction} onSort={updateSort} />
              <SortableHeader label="想定損失" sortKey="expectedLoss" currentKey={sortKey} direction={direction} onSort={updateSort} />
              <SortableHeader label="第1利確ライン" sortKey="takeProfit1" currentKey={sortKey} direction={direction} onSort={updateSort} />
              <SortableHeader label="リワードR" sortKey="rewardR" currentKey={sortKey} direction={direction} onSort={updateSort} />
              <th>利確方針</th>
              <th>判定理由</th>
              <th>明日の行動</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((candidate) => (
              <tr key={candidate.watchlistKey}>
                <td>
                  <span className={`badge ${statusClass(candidate.status)}`}>{statusLabel(candidate.status)}</span>
                </td>
                <td>
                  <Link className="link" href={`/stocks/${candidate.code}`}>
                    {candidate.code}
                  </Link>
                </td>
                <td>{candidate.name}</td>
                <td>{candidate.theme}</td>
                <td>
                  <PriorityBadge priority={candidate.watchPriority} />
                </td>
                <td className="text-right">{formatNumber(candidate.close)}</td>
                <td className="text-right">{formatNumber(candidate.ma5, 1)}</td>
                <td className="text-right">{formatNumber(candidate.ma25, 1)}</td>
                <td className="text-right"><ColoredPercent value={candidate.ma5Deviation} digits={2} /></td>
                <td>{trendLabel(candidate.ma25Trend)}</td>
                <td>
                  <ScoreBadge score={candidate.individualScore} />
                </td>
                <td>
                  <ScoreBadge score={candidate.themeScore} />
                </td>
                <td className="text-right">{formatNumber(candidate.entryPrice)}</td>
                <td className="text-right">{formatNumber(candidate.entryUpperPrice)}</td>
                <td className="text-right">{formatNumber(candidate.stopLoss)}</td>
                <td className="text-right">
                  <span className={candidate.expectedLoss !== null && candidate.expectedLoss > maxLossYen ? "badge danger" : ""}>
                    {formatYen(candidate.expectedLoss)}
                  </span>
                </td>
                <td className="text-right">{formatNumber(candidate.takeProfit1)}</td>
                <td className="text-right">
                  <span className={candidate.rewardR !== null && candidate.rewardR < 1.0 ? "badge fail" : ""}>
                    {formatRewardR(candidate.rewardR)}
                  </span>
                </td>
                <td>{exitModeLabel(candidate.exitMode)}</td>
                <td>
                  <div className="reason-badges">
                    {candidate.reasons.map((reason, index) => (
                      <span className={`badge ${reason.passed ? "pass" : "fail"}`} key={`${candidate.watchlistKey}-${reason.key}-${index}`}>
                        {reason.label}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="actions-cell">{candidate.tomorrowAction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface SortableHeaderProps {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
}

function SortableHeader({ label, sortKey, currentKey, direction, onSort }: SortableHeaderProps) {
  const marker = currentKey === sortKey ? (direction === "asc" ? " ↑" : " ↓") : "";
  return (
    <th className="sortable" onClick={() => onSort(sortKey)}>
      {label}
      {marker}
    </th>
  );
}

function compareCandidates(a: CandidateResult, b: CandidateResult, key: SortKey, direction: "asc" | "desc") {
  const multiplier = direction === "asc" ? 1 : -1;
  const aValue = valueForSort(a, key);
  const bValue = valueForSort(b, key);

  if (typeof aValue === "number" && typeof bValue === "number") {
    return (aValue - bValue) * multiplier;
  }

  return String(aValue).localeCompare(String(bValue), "ja") * multiplier;
}

function valueForSort(candidate: CandidateResult, key: SortKey): string | number {
  if (key === "status") {
    return statusOrder[candidate.status];
  }

  const value = candidate[key];
  if (typeof value === "number") {
    return value;
  }

  if (value === null) {
    return Number.NEGATIVE_INFINITY;
  }

  return String(value);
}

function statusClass(status: CandidateStatus): string {
  return status === "buy_candidate" ? "buy" : status;
}
