import type { Recommendation } from '@fantasy-draft/shared';
import { PointBarChart } from '@/components/charts/PointBarChart';
import { getComparisonMetrics } from './comparison-metrics';

export default function PlayerPointCharts({ first, second, preferredPlayerId }: {
  readonly first: Recommendation;
  readonly second: Recommendation;
  readonly preferredPlayerId: string;
}): React.ReactElement {
  return <div className="grid min-w-0 gap-3 xl:grid-cols-2">
    {getComparisonMetrics(first, second, new Map()).filter((row) => row.format === 'points' || row.format === 'signed-points').map((metric) => (
      <PointBarChart key={metric.key} title={metric.label} description={metric.description} rows={[first, second].map((player, index) => ({
        id: player.playerId, name: player.playerName, value: metric.values[index] ?? null, preferred: player.playerId === preferredPlayerId,
      }))} />
    ))}
  </div>;
}
