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

export interface ExecutionRow {
  executedAt: string;
  code: string;
  side: "buy" | "sell";
  price: number;
  shares: number;
  memo: string;
}

/**
 * data/trades/executions.csv のパース。手動記録ファイルのため不正行は黙ってスキップせず
 * 行番号付きでエラーにする(記録のゴミは突き合わせ分析全体を静かに歪めるため)。
 */
export function toExecutionRows(text: string): ExecutionRow[] {
  const rows = parseCsv(text).map((row, index) => {
    const line = index + 2; // ヘッダーが1行目
    const executedAt = row.executedAt ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(executedAt)) {
      throw new Error(`executions.csv ${line}行目: executedAt は YYYY-MM-DD 形式で指定してください: "${executedAt}"`);
    }

    const side = row.side;
    if (side !== "buy" && side !== "sell") {
      throw new Error(`executions.csv ${line}行目: side は buy か sell を指定してください: "${side}"`);
    }

    const price = Number(row.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`executions.csv ${line}行目: price は正の数値で指定してください: "${row.price}"`);
    }

    const shares = Number(row.shares);
    if (!Number.isInteger(shares) || shares <= 0) {
      throw new Error(`executions.csv ${line}行目: shares は正の整数で指定してください: "${row.shares}"`);
    }

    return {
      executedAt,
      code: normalizeCode(row.code),
      // 上の検証でbuy/sellに限定済み(string型からの否定絞り込みはTSが行わないため明示する)
      side: side as ExecutionRow["side"],
      price,
      shares,
      memo: row.memo ?? ""
    };
  });

  // 安定ソート: 同日内はファイル記載順を保つ
  return rows.slice().sort((a, b) => a.executedAt.localeCompare(b.executedAt));
}

export interface EarningsRow {
  code: string;
  earningsDate: string; // YYYY-MM-DD
  memo: string;
}

/**
 * data/earnings.csv のパース。手動記録ファイルのため不正行は黙ってスキップせず
 * 行番号付きでエラーにする(toExecutionRows と同じ思想)。日付昇順にソートして返す。
 */
export function toEarningsRows(text: string): EarningsRow[] {
  const rows = parseCsv(text).map((row, index) => {
    const line = index + 2; // ヘッダーが1行目
    const earningsDate = row.earningsDate ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(earningsDate)) {
      throw new Error(`earnings.csv ${line}行目: earningsDate は YYYY-MM-DD 形式で指定してください: "${earningsDate}"`);
    }

    const rawCode = (row.code ?? "").trim();
    if (rawCode === "") {
      throw new Error(`earnings.csv ${line}行目: code は必須です`);
    }

    return {
      code: normalizeCode(rawCode),
      earningsDate,
      memo: row.memo ?? ""
    };
  });

  // 同一銘柄の複数四半期を正しく引くため日付昇順に整列する(安定ソート)
  return rows.slice().sort((a, b) => a.earningsDate.localeCompare(b.earningsDate));
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
