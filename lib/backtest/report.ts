import { SimulatedTrade } from "./simulate";

export interface TradeStats {
  signals: number;
  fills: number;
  fillRate: number | null;
  wins: number;
  losses: number;
  winRate: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  expectancyR: number | null;
  expectancyYen: number | null;
  profitFactor: number | null;
  totalPnlYen: number;
  maxDrawdownYen: number;
  avgHoldDays: number | null;
}

export interface TradeLike {
  trade: SimulatedTrade;
}

export function computeTradeStats(records: TradeLike[]): TradeStats {
  const filled = records
    .map((record) => record.trade)
    .filter((trade): trade is SimulatedTrade & { pnlYen: number; rMultiple: number; exitDate: string; holdDays: number } =>
      trade.filled && trade.pnlYen !== undefined && trade.rMultiple !== undefined
    );

  const wins = filled.filter((trade) => trade.pnlYen > 0);
  const losses = filled.filter((trade) => trade.pnlYen <= 0);
  const grossWin = wins.reduce((total, trade) => total + trade.pnlYen, 0);
  const grossLoss = losses.reduce((total, trade) => total + trade.pnlYen, 0);

  return {
    signals: records.length,
    fills: filled.length,
    fillRate: ratioOrNull(filled.length, records.length),
    wins: wins.length,
    losses: losses.length,
    winRate: ratioOrNull(wins.length, filled.length),
    avgWinR: meanOrNull(wins.map((trade) => trade.rMultiple)),
    avgLossR: meanOrNull(losses.map((trade) => trade.rMultiple)),
    expectancyR: meanOrNull(filled.map((trade) => trade.rMultiple)),
    expectancyYen: meanOrNull(filled.map((trade) => trade.pnlYen)),
    profitFactor: grossLoss < 0 ? grossWin / -grossLoss : null,
    totalPnlYen: grossWin + grossLoss,
    maxDrawdownYen: maxDrawdown(filled),
    avgHoldDays: meanOrNull(filled.map((trade) => trade.holdDays))
  };
}

function maxDrawdown(filled: Array<SimulatedTrade & { pnlYen: number; exitDate: string }>): number {
  const ordered = filled.slice().sort((a, b) => a.exitDate.localeCompare(b.exitDate));
  let cumulative = 0;
  let peak = 0;
  let drawdown = 0;

  for (const trade of ordered) {
    cumulative += trade.pnlYen;
    peak = Math.max(peak, cumulative);
    drawdown = Math.max(drawdown, peak - cumulative);
  }

  return drawdown;
}

export function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = grouped.get(key) ?? [];
    bucket.push(item);
    grouped.set(key, bucket);
  }

  return grouped;
}

export function individualScoreBand(score: number): string {
  if (score >= 95) return "95-100";
  if (score >= 90) return "90-94";
  if (score >= 85) return "85-89";
  if (score >= 70) return "70-84";
  return "<70";
}

function ratioOrNull(count: number, total: number): number | null {
  return total > 0 ? count / total : null;
}

function meanOrNull(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function meanOf(values: Array<number | null>): number | null {
  return meanOrNull(values.filter((value): value is number => value !== null && Number.isFinite(value)));
}

export function positiveRateOf(values: Array<number | null>): number | null {
  const usable = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return ratioOrNull(usable.filter((value) => value > 0).length, usable.length);
}

export function csvCell(value: string | number | boolean): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// ---- コンソール表示ヘルパー ----

export function formatTable(headers: string[], rows: string[][]): string {
  const table = [headers, ...rows];
  const widths = headers.map((_, column) => Math.max(...table.map((row) => displayWidth(row[column] ?? ""))));
  const lines = table.map((row) => row.map((cell, column) => padDisplay(cell ?? "", widths[column])).join("  "));
  lines.splice(1, 0, widths.map((width) => "-".repeat(width)).join("  "));
  return lines.join("\n");
}

function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += char.codePointAt(0)! > 0x2e80 ? 2 : 1;
  }

  return width;
}

function padDisplay(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

export function pct(value: number | null, digits = 1): string {
  return value === null ? "-" : `${(value * 100).toFixed(digits)}%`;
}

export function num(value: number | null, digits = 2): string {
  return value === null ? "-" : value.toFixed(digits);
}

export function yen(value: number | null): string {
  return value === null ? "-" : `${Math.round(value).toLocaleString("ja-JP")}円`;
}
