import { PositionTag } from '@/components/PositionTag';
import { Button } from '@/components/ui/button';
import { describeMissingAvailability, formatAvailabilityPercent, type NextPickAvailability } from '@/lib/next-pick-availability';
import { Check, Plus } from 'lucide-react';
import * as React from 'react';
import type { DraftActionStatus } from '@/hooks/useDraftPlayerAction';
import type { PoolEntry } from './assistant-pool';
import { useAssistantData } from './AssistantDataContext';
import { modelDepth } from './assistant-pool';

/** What the row's primary button does: Draft in a mock on your turn, Record during Manual Continuity, else none. */
export type PoolRowAction = 'draft' | 'record' | null;


/** "Overall rank 14", or why a player has none, for the rank cell's label and title. */
export function describeModelRank(entry: Pick<PoolEntry, 'modelRank' | 'recommendation'>, depth: number): string {
  if (entry.modelRank !== undefined) return `Overall rank ${String(entry.modelRank)}`;
  return entry.recommendation ? `Not in the top ${String(depth)} overall` : `Not in the top ${String(depth)} overall. Limited analysis`;
}

/** Column headings for the best-available rows; values align under them. */
export function CandidateRowHeader({ nextPickLabel }: { readonly nextPickLabel: string | null }): React.ReactElement {
  return (
    <div className="rec-candidate-head" aria-hidden="true">
      <span title="Overall rank for this pick">Rank</span>
      <span>Player</span>
      <span title={nextPickLabel ? `Chance he's still there at ${nextPickLabel}` : 'No later pick'}>{nextPickLabel ? `At ${nextPickLabel}` : 'Next pick'}</span>
      <span />
      <span />
    </div>
  );
}

/**
 * One best-available row: rank, name, position and team, the chance he is there at your next pick, then Draft (or
 * Record) and Queue. No prose: the analysis beside the list explains the selected player. The rank is always the
 * player's overall rank for this pick, never the row's place in a searched or filtered list.
 */
export const AssistantRecommendationRow = React.memo(function AssistantRecommendationRow({
  entry,
  availability,
  isSelected,
  selectionLabel = 'Viewing',
  action,
  status,
  pickInFlight,
  onSelect,
  onAction,
}: {
  readonly entry: PoolEntry;
  readonly availability: NextPickAvailability;
  readonly isSelected: boolean;
  readonly selectionLabel?: 'Viewing' | 'Comparing';
  readonly action: PoolRowAction;
  /** This row's Draft while it saves or after it failed (with the failure's message); undefined otherwise. */
  readonly status: DraftActionStatus | undefined;
  readonly pickInFlight: boolean;
  readonly onSelect: (playerId: string) => void;
  readonly onAction: (playerId: string, action: Exclude<PoolRowAction, null>) => void;
}): React.ReactElement {
  // Page-wide facts (model depth, Best Pick, queue, alerts) come from the page's one data context.
  const { overall, bestPickId, queuedSet, alertsById, onQueue } = useAssistantData();
  const depth = modelDepth(overall);
  const isBestPick = entry.playerId === bestPickId;
  const isQueued = queuedSet.has(entry.playerId);
  const alert = alertsById.get(entry.playerId)?.[0];
  const state = status?.state;
  const errorMessage = status?.state === 'failed' ? status.message : undefined;
  const missing = describeMissingAvailability(availability);
  const rankLabel = describeModelRank(entry, depth);
  const limited = entry.modelRank === undefined;
  const name = entry.playerName;
  const errorId = `pool-${entry.playerId}-error`;
  return (
    <div data-player-row="" data-pool-player={entry.playerId}>
      <div className={isSelected ? 'rec-candidate rec-candidate-selected' : 'rec-candidate'}>
        <span className="rec-candidate-rank" title={rankLabel}>
          <span aria-hidden="true">{entry.modelRank === undefined ? '—' : String(entry.modelRank)}</span>
          <span className="sr-only">{rankLabel}</span>
        </span>
        <button
          type="button"
          data-pool-select=""
          onClick={() => { onSelect(entry.playerId); }}
          aria-pressed={isSelected}
          className="rec-candidate-identity"
        >
          <span className="rec-candidate-name" title={name}>{name}</span>
          <span className="rec-meta">
            <PositionTag position={entry.position} />
            <span>{entry.team}</span>
            {isBestPick ? <span className="rec-accent">Best Pick</span> : null}
            {limited ? (
              <span className="rec-limited" title={entry.recommendation ? 'Ranked only within his position for this pick.' : 'No model estimate for this player; draft and queue still work.'}>
                {entry.recommendation ? `Outside top ${String(depth)}` : 'Limited analysis'}
              </span>
            ) : null}
            {isSelected ? <span className="rec-viewing">{selectionLabel}</span> : null}
            {alert ? <span className="rec-alert">{alert}</span> : null}
          </span>
        </button>
        <span className="rec-candidate-value" title={missing ?? undefined}>
          {missing ? <span className="rec-unknown rec-unknown-label">{missing}</span> : formatAvailabilityPercent(availability)}
        </span>
        <span className="rec-candidate-action" data-pool-action={entry.playerId}>
          {action === 'draft' ? (
            // Outlined: the leader's card holds the page's one filled Draft, so a list of rows is not a wall of them.
            <Button size="sm" variant={state === 'failed' ? 'destructive' : 'outline'} disabled={pickInFlight}
              aria-busy={state === 'pending' || undefined} aria-describedby={state === 'failed' ? errorId : undefined}
              aria-label={state === 'failed' ? `Retry drafting ${name}` : `Draft ${name}`}
              onClick={() => { onAction(entry.playerId, 'draft'); }}>
              {state === 'pending' ? 'Saving…' : state === 'failed' ? 'Retry' : 'Draft'}
            </Button>
          ) : action === 'record' ? (
            <Button size="sm" variant="outline" disabled={pickInFlight} aria-label={`Record ${name} as a provisional pick`} onClick={() => { onAction(entry.playerId, 'record'); }}>
              Record
            </Button>
          ) : null}
        </span>
        <button
          type="button"
          className="rec-icon-button rec-queue-toggle"
          data-pool-queue=""
          aria-pressed={isQueued}
          aria-label={`${isQueued ? 'Remove' : 'Add'} ${name} ${isQueued ? 'from' : 'to'} queue`}
          onClick={() => { onQueue(entry.playerId); }}
        >
          {isQueued ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
        </button>
      </div>
      {errorMessage ? <p id={errorId} role="alert" className="rec-candidate-error">{errorMessage}</p> : null}
    </div>
  );
});
