"use client";

import { ColorType, IChartApi, LineStyle, createChart } from "lightweight-charts";
import { useEffect, useRef } from "react";
import { PriceRow } from "../lib/types";

interface CandleChartProps {
  prices: PriceRow[];
  entryPrice: number | null;
  entryUpperPrice: number | null;
  stopLoss: number | null;
}

function calcMA(prices: PriceRow[], period: number): { time: string; value: number }[] {
  const result: { time: string; value: number }[] = [];
  for (let i = period - 1; i < prices.length; i++) {
    const sum = prices.slice(i - period + 1, i + 1).reduce((acc, p) => acc + p.close, 0);
    result.push({ time: prices[i].date, value: sum / period });
  }
  return result;
}

export function CandleChart({ prices, entryPrice, entryUpperPrice, stopLoss }: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || prices.length === 0) return;

    const container = containerRef.current;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#66706a"
      },
      grid: {
        vertLines: { color: "#dce2de" },
        horzLines: { color: "#dce2de" }
      },
      rightPriceScale: { borderColor: "#dce2de" },
      timeScale: { borderColor: "#dce2de", timeVisible: true },
      width: container.clientWidth,
      height: 340
    });
    chartRef.current = chart;

    // ローソク足
    const candleSeries = chart.addCandlestickSeries({
      upColor: "#137a4f",
      downColor: "#b42318",
      borderUpColor: "#137a4f",
      borderDownColor: "#b42318",
      wickUpColor: "#137a4f",
      wickDownColor: "#b42318"
    });

    const displayPrices = prices.slice(-90);
    const firstDate = displayPrices[0]?.date ?? "";

    candleSeries.setData(
      displayPrices.map((p) => ({
        time: p.date as never,
        open: p.open,
        high: p.high,
        low: p.low,
        close: p.close
      }))
    );

    // MA5（青）
    const allMa5 = calcMA(prices, 5);
    const ma5Series = chart.addLineSeries({ color: "#1d5d90", lineWidth: 1, title: "MA5" });
    ma5Series.setData(allMa5.filter((d) => d.time >= firstDate).map((d) => ({ ...d, time: d.time as never })));

    // MA25（オレンジ）
    const allMa25 = calcMA(prices, 25);
    const ma25Series = chart.addLineSeries({ color: "#8a6400", lineWidth: 1, title: "MA25" });
    ma25Series.setData(allMa25.filter((d) => d.time >= firstDate).map((d) => ({ ...d, time: d.time as never })));

    // 価格ライン
    if (entryPrice !== null) {
      candleSeries.createPriceLine({
        price: entryPrice,
        color: "#137a4f",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: "買い基準"
      });
    }

    if (entryUpperPrice !== null) {
      candleSeries.createPriceLine({
        price: entryUpperPrice,
        color: "#137a4f",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        title: "買い上限"
      });
    }

    if (stopLoss !== null) {
      candleSeries.createPriceLine({
        price: stopLoss,
        color: "#b42318",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: "損切り"
      });
    }

    chart.timeScale().fitContent();

    const observer = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [prices, entryPrice, entryUpperPrice, stopLoss]);

  if (prices.length === 0) {
    return <div className="empty">価格データがありません</div>;
  }

  return (
    <div>
      <div ref={containerRef} style={{ width: "100%", height: 340 }} />
      <div className="chart-legend">
        <span style={{ color: "#1d5d90" }}>─ MA5</span>
        <span style={{ color: "#8a6400" }}>─ MA25</span>
        <span style={{ color: "#137a4f" }}>╌ 買い基準 / 買い上限</span>
        <span style={{ color: "#b42318" }}>╌ 損切り</span>
      </div>
    </div>
  );
}
