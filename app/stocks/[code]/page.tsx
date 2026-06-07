import { notFound } from "next/navigation";
import { StockDetail } from "../../../components/StockDetail";
import { findBbWatch, readEvaluation, readPricesForCode, readWatchlist } from "../../../lib/data";

export function generateStaticParams() {
  const watchlist = readWatchlist();
  const codes = [...new Set(watchlist.map((row) => row.code))];
  return codes.map((code) => ({ code }));
}

interface StockPageProps {
  params: Promise<{
    code: string;
  }>;
}

export default async function StockPage({ params }: StockPageProps) {
  const { code } = await params;
  const evaluation = readEvaluation();
  const candidates = evaluation.candidates.filter((item) => item.code === code);
  const primary = candidates[0];

  if (!primary) {
    notFound();
  }

  const prices = readPricesForCode(code);
  const bbWatch = findBbWatch(code);

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {primary.code} {primary.name}
          </h1>
          <p className="page-meta">{candidates.map((candidate) => candidate.theme).join(" / ")}</p>
        </div>
      </div>
      <StockDetail candidates={candidates} prices={prices} bbWatch={bbWatch} />
    </main>
  );
}
