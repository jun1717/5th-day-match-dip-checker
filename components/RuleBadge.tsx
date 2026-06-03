interface RuleBadgeProps {
  passed: boolean;
}

export function RuleBadge({ passed }: RuleBadgeProps) {
  return <span className={`badge ${passed ? "pass" : "fail"}`}>{passed ? "○" : "×"}</span>;
}
