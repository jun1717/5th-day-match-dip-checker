import Link from "next/link";
import { CandidateTable } from "../components/CandidateTable";
import { ThemeRanking } from "../components/ThemeRanking";
import { readEvaluation } from "../lib/data";
import { formatPricesAsOf } from "../lib/format";

export default function HomePage() {
  const evaluation = readEvaluation();
  const buyCandidates = evaluation.candidates.filter((candidate) => candidate.status === "buy_candidate");
  const watchCandidates = evaluation.candidates.filter((candidate) => candidate.status === "watch");
  const avoidCandidates = evaluation.candidates.filter((candidate) => candidate.status === "avoid");

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">トップ</h1>
          <p className="page-meta">データ日付: {evaluation.candidates[0]?.date ?? "-"}　終値基準: {formatPricesAsOf(evaluation.pricesAsOf)}</p>
        </div>
        <Link className="link" href="/candidates">
          候補一覧へ
        </Link>
      </div>

      <section className="metrics" aria-label="候補件数">
        <div className="metric">
          <div className="metric-label">今日の買い候補件数</div>
          <div className="metric-value">{buyCandidates.length}</div>
        </div>
        <div className="metric">
          <div className="metric-label">監視候補件数</div>
          <div className="metric-value">{watchCandidates.length}</div>
        </div>
        <div className="metric">
          <div className="metric-label">見送り件数</div>
          <div className="metric-value">{avoidCandidates.length}</div>
        </div>
      </section>

      <div className="grid" style={{ marginTop: 16 }}>
        <section className="surface">
          <div className="surface-header">
            <h2 className="surface-title">Aテーマランキング</h2>
            <Link className="link" href="/themes">
              全件
            </Link>
          </div>
          <ThemeRanking themes={evaluation.themeScores} priority="A" limit={5} />
        </section>

        <section className="surface">
          <div className="surface-header">
            <h2 className="surface-title">Bテーマランキング</h2>
            <Link className="link" href="/themes">
              全件
            </Link>
          </div>
          <ThemeRanking themes={evaluation.themeScores} priority="B" limit={5} />
        </section>

        <section className="surface">
          <div className="surface-header">
            <h2 className="surface-title">買い候補一覧</h2>
          </div>
          <CandidateTable candidates={buyCandidates} maxLossYen={evaluation.rules.maxLossYen} defaultShowAvoid />
        </section>
      </div>
    </main>
  );
}
