import type { Player, Recommendation } from '@fantasy-draft/shared';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { PositionTag } from '@/components/PositionTag';
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

/** Two narrow player columns beside one label column; fits the analysis panel at every width. */
export function PlayerComparisonMetrics({
  first,
  second,
  preferredPlayerId,
  ranks,
  playerById,
}: {
  readonly first: Recommendation;
  readonly second: Recommendation;
  readonly preferredPlayerId?: string;
  readonly ranks: ReadonlyMap<string, number>;
  readonly playerById?: ReadonlyMap<string, Player>;
}): React.ReactElement {
  const players = [first, second];
  const rows = getComparisonMetrics(first, second, ranks);

  return (
    <table className="rec-compare">
      <caption className="sr-only">Compare {first.playerName} and {second.playerName}. Point bars share a zero baseline; availability uses a 0 to 100 percent scale.</caption>
      <thead>
        <tr>
          <th scope="col"><span className="sr-only">Signal</span></th>
          {players.map((player) => (
            <th key={player.playerId} scope="col" data-preferred={player.playerId === preferredPlayerId}>
              <span className="rec-compare-player">
                <PlayerHeadshot playerId={player.playerId} name={player.playerName} position={player.position} className="rec-compare-avatar" />
                <span className="min-w-0">
                  <span className="rec-compare-name">{player.playerName}</span>
                  <span className="rec-meta">
                    <PositionTag position={player.position} />
                    {playerById?.get(player.playerId)?.team ? <span>{playerById.get(player.playerId)?.team}</span> : null}
                  </span>
                </span>
              </span>
              {player.playerId === preferredPlayerId ? <span className="rec-compare-preferred">Preferred</span> : null}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">
              <MetricHelp metric={row.key} label={row.label} className="justify-start text-left" />
            </th>
            {players.map((player, index) => {
              const value = row.values[index] ?? null;
              const bar = row.scale ? comparisonBar(value, row.scale) : null;
              return (
                <td key={player.playerId} data-preferred={player.playerId === preferredPlayerId}>
                  <span className="rec-compare-value" data-unavailable={value === null}>{formatMetric(value, row.format)}</span>
                  {bar ? (
                    <span className="rec-compare-bar" aria-hidden="true">
                      <span className="rec-compare-bar-fill" style={{ left: `${String(bar.left)}%`, width: `${String(bar.width)}%` }} />
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
