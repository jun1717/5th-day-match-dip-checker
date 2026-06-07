import { BollingerLine } from "./types";
import { movingAverageAt } from "./indicators";

export interface BollingerBands {
  ma: number | null;
  stdDev: number | null;
  upper1: number | null;
  upper2: number | null;
  lower1: number | null;
  lower2: number | null;
}

export function standardDeviationAt(values: number[], endIndex: number, window: number): number | null {
  const startIndex = endIndex - window + 1;
  if (startIndex < 0 || window <= 0) {
    return null;
  }

  let total = 0;
  for (let index = startIndex; index <= endIndex; index += 1) {
    total += values[index];
  }
  const mean = total / window;

  let squaredDiffTotal = 0;
  for (let index = startIndex; index <= endIndex; index += 1) {
    squaredDiffTotal += (values[index] - mean) ** 2;
  }

  return Math.sqrt(squaredDiffTotal / window);
}

export function bollingerBandsAt(values: number[], endIndex: number, window: number): BollingerBands {
  const ma = movingAverageAt(values, endIndex, window);
  const stdDev = standardDeviationAt(values, endIndex, window);

  if (ma === null || stdDev === null) {
    return { ma: null, stdDev: null, upper1: null, upper2: null, lower1: null, lower2: null };
  }

  return {
    ma,
    stdDev,
    upper1: ma + stdDev,
    upper2: ma + 2 * stdDev,
    lower1: ma - stdDev,
    lower2: ma - 2 * stdDev
  };
}

export function bollingerLineValue(bands: BollingerBands, line: BollingerLine): number | null {
  switch (line) {
    case "ma25":
      return bands.ma;
    case "bb_minus_1sigma":
      return bands.lower1;
    case "bb_minus_2sigma":
      return bands.lower2;
    default:
      return null;
  }
}
