import { CandidateTable } from "../../components/CandidateTable";
import { MarketSummaryLine } from "../../components/MarketBadge";
import { readEvaluation } from "../../lib/data";

export default function CandidatesPage() {
  const evaluation = readEvaluation();

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">候補一覧</h1>
          <p className="page-meta">買い候補を最上位に表示</p>
          <MarketSummaryLine market={evaluation.market} marketIndexCode={evaluation.rules.marketIndexCode} />
        </div>
      </div>

      <section className="surface">
        <div className="surface-body">
          <CandidateTable candidates={evaluation.candidates} maxLossYen={evaluation.rules.maxLossYen} />
        </div>
      </section>
    </main>
  );
}
