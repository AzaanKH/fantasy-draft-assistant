import { useDraftState } from '@/workspace/WorkspaceProvider';
import { useDraftView } from '@/workspace/useDraftView';
import { POSITIONS, type Player } from '@fantasy-draft/shared/league';
import { type PositionNeed } from '@fantasy-draft/shared/draft';
import * as React from 'react';
import { Shirt } from 'lucide-react';
import { HERO_CARD, PANEL_CARD, PANEL_LABEL } from './SidePanelFrame';
import { getNeedLabel, getNeedDescription } from './sidepanel-insights';

export function RosterPressure({ needs }: { readonly needs: readonly PositionNeed[] }): React.ReactElement {
  const rankedNeeds = [...needs]
    .sort((left, right) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3, defer: 4, filled: 5 } as const;
      return order[left.priority] - order[right.priority];
    })
    .slice(0, 3);

  return (
    <section className={PANEL_CARD}>
      <div className={PANEL_LABEL}>
        Roster pressure
      </div>
      <div className="mt-3 grid grid-cols-3 divide-x divide-border">
        {rankedNeeds.map((need) => (
          <div key={need.position} className="px-2 text-center">
            <div className="position-text text-xs font-bold" data-position={need.position}>
              {need.position} {getNeedLabel(need)}
            </div>
            <div className="mt-1 text-2xs text-muted-foreground">{getNeedDescription(need)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
export function RosterPanel({
  playerById,
  needs,
}: {
  readonly playerById: ReadonlyMap<string, Player>;
  readonly needs: readonly PositionNeed[];
}): React.ReactElement {
  const roster = useDraftView((view) => view.myRoster);
  const config = useDraftState((state) => state.config);

  return (
    <>
      <section className={HERO_CARD}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold">My roster</h2>
            <p className="mt-1 text-xs text-muted-foreground">Draft slot {String(config.myPickPosition)}</p>
          </div>
          <Shirt className="size-5 text-success" />
        </div>
        <div className="mt-4 space-y-2">
          {POSITIONS.map((position) => {
            const playerIds = roster[position];
            return (
              <div key={position} className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border/70 px-3 py-2.5">
                <span className="position-text font-mono text-xs font-bold" data-position={position}>{position}</span>
                <span className="min-w-0 text-xs text-muted-foreground">
                  {playerIds.length === 0
                    ? 'Open'
                    : playerIds.map((playerId) => playerById.get(playerId)?.name ?? 'Unknown').join(', ')}
                </span>
                <span className="font-mono text-2xs text-muted-foreground">{String(playerIds.length)} / {String(config.rosterRequirements[position].max)}</span>
              </div>
            );
          })}
        </div>
      </section>
      <RosterPressure needs={needs} />
    </>
  );
}
