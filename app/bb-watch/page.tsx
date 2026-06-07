import { BbWatchTable } from "../../components/BbWatchTable";
import { readBbWatch } from "../../lib/data";

export const metadata = {
  title: "BB押し目一覧 | 5日線押し目チェッカー"
};

export default function BbWatchPage() {
  const rows = readBbWatch();

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">BB押し目一覧</h1>
          <p className="page-meta">監視・分析用ページ（現時点では正式な買い候補ではありません）</p>
        </div>
      </div>

      <section className="surface">
        <div className="surface-body">
          <p>
            BB押し目一覧は、銘柄ごとの過去反発ラインを分析し、現在そのラインに近づいている銘柄を確認するための監視ページです。
            現時点では正式な買い候補ではありません。
          </p>
        </div>
      </section>

      <section className="surface" style={{ marginTop: 16 }}>
        <div className="surface-body">
          <BbWatchTable rows={rows} />
        </div>
      </section>
    </main>
  );
}
