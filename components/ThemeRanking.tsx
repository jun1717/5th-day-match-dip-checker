import { themeStatusLabel } from "../lib/format";
import { ThemeScore, ThemeScoreComponents } from "../lib/types";
import { ColoredPercent } from "./ColoredPercent";
import { PriorityBadge } from "./PriorityBadge";
import { ScoreBadge } from "./ScoreBadge";

interface ThemeRankingProps {
  themes: ThemeScore[];
  limit?: number;
  priority?: string;
}

/** 連続スコア(continuousモード)のときだけ内訳ツールチップを出す。旧データはフィールド自体が無いためnull扱い */
function scoreComponentsTitle(components: ThemeScoreComponents | null | undefined): string | undefined {
  if (components == null) {
    return undefined;
  }

  return `スコア内訳: 相対強度 ${components.relativeStrength} / 主役株5日線 ${components.leaderMa5} / 主役株25日線 ${components.leaderMa25} / モメンタム ${components.momentum}`;
}

export function ThemeRanking({ themes, limit, priority }: ThemeRankingProps) {
  const filtered = priority ? themes.filter((theme) => theme.priority === priority) : themes;
  const rows = typeof limit === "number" ? filtered.slice(0, limit) : filtered;

  if (rows.length === 0) {
    return <div className="empty">テーマデータがありません</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>投資テーマ</th>
            <th>優先度</th>
            <th className="text-right">5日騰落率平均</th>
            <th className="text-right">20日騰落率平均</th>
            <th className="text-right">テーマ順位</th>
            <th>テーマスコア</th>
            <th className="text-right">主役株5日線維持率</th>
            <th className="text-right">主役株25日線維持率</th>
            <th>状態</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((theme) => (
            <tr key={theme.theme}>
              <td>{theme.theme}</td>
              <td>
                <PriorityBadge priority={theme.priority} scope="theme" />
              </td>
              <td className="text-right"><ColoredPercent value={theme.return5d} digits={2} /></td>
              <td className="text-right"><ColoredPercent value={theme.return20d} digits={2} /></td>
              <td className="text-right">{theme.rank}</td>
              <td title={scoreComponentsTitle(theme.scoreComponents)}>
                <ScoreBadge score={theme.themeScore} />
              </td>
              <td className="text-right"><ColoredPercent value={theme.leaderMa5AboveRatio} digits={0} /></td>
              <td className="text-right"><ColoredPercent value={theme.leaderMa25AboveRatio} digits={0} /></td>
              <td>
                <span className={`badge ${theme.status}`}>{themeStatusLabel(theme.status)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
