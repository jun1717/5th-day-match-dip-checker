import { BbWatchStatus, CandidateStatus, CurrentLine, ExitMode, PreferredLine, ThemeStatus, Trend } from "./types";

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

export function bbWatchStatusLabel(status: BbWatchStatus): string {
  return {
    timing_good: "タイミング良い",
    watch: "監視",
    insufficient_history: "データ不足",
    not_near: "押し目ラインから遠い"
  }[status];
}

export function bollingerLineLabel(line: PreferredLine | CurrentLine): string {
  return {
    ma25: "MA25",
    bb_minus_1sigma: "-1σ",
    bb_minus_2sigma: "-2σ",
    insufficient_history: "データ不足",
    not_near_pullback_line: "押し目ラインから遠い"
  }[line];
}
