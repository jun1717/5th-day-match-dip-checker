import { CandidateStatus, ExitMode, ThemeStatus, Trend } from "./types";

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value);
}

export function formatYen(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return `${formatNumber(value, 0)}円`;
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return `${(value * 100).toFixed(digits)}%`;
}

export function statusLabel(status: CandidateStatus): string {
  return {
    buy_candidate: "買い候補",
    watch: "監視",
    avoid: "見送り"
  }[status];
}

export function themeStatusLabel(status: ThemeStatus): string {
  return {
    strong: "strong",
    watch: "watch",
    weak: "weak"
  }[status];
}

export function formatPricesAsOf(isoString: string | null): string {
  if (!isoString) return "前日終値";
  const match = isoString.match(/T(\d{2}:\d{2})/);
  return match ? `${match[1]} 時点` : "前日終値";
}

export function trendLabel(trend: Trend): string {
  return {
    up: "上向き",
    flat: "横ばい",
    down: "下向き",
    unknown: "-"
  }[trend];
}

export function formatRewardR(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  return `${value.toFixed(2)}R`;
}

export function exitModeLabel(mode: ExitMode | null | undefined): string {
  if (!mode) return "-";
  return mode === "trend_follow_exit" ? "トレンド継続なら保有" : "第1利確で全決済";
}
