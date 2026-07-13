const MS_PER_DAY = 86_400_000;

/** YYYY-MM-DD を「1970-01-01 からの通日」に変換する。Date.UTC ベースでタイムゾーン非依存 */
function dayNumber(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/**
 * from(exclusive)からto(inclusive)までの平日(月〜金)の数。祝日は考慮しない(近似)。
 * to === from は 0。from > to の入力も 0 を返す(呼び出し側で to >= from を保証すること)。
 * O(1)(全週×5 + 端数)で計算する — バックテストで銘柄×営業日ごとに呼ばれるため。
 */
export function weekdaysBetween(from: string, to: string): number {
  const start = dayNumber(from);
  const end = dayNumber(to);
  const span = end - start; // (from, to] に含まれる通日数
  if (span <= 0) {
    return 0;
  }

  // 連続する7日はどこを切っても平日ちょうど5日 → 全週分は端数と独立に確定する
  const fullWeeks = Math.floor(span / 7);
  let count = fullWeeks * 5;

  // 端数日: from の翌日(start+1)から remainder 日ぶんの平日を数える
  const remainder = span - fullWeeks * 7;
  for (let offset = 1; offset <= remainder; offset += 1) {
    // 1970-01-01(通日0)は木曜。dow: 0=日 .. 6=土
    const dow = (((start + offset) % 7) + 4) % 7;
    if (dow >= 1 && dow <= 5) {
      count += 1;
    }
  }

  return count;
}
