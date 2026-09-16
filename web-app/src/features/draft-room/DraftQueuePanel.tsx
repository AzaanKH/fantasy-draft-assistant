import * as React from 'react';
import { GripVertical, Trash2 } from 'lucide-react';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { MotionReorderItem } from '@/components/motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDraftPlayerAction } from '@/hooks/useDraftPlayerAction';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useQueueActions } from '@/hooks/useQueueActions';
import { useDraftStore } from '@/stores/draftStore';

export function DraftQueuePanel(): React.ReactElement {
  const { players } = usePlayerDataQuery();
  const queuedPlayerIds = useDraftStore((state) => state.shortlistedPlayerIds);
  const { removePlayerFromQueue } = useQueueActions(players);
  const { canDraft, draftPlayer } = useDraftPlayerAction();
  const playerById = React.useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players]
  );
  const queuedPlayers = queuedPlayerIds.flatMap((playerId) => {
    const player = playerById.get(playerId);
    return player ? [player] : [];
  });

  if (queuedPlayers.length === 0) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center border-y border-border/70 bg-muted/20 text-center">
        <GripVertical className="size-6 text-muted-foreground/50" />
        <p className="mt-2 text-sm font-medium">Your draft queue is empty</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Add players from the pool or Suggestions to keep your next choices close.
        </p>
      </div>
    );
  }

  return (
    <div className="max-h-[310px] overflow-y-auto border-y border-border/70">
      {queuedPlayers.map((player, index) => (
        <MotionReorderItem
          key={player.id}
          order={index}
          rowHeight={57}
          className="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0 hover:bg-muted/25"
        >
          <span className="w-5 text-center font-mono text-xs text-muted-foreground">
            {String(index + 1)}
          </span>
          <PlayerHeadshot
            playerId={player.id}
            name={player.name}
            position={player.position}
            className="size-10 rounded-full border border-border/70"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{player.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px]">
                {player.position}
              </Badge>
              <span>{player.team}</span>
              <span>· ECR #{String(player.ecrRank)}</span>
            </div>
          </div>
          <Button
            size="sm"
            disabled={!canDraft}
            onClick={() => {
              draftPlayer(player);
            }}
          >
            Draft
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${player.name} from queue`}
            onClick={() => {
              removePlayerFromQueue(player.id);
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </MotionReorderItem>
      ))}
    </div>
  );
}
