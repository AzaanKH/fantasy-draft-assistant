import type { Player, Recommendation } from '@fantasy-draft/shared';
import { Check } from 'lucide-react';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { MetricHelp } from '@/features/help/MetricHelp';
import { comparisonBar, getComparisonMetrics, type ComparisonMetric } from './comparison-metrics';

function formatMetric(value: number | null, format: ComparisonMetric['format']): string {
  if (value === null) return 'Unavailable';
  const points = Number(value.toFixed(1));
  if (format === 'signed-points') return `${points >= 0 ? '+' : ''}${String(points)} pts`;
  if (format === 'points') return `${String(points)} pts`;
  if (format === 'percent') return `${String(value)}%`;
  if (format === 'tier') return `Tier ${String(value)}`;
  return `#${String(value)}`;
}

export function PlayerComparisonMetrics({
  first,
  second,
  preferredPlayerId,
  ranks,
  playerById,
  compact = false,
  showPointMetrics = true,
}: {
  readonly first: Recommendation;
  readonly second: Recommendation;
  readonly preferredPlayerId?: string;
  readonly ranks: ReadonlyMap<string, number>;
  readonly playerById?: ReadonlyMap<string, Player>;
  readonly compact?: boolean;
  readonly showPointMetrics?: boolean;
}): React.ReactElement {
  const players = [first, second];
  const rows = getComparisonMetrics(first, second, ranks)
    .filter((metric) => (!compact || !['projectedPoints', 'ecr'].includes(metric.key)) && (showPointMetrics || !['points', 'signed-points'].includes(metric.format)));

  return (
    <table className="player-comparison" data-compact={compact}>
      <caption className="sr-only">Compare {first.playerName} and {second.playerName}. Point bars share a zero baseline; availability uses a 0 to 100 percent scale.</caption>
      <colgroup><col className="comparison-label-column" /><col /><col /></colgroup>
      <thead>
        <tr>
          <th scope="col" className="comparison-signal-heading">Signal</th>
          {players.map((player) => (
            <th key={player.playerId} scope="col" data-preferred={player.playerId === preferredPlayerId}>
              <div className="comparison-player-heading">
                <PlayerHeadshot playerId={player.playerId} name={player.playerName} position={player.position} className="comparison-avatar" />
                <span className="comparison-player-name">{player.playerName}</span>
                <span className="comparison-player-meta">{player.position}{playerById?.get(player.playerId)?.team ? ` · ${playerById.get(player.playerId)?.team}` : ''}</span>
                {player.playerId === preferredPlayerId ? <span className="comparison-preferred"><Check aria-hidden="true" />Preferred</span> : null}
              </div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">
              <MetricHelp metric={row.key} label={row.label} className="justify-start text-left" />
              {!compact ? <span className="comparison-metric-note">{row.description}</span> : null}
            </th>
            {players.map((player, index) => {
              const value = row.values[index] ?? null;
              const bar = row.scale ? comparisonBar(value, row.scale) : null;
              return (
                <td key={player.playerId} data-preferred={player.playerId === preferredPlayerId}>
                  <span className="comparison-value" data-unavailable={value === null}>{formatMetric(value, row.format)}</span>
                  {row.format === 'tier' ? <span className="comparison-player-meta">{player.position}</span> : null}
                  {bar ? (
                    <span className="comparison-bar" aria-hidden="true">
                      <span className="comparison-bar-fill" data-preferred={player.playerId === preferredPlayerId} style={{ left: `${String(bar.left)}%`, width: `${String(bar.width)}%` }} />
                      <span className="comparison-bar-zero" style={{ left: `${String(bar.zero)}%` }} />
                    </span>
                  ) : null}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
