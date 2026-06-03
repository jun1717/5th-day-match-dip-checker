import { PriceRow, WatchlistKey, WatchlistRow } from "./types";

export function parseCsv(text: string): Record<string, string>[] {
  const rows = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (rows.length === 0) {
    return [];
  }

  const headers = parseCsvLine(rows[0]).map((header) => header.trim());

  return rows.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return headers.reduce<Record<string, string>>((record, header, index) => {
      record[header] = cells[index]?.trim() ?? "";
      return record;
    }, {});
  });
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
      continue;
    }

    cell += char;
  }

  cells.push(cell);
  return cells;
}

export function normalizeCode(code: string): string {
  const raw = String(code).trim();
  return /^\d+$/.test(raw) ? raw.padStart(4, "0") : raw;
}

export function toWatchlistKey(code: string, theme: string): WatchlistKey {
  return `${code}__${theme}` as WatchlistKey;
}

export function toWatchlistRows(text: string): WatchlistRow[] {
  return parseCsv(text).map((row) => {
    const code = normalizeCode(row.code);
    const theme = row.theme;

    return {
      watchlistKey: toWatchlistKey(code, theme),
      code,
      name: row.name,
      sector: row.sector,
      theme,
      isLeader: row.is_leader.toLowerCase() === "true",
      watchPriority: row.watch_priority
    };
  });
}

export function toPriceRows(text: string): PriceRow[] {
  return parseCsv(text)
    .map((row) => ({
      code: normalizeCode(row.code),
      date: row.date,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume)
    }))
    .filter((row) =>
      row.date &&
      Number.isFinite(row.open) &&
      Number.isFinite(row.high) &&
      Number.isFinite(row.low) &&
      Number.isFinite(row.close) &&
      Number.isFinite(row.volume)
    );
}
