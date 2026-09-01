import * as React from 'react';
import type { Position } from '@fantasy-draft/shared';
import { POSITIONS } from '@fantasy-draft/shared';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { Badge } from '@/components/ui/badge';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useDraftStore } from '@/stores/draftStore';

export function DraftRosterPanel(): React.ReactElement {
  const { players } = usePlayerDataQuery();
  const myRoster = useDraftStore((state) => state.myRoster);
  const config = useDraftStore((state) => state.config);
  const playerById = React.useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players]
  );
  const rosterSize = (Object.values(myRoster) as string[][]).reduce(
    (total, playerIds) => total + playerIds.length,
    0
  );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>Draft slot {String(config.myPickPosition)}</span>
        <span className="font-mono">{String(rosterSize)} / {String(config.totalRounds)} players</span>
      </div>
      <div className="grid gap-x-5 gap-y-4 border-y border-border/70 bg-muted/15 px-3 py-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {POSITIONS.map((position: Position) => {
          const playerIds = myRoster[position];
          const starterCount = config.rosterRequirements[position].starters;
          return (
            <section key={position} className="border-l-2 border-border/70 pl-3">
              <div className="mb-2 flex items-center justify-between">
                <Badge variant="outline" className="font-mono text-[10px]">{position}</Badge>
                <span className="text-[10px] text-muted-foreground">
                  {String(playerIds.length)} / {String(config.rosterRequirements[position].max)}
                </span>
              </div>
              <div className="space-y-1.5">
                {playerIds.map((playerId, index) => {
                  const player = playerById.get(playerId);
                  if (!player) return null;
                  return (
                    <div key={playerId} className="flex items-center gap-2 rounded-md bg-muted/35 p-1.5">
                      <PlayerHeadshot
                        playerId={player.id}
                        name={player.name}
                        position={player.position}
                        className="size-7 rounded-full"
                      />
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-semibold">{player.name}</div>
                        <div className="text-[9px] text-muted-foreground">
                          {index < starterCount ? 'Starter' : 'Bench'} · {player.team}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {playerIds.length === 0 ? (
                  <div className="bg-muted/35 px-2 py-3 text-center text-[10px] text-muted-foreground">
                    Empty
                  </div>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
