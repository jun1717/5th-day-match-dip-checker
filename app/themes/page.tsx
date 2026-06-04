import { ThemeRanking } from "../../components/ThemeRanking";
import { readEvaluation } from "../../lib/data";

export default function ThemesPage() {
  const evaluation = readEvaluation();

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">投資テーマランキング</h1>
          <p className="page-meta">Aテーマ/Bテーマを分けてテーマ順位順に表示</p>
        </div>
      </div>

      <div className="grid">
        <section className="surface">
          <div className="surface-header">
            <h2 className="surface-title">Aテーマ：主力監視</h2>
          </div>
          <ThemeRanking themes={evaluation.themeScores} priority="A" />
        </section>

        <section className="surface">
          <div className="surface-header">
            <h2 className="surface-title">Bテーマ：追加監視</h2>
          </div>
          <ThemeRanking themes={evaluation.themeScores} priority="B" />
        </section>
      </div>
    </main>
  );
}
