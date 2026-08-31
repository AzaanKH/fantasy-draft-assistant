import * as React from 'react';
import type { Player, Position } from '@fantasy-draft/shared';
import { Star, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDraftStore } from '@/stores/draftStore';
import { cn } from '@/lib/utils';

const positionColors: Record<Position, string> = {
  QB: 'bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/30',
  RB: 'bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30',
  WR: 'bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/30',
  TE: 'bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-500/30',
  K: 'bg-purple-500/20 text-purple-700 dark:text-purple-400 border-purple-500/30',
  DEF: 'bg-gray-500/20 text-gray-700 dark:text-gray-400 border-gray-500/30',
};

export function ShortlistQueue({
  players,
  onDraft,
  canDraft,
}: {
  players: readonly Player[];
  onDraft: (player: Player) => void;
  canDraft: boolean;
}): React.ReactElement {
  const shortlistedPlayerIds = useDraftStore((state) => state.shortlistedPlayerIds);
  const removePlayerFromShortlist = useDraftStore((state) => state.removePlayerFromShortlist);
  const shortlistedPlayers = React.useMemo(() => {
    const playersById = new Map(players.map((player) => [player.id, player]));
    return shortlistedPlayerIds.flatMap((playerId) => {
      const player = playersById.get(playerId);
      return player ? [player] : [];
    });
  }, [players, shortlistedPlayerIds]);

  return (
    <section
      aria-label="Watchlist"
      className="border-b border-border/70 bg-muted/20 px-6 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
        <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Watchlist
        </h3>
        <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px]">
          {shortlistedPlayers.length}
        </Badge>
        <span className="text-xs text-muted-foreground">Draft queue</span>
      </div>

      {shortlistedPlayers.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Watch players to keep your next options close.
        </p>
      ) : (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1" role="list">
          {shortlistedPlayers.map((player, index) => (
            <div
              key={player.id}
              role="listitem"
              className="flex shrink-0 items-center gap-2 rounded-md border border-border/80 bg-card px-2 py-1.5 shadow-xs"
            >
              <span className="w-4 text-center font-mono text-[11px] text-muted-foreground">
                {index + 1}
              </span>
              <Badge
                variant="outline"
                className={cn('h-5 px-1.5 font-mono text-[10px]', positionColors[player.position])}
              >
                {player.position}
              </Badge>
              <span className="text-sm font-medium">{player.name}</span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={!canDraft}
                title={
                  !canDraft
                    ? 'Connect a live draft or start a mock draft to record picks.'
                    : undefined
                }
                onClick={() => {
                  onDraft(player);
                }}
              >
                Draft
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-7 text-muted-foreground"
                aria-label={`Remove ${player.name} from watchlist`}
                onClick={() => {
                  removePlayerFromShortlist(player.id);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
