import { PositionTag } from '@/components/PositionTag';
import type { DraftProvider, Player, Position, PositionNeed, Recommendation } from '@fantasy-draft/shared';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import * as React from 'react';

import type { AssistantDraftMode, UpcomingTeamPicks } from './assistant-context';
import { countTeamsNeeding } from './assistant-context';
import { survivalPercent } from './assistant-analysis';

/** Ordered, local, draft-specific queue. Each player shows the chance of reaching the next pick. */
export function AssistantQueue({
  queuedPlayerIds,
  playerById,
  recommendationById,
  bestPick,
  nextPickLabel,
  mode,
  provider,
  onMove,
  onRemove,
  onSelect,
}: {
  readonly queuedPlayerIds: readonly string[];
  readonly playerById: ReadonlyMap<string, Player>;
  readonly recommendationById: ReadonlyMap<string, Recommendation>;
  readonly bestPick: Recommendation | null;
  readonly nextPickLabel: string | null;
  readonly mode: AssistantDraftMode;
  readonly provider: DraftProvider | null;
  readonly onMove: (playerId: string, offset: number) => void;
  readonly onRemove: (playerId: string) => void;
  readonly onSelect: (playerId: string) => void;
}): React.ReactElement {
  const firstDiffers = bestPick !== null && queuedPlayerIds.length > 0 && queuedPlayerIds[0] !== bestPick.playerId;

  return (
    <section className="rec-rail-section" aria-labelledby="rec-queue-heading">
      <div className="rec-section-heading">
        <h2 id="rec-queue-heading">Your queue</h2>
        <span className="rec-muted">{String(queuedPlayerIds.length)} {queuedPlayerIds.length === 1 ? 'player' : 'players'}</span>
      </div>
      {firstDiffers ? (
        <p className="rec-rail-note">Your first queued player differs from the Best Pick, <strong className="rec-accent">{bestPick.playerName}</strong>.</p>
      ) : null}
      {queuedPlayerIds.length === 0 ? (
        <p className="rec-rail-note">Add players you would take at your next pick.</p>
      ) : (
        <ol className="rec-queue">
          {queuedPlayerIds.map((playerId, index) => {
            const player = playerById.get(playerId);
            const recommendation = recommendationById.get(playerId);
            const survival = recommendation ? survivalPercent(recommendation) : null;
            const name = player?.name ?? recommendation?.playerName ?? 'Unknown player';
            return (
              <li key={playerId}>
                <span className="rec-queue-index">{String(index + 1)}</span>
                <button type="button" className="rec-queue-identity" onClick={() => { onSelect(playerId); }}>
                  <strong>{name}</strong>
                  <span className="rec-meta">
                    {player ? <PositionTag position={player.position} /> : null}
                    <span className={survival !== null && survival < 35 ? 'rec-attention' : undefined}>
                      {survival === null
                        ? 'Timing unavailable'
                        : `${String(survival)}% at ${nextPickLabel ?? 'next pick'}`}
                    </span>
                  </span>
                </button>
                <span className="rec-queue-actions">
                  <button type="button" className="rec-icon-button" aria-label={`Move ${name} up in queue`} disabled={index === 0} onClick={() => { onMove(playerId, -1); }}><ChevronUp aria-hidden="true" /></button>
                  <button type="button" className="rec-icon-button" aria-label={`Move ${name} down in queue`} disabled={index === queuedPlayerIds.length - 1} onClick={() => { onMove(playerId, 1); }}><ChevronDown aria-hidden="true" /></button>
                  <button type="button" className="rec-icon-button" aria-label={`Remove ${name} from queue`} onClick={() => { onRemove(playerId); }}><X aria-hidden="true" /></button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="rec-muted rec-rail-help">
        {mode === 'companion' || mode === 'manual-continuity'
          ? `Local to this assistant.${provider === 'sleeper' ? ' Sleeper autopick uses your Sleeper queue.' : ''} Queuing does not change recommendations.`
          : 'Local queue. Queuing does not change recommendations.'}
      </p>
    </section>
  );
}

/** Teams picking before the manager's next turn, with their open starter positions. Context, not a prediction. */
export function UpcomingPicks({
  teams,
  pickCount,
  nextPickLabel,
  viewedPosition,
}: {
  readonly teams: readonly UpcomingTeamPicks[];
  readonly pickCount: number;
  readonly nextPickLabel: string | null;
  readonly viewedPosition: Position | null;
}): React.ReactElement | null {
  if (teams.length === 0) return null;
  const needing = viewedPosition ? countTeamsNeeding(teams, viewedPosition) : 0;

  return (
    <section className="rec-rail-section" aria-labelledby="rec-upcoming-heading">
      <div className="rec-section-heading">
        <h2 id="rec-upcoming-heading">Before your next pick</h2>
        <span className="rec-muted">{String(pickCount)} {pickCount === 1 ? 'pick' : 'picks'}</span>
      </div>
      <ul className="rec-upcoming">
        {teams.map((team) => (
          <li key={team.teamIndex}>
            <span className="rec-upcoming-team">{team.teamName}</span>
            <span className="rec-muted">{team.pickLabels.join(' · ')}</span>
            <span className="rec-need-tags" aria-label={team.openStarters.length > 0 ? `Open starters: ${team.openStarters.join(', ')}` : 'Starters filled'}>
              {team.openStarters.length > 0
                ? team.openStarters.map((position) => <PositionTag key={position} position={position} />)
                : <span className="rec-muted">Filled</span>}
            </span>
          </li>
        ))}
      </ul>
      {viewedPosition ? (
        <p className="rec-rail-note">
          {needing > 0
            ? `${viewedPosition} is open for ${String(needing)} of ${String(teams.length)} teams before ${nextPickLabel ?? 'your next pick'}.`
            : `No team before ${nextPickLabel ?? 'your next pick'} has an open ${viewedPosition} starter slot.`}
        </p>
      ) : null}
      <p className="rec-muted rec-rail-help">Roster context from recorded picks. Not an input to Return Probability.</p>
    </section>
  );
}

/** Starter slots by position, from the same team needs used by the recommendation policy. */
export function AssistantRoster({
  needs,
  rosterNames,
  rosterSize,
  totalRounds,
}: {
  readonly needs: readonly PositionNeed[];
  readonly rosterNames: Readonly<Partial<Record<Position, readonly string[]>>>;
  readonly rosterSize: number;
  readonly totalRounds: number;
}): React.ReactElement {
  return (
    <section className="rec-rail-section" aria-labelledby="rec-roster-heading">
      <div className="rec-section-heading">
        <h2 id="rec-roster-heading">Your roster</h2>
        <span className="rec-muted">{String(rosterSize)} / {String(totalRounds)}</span>
      </div>
      <ul className="rec-roster">
        {needs.map((need) => {
          const names = rosterNames[need.position] ?? [];
          const open = Math.max(0, need.startersNeeded - need.startersFilled);
          return (
            <li key={need.position}>
              <PositionTag position={need.position} />
              <span className="min-w-0">
                {names.length > 0 ? names.join(', ') : open > 1 ? `${String(open)} starters open` : open === 1 ? 'Starter open' : 'No starter slot'}
                {names.length > 0 && open > 0 ? <span className="rec-muted"> · {String(open)} open</span> : null}
              </span>
              <span className="rec-muted">{String(need.startersFilled)} / {String(need.startersNeeded)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
