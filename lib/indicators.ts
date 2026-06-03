import { Trend } from "./types";

export function movingAverageAt(values: number[], endIndex: number, window: number): number | null {
  const startIndex = endIndex - window + 1;
  if (startIndex < 0 || window <= 0) {
    return null;
  }

  let total = 0;
  for (let index = startIndex; index <= endIndex; index += 1) {
    total += values[index];
  }

  return total / window;
}

export function rateOfChangeAt(values: number[], endIndex: number, days: number): number | null {
  const startIndex = endIndex - days;
  if (startIndex < 0) {
    return null;
  }

  const start = values[startIndex];
  const end = values[endIndex];
  if (start === 0) {
    return null;
  }

  return (end - start) / start;
}

export function trendFrom(current: number | null, previous: number | null, toleranceRatio: number): Trend {
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous)) {
    return "unknown";
  }

  const tolerance = Math.abs(previous) * toleranceRatio;
  const delta = current - previous;

  if (Math.abs(delta) <= tolerance) {
    return "flat";
  }

  return delta > 0 ? "up" : "down";
}

export function deviation(value: number | null, basis: number | null): number | null {
  if (value === null || basis === null || basis === 0) {
    return null;
  }

  return (value - basis) / basis;
}

export function max(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((currentMax, value) => Math.max(currentMax, value), values[0]);
}
