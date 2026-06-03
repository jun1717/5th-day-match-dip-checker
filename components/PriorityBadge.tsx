import type { WatchPriority } from "../lib/types";

interface PriorityBadgeProps {
  priority: WatchPriority;
  scope?: "stock" | "theme";
}

const stockPriorityReasons: Record<string, string> = {
  A: "A: 最優先監視。主力テーマ・主力銘柄として watchlist.csv に設定されているためです。",
  B: "B: 通常監視。準主力・周辺銘柄、または次点テーマとして watchlist.csv に設定されているためです。",
  C: "C: 参考監視。値動きは見るが優先度は低めの候補として watchlist.csv に設定されているためです。"
};

const themePriorityReasons: Record<string, string> = {
  A: "A: テーマ内に最優先監視の銘柄があるため、Aテーマとして表示しています。",
  B: "B: テーマ内の最上位銘柄が通常監視のため、Bテーマとして表示しています。",
  C: "C: テーマ内の最上位銘柄が参考監視のため、Cテーマとして表示しています。"
};

export function PriorityBadge({ priority, scope = "stock" }: PriorityBadgeProps) {
  const label = String(priority || "-");
  const tooltip = priorityTooltip(label, scope);

  return (
    <span className="badge neutral priority-badge" title={tooltip} aria-label={tooltip}>
      {label}
    </span>
  );
}

function priorityTooltip(priority: string, scope: PriorityBadgeProps["scope"]): string {
  const reasons = scope === "theme" ? themePriorityReasons : stockPriorityReasons;
  return reasons[priority] ?? `${priority}: watchlist.csv に設定された独自優先度です。`;
}
