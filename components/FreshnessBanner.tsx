"use client";

import { useEffect, useState } from "react";
import { confirmedCloseWarning, snapshotLagWarning } from "../lib/freshness";
import { formatPricesAsOf } from "../lib/format";

interface FreshnessBannerProps {
  pricesAsOf: string | null;
  latestSnapshotDate: string | null;
  /** evaluation.candidates[0]?.date ?? null(評価に使った最新価格バーの日付) */
  dataDate: string | null;
}

/**
 * W1(確定前データ・赤)はクライアント時刻依存のためマウント後にのみ判定・描画する(hydration対策)。
 * タブを開きっぱなしで16:40を跨ぐケースに備えて60秒間隔で再評価する。
 * W2(履歴保存停止・黄)はビルド時に確定する入力のみから決まるため、マウント前から描画してよい。
 */
export function FreshnessBanner({ pricesAsOf, latestSnapshotDate, dataDate }: FreshnessBannerProps) {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const w1 = nowMs === null ? null : confirmedCloseWarning(pricesAsOf, nowMs);
  const w2 = snapshotLagWarning(latestSnapshotDate, dataDate);

  if (w1 === null && w2 === null) {
    return null;
  }

  return (
    <div>
      {w1 !== null && (
        <div className="freshness-banner danger" role="alert">
          ⚠ 表示中の判定は確定日足ではありません（終値基準: {formatPricesAsOf(w1.pricesAsOf)}）。
          16:30の自動更新が未反映か失敗しています。反映されるまでこの画面で翌朝の注文を組まないでください（時間をおいて再読み込み）。
        </div>
      )}
      {w2 !== null && (
        <div className="freshness-banner warning" role="status">
          ⚠ シグナル履歴の保存が止まっています（最終スナップショット: {w2.latestSnapshotDate ?? "なし"}）。
          当日の判定には影響しませんが、月次レビュー用の履歴が欠けていきます。GitHub Actionsの実行ログを確認してください。
        </div>
      )}
    </div>
  );
}
