interface ScoreBadgeProps {
  score: number;
}

export function ScoreBadge({ score }: ScoreBadgeProps) {
  const tone = score >= 80 ? "high" : score >= 60 ? "mid" : "neutral";
  return <span className={`badge ${tone}`}>{score}</span>;
}
