import { type Player } from '@fantasy-draft/shared/league';
import * as React from 'react';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { Button } from '@/components/ui/button';
import { type DraftDecisionView, formatSignedNumber } from '@fantasy-draft/shared/draft';
import { cn } from '@/lib/utils';
import { PANEL_CARD, PANEL_LABEL } from './SidePanelFrame';
import { describeMissingAvailability, formatAvailabilityPercent, getNextPickAvailability } from '@/lib/next-pick-availability';
import { shortPlayerName } from '@/lib/player-name';

export function ComparisonList({
  decision,
  playerById,
  selectedIds,
  onToggle,
  onCompare,
}: {
  readonly decision: DraftDecisionView;
  readonly playerById: ReadonlyMap<string, Player>;
  readonly selectedIds: ReadonlySet<string>;
  readonly onToggle: (playerId: string) => void;
  /** Omitted where the head-to-head is already showing the selection. */
  readonly onCompare?: () => void;
}): React.ReactElement {
  const recommendations = decision.recommendations;
  const nextPickLabel = recommendations[0]?.diagnostics?.nextPickLabel;
  return (
    <section className={PANEL_CARD}>
      <div className={PANEL_LABEL}>
        Compare available
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_48px_40px_62px] px-2 text-2xs font-bold uppercase tracking-wide text-muted-foreground">
        <span>Player</span><span>Over fill-in</span><span>Tier</span><span>{nextPickLabel ? `Pick ${nextPickLabel}` : 'Next pick'}</span>
      </div>
      <div className="mt-1.5 space-y-1.5">
        {recommendations.slice(0, 3).map((recommendation) => {
          const player = playerById.get(recommendation.playerId);
          const isSelected = selectedIds.has(recommendation.playerId);
          const diagnostics = recommendation.diagnostics;
          const availability = getNextPickAvailability(diagnostics);
          const missingAvailability = describeMissingAvailability(availability);
          const rank = decision.rankByPlayerId.get(recommendation.playerId);
          return (
            <button
              key={recommendation.playerId}
              type="button"
              aria-pressed={isSelected}
              onClick={() => { onToggle(recommendation.playerId); }}
              className={cn(
                'grid w-full grid-cols-[minmax(0,1fr)_48px_40px_62px] items-center rounded-lg border px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isSelected ? 'border-success/70 bg-success/[0.06]' : 'border-border/70 hover:bg-muted/35'
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full border',
                  isSelected ? 'border-success' : 'border-muted-foreground'
                )}>
                  {isSelected ? <span className="size-2 rounded-full bg-success" /> : null}
                </span>
                <PlayerHeadshot
                  playerId={recommendation.playerId}
                  name={recommendation.playerName}
                  position={recommendation.position}
                  className="size-9 rounded-lg"
                />
                <span className="min-w-0">
                  {/* "C. McCaffrey" fits the narrow panel; screen readers and the title keep the full name. */}
                  <span className="block truncate text-2xs font-bold" title={recommendation.playerName}>
                    <span aria-hidden="true">{shortPlayerName(recommendation.playerName, recommendation.position, player?.team)}</span>
                    <span className="sr-only">{recommendation.playerName}</span>
                  </span>
                  <span className="position-text mt-0.5 block font-mono text-2xs" data-position={recommendation.position}>
                    #{String(rank ?? '—')} · {recommendation.position}{player?.team ? ` · ${player.team}` : ''}
                  </span>
                </span>
              </span>
              <span className="font-mono text-2xs font-bold text-success">
                {diagnostics ? formatSignedNumber(diagnostics.valueOverReplacement, 0) : '—'}
              </span>
              <span className="font-mono text-2xs">T{String(diagnostics?.tier ?? '—')}</span>
              {missingAvailability === null
                ? <span className="text-right font-mono text-2xs">{formatAvailabilityPercent(availability)}</span>
                : <span className="text-right text-2xs leading-tight text-muted-foreground">{missingAvailability}</span>}
            </button>
          );
        })}
      </div>
      {onCompare ? (
        <Button className="mt-3 w-full" disabled={selectedIds.size !== 2} onClick={onCompare}>
          Compare {String(selectedIds.size)} players
        </Button>
      ) : null}
    </section>
  );
}
