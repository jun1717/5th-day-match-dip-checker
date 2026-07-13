import assert from "node:assert/strict";
import test from "node:test";
import { weekdaysBetween } from "../lib/calendar";

// 基準日: 2024-01-01(月) / 03(水) / 05(金) / 08(月) / 15(月) / 19(金)

test("weekdaysBetween counts weekdays from (exclusive) to (inclusive)", () => {
  assert.equal(weekdaysBetween("2024-01-05", "2024-01-05"), 0); // 同日
  assert.equal(weekdaysBetween("2024-01-05", "2024-01-08"), 1); // 金→翌月曜(土日を挟む)
  assert.equal(weekdaysBetween("2024-01-03", "2024-01-05"), 2); // 水→金(木・金)
  assert.equal(weekdaysBetween("2024-01-05", "2024-01-15"), 6); // 金→翌々月曜(週またぎ)
});

test("weekdaysBetween ignores weekend-only spans", () => {
  assert.equal(weekdaysBetween("2024-01-05", "2024-01-06"), 0); // 金→土
  assert.equal(weekdaysBetween("2024-01-05", "2024-01-07"), 0); // 金→日
});

test("weekdaysBetween matches a hand count over a multi-week span (O(1) formula)", () => {
  // 2024-01-01(月, exclusive) 〜 2024-01-19(金, inclusive):
  // 火水木金(4) + 月〜金(5) + 月〜金(5) = 14
  assert.equal(weekdaysBetween("2024-01-01", "2024-01-19"), 14);
});

test("weekdaysBetween returns 0 when from > to", () => {
  assert.equal(weekdaysBetween("2024-01-08", "2024-01-05"), 0);
});
