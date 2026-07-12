import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  percentileOf,
  scoreTheme,
  scoreThemeContinuous,
  ThemeScoreInput,
  themeScoreComponentsOf
} from "../lib/scoring";
import { Rules } from "../lib/types";

const rules = JSON.parse(readFileSync("config/rules.json", "utf8")) as Rules;
const continuousRules: Rules = { ...rules, themeScoringMode: "continuous" };

function themeInput(overrides: Partial<ThemeScoreInput> = {}): ThemeScoreInput {
  return {
    rank: 1,
    totalThemes: 14,
    leaderMa5AboveRatio: 0,
    leaderMa25AboveRatio: 0,
    return5d: -rules.themeMomentum5dRange,
    return20d: -rules.themeMomentum20dRange,
    percentile5d: 0,
    percentile20d: 0,
    ...overrides
  };
}

// ---- percentileOf ----

test("percentileOf maps sorted position to 0..1", () => {
  const values = [-0.05, -0.01, 0.02, 0.04];
  assert.equal(percentileOf(0.04, values), 1);
  assert.equal(percentileOf(-0.05, values), 0);
  assert.equal(percentileOf(0.02, values), 2 / 3);
});

test("percentileOf treats ties symmetrically", () => {
  // 全同値なら全テーマ0.5
  assert.equal(percentileOf(0.01, [0.01, 0.01, 0.01]), 0.5);
  // 部分タイ: [1,2,2,3] の 2 は below=1, ties(自分除く)=1 → (1+0.5)/3
  assert.equal(percentileOf(2, [1, 2, 2, 3]), 1.5 / 3);
});

test("percentileOf guards single-element universe", () => {
  assert.equal(percentileOf(0.03, [0.03]), 1);
});

// ---- scoreThemeContinuous ----

test("continuous score reaches 100 when every component saturates", () => {
  const score = scoreThemeContinuous(
    themeInput({
      percentile5d: 1,
      percentile20d: 1,
      leaderMa5AboveRatio: 1,
      leaderMa25AboveRatio: 1,
      return5d: rules.themeMomentum5dRange,
      return20d: rules.themeMomentum20dRange
    }),
    continuousRules
  );

  assert.equal(score, 100);
});

test("continuous score is 0 when every component bottoms out", () => {
  assert.equal(scoreThemeContinuous(themeInput(), continuousRules), 0);
});

test("flat returns yield exactly half of the momentum weight", () => {
  // 騰落率0%はmomentum01=0.5 → 20点×0.5=10点。他成分は0
  const score = scoreThemeContinuous(themeInput({ return5d: 0, return20d: 0 }), continuousRules);
  assert.equal(score, 10);
});

test("momentum clamps at the configured range", () => {
  const atRange = scoreThemeContinuous(themeInput({ return5d: rules.themeMomentum5dRange }), continuousRules);
  const beyondRange = scoreThemeContinuous(themeInput({ return5d: rules.themeMomentum5dRange * 3 }), continuousRules);

  // mom5=1 → 20×0.6=12点(20日側は最低のまま)
  assert.equal(atRange, 12);
  assert.equal(beyondRange, atRange);
});

test("relative strength blends 5d and 20d percentiles by themeMomentumBlend5d", () => {
  // percentile5d=1, percentile20d=0 → 30×0.6=18点
  assert.equal(scoreThemeContinuous(themeInput({ percentile5d: 1 }), continuousRules), 18);
  // percentile5d=0, percentile20d=1 → 30×0.4=12点
  assert.equal(scoreThemeContinuous(themeInput({ percentile20d: 1 }), continuousRules), 12);
});

test("leader ratios contribute proportionally", () => {
  // 30×0.5 + 20×0.25 = 20点
  const score = scoreThemeContinuous(
    themeInput({ leaderMa5AboveRatio: 0.5, leaderMa25AboveRatio: 0.25 }),
    continuousRules
  );
  assert.equal(score, 20);
});

test("continuous score is a rounded integer", () => {
  // 30×0.5(percentile両方0.5) + 20×0.375 = 15+7.5 = 22.5 → 23
  const score = scoreThemeContinuous(
    themeInput({ percentile5d: 0.5, percentile20d: 0.5, leaderMa25AboveRatio: 0.375 }),
    continuousRules
  );
  assert.equal(score, 23);
  assert.ok(Number.isInteger(score));
});

// ---- themeScoreComponentsOf ----

test("score components are null in binary mode and sum to the score in continuous mode", () => {
  const input = themeInput({
    percentile5d: 0.8,
    percentile20d: 0.3,
    leaderMa5AboveRatio: 2 / 3,
    leaderMa25AboveRatio: 1 / 3,
    return5d: 0.02,
    return20d: -0.03
  });

  assert.equal(themeScoreComponentsOf(input, rules), null);

  const components = themeScoreComponentsOf(input, continuousRules);
  assert.ok(components !== null);
  const sum = components.relativeStrength + components.leaderMa5 + components.leaderMa25 + components.momentum;
  // 成分は小数1桁丸め(誤差≤0.2)、スコアは整数丸め(誤差≤0.5)
  assert.ok(Math.abs(sum - scoreThemeContinuous(input, continuousRules)) <= 0.7);
});

// ---- binary回帰 ----

test("scoreTheme in binary mode keeps the legacy 4-condition semantics", () => {
  const strongInput = themeInput({
    rank: 1,
    leaderMa5AboveRatio: 1,
    leaderMa25AboveRatio: 1,
    return5d: 0.001
  });
  // 30+30+20+20。新フィールド(percentile等)は無視される
  assert.equal(scoreTheme(strongInput, rules), 100);
  assert.equal(scoreTheme({ ...strongInput, percentile5d: 0, percentile20d: 0 }, rules), 100);

  // rank6/14はceil(14×0.3)=5位以内に入らない。維持率0.49は0.5未満。return5d=0はプラスでない
  assert.equal(
    scoreTheme(
      themeInput({ rank: 6, leaderMa5AboveRatio: 0.49, leaderMa25AboveRatio: 1, return5d: 0 }),
      rules
    ),
    20
  );
});

test("scoreTheme dispatches on themeScoringMode", () => {
  const input = themeInput({ rank: 1, return5d: 0.001 });
  // binary: rank30 + return5dプラス20 = 50 / continuous: 全成分ほぼ最低(momentumのみ僅か)
  assert.equal(scoreTheme(input, rules), 50);
  assert.ok(scoreTheme(input, continuousRules) < 15);
});
