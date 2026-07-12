import assert from "node:assert/strict";
import test from "node:test";
import { stopAtrBand, themeScoreBand, volumeRatioBand } from "../lib/backtest/report";

test("stopAtrBand puts the default threshold 0.3 on a band boundary", () => {
  assert.equal(stopAtrBand(null), "不明");
  assert.equal(stopAtrBand(0.29), "<0.3");
  assert.equal(stopAtrBand(0.3), "0.3-0.6"); // 0.3ちょうどは条件を満たす側
  assert.equal(stopAtrBand(0.6), "0.6-1.0");
  assert.equal(stopAtrBand(1.0), "1.0-1.5");
  assert.equal(stopAtrBand(1.5), "≥1.5");
});

test("themeScoreBand puts the thresholds 60/80/90 on band boundaries", () => {
  assert.equal(themeScoreBand(0), "<60");
  assert.equal(themeScoreBand(59), "<60");
  assert.equal(themeScoreBand(60), "60-79"); // 60ちょうどはwatch側
  assert.equal(themeScoreBand(79), "60-79");
  assert.equal(themeScoreBand(80), "80-89"); // 80ちょうどは買い基準側
  assert.equal(themeScoreBand(89), "80-89");
  assert.equal(themeScoreBand(90), "90-100"); // 90ちょうどはトレンドフォロー側
  assert.equal(themeScoreBand(100), "90-100");
});

test("volumeRatioBand puts the default threshold 0.85 on a band boundary", () => {
  assert.equal(volumeRatioBand(null), "不明");
  assert.equal(volumeRatioBand(0.59), "<0.6");
  assert.equal(volumeRatioBand(0.85), "0.6-0.85"); // 0.85ちょうどは枯れ(条件を満たす)側
  assert.equal(volumeRatioBand(0.851), "0.85-1.0");
  assert.equal(volumeRatioBand(1.0), "1.0-1.3");
  assert.equal(volumeRatioBand(1.3), "≥1.3");
});
