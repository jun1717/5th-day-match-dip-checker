import { CSSProperties } from "react";
import { formatPercent } from "../lib/format";

interface ColoredPercentProps {
  value: number | null | undefined;
  digits?: number;
}

export function ColoredPercent({ value, digits = 1 }: ColoredPercentProps) {
  return <span style={percentStyle(value)}>{formatPercent(value, digits)}</span>;
}

function percentStyle(value: number | null | undefined): CSSProperties {
  if (value === null || value === undefined || !Number.isFinite(value)) return {};
  const abs = Math.abs(value);
  if (abs < 0.005) return {};

  if (value > 0) {
    if (abs >= 0.10) return { color: "#7a0f0f", fontWeight: "bold" };
    if (abs >= 0.05) return { color: "#b42318" };
    return { color: "#c9544a" };
  } else {
    if (abs >= 0.10) return { color: "#0c3558" };
    if (abs >= 0.05) return { color: "#1d5d90" };
    return { color: "#4a7ea8" };
  }
}
