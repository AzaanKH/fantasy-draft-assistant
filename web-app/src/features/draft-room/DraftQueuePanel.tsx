import * as React from 'react';
import { GripVertical, Trash2 } from 'lucide-react';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { PositionLabel } from '@/components/PositionLabel';
import { MotionReorderItem, MotionReorderList } from '@/components/motion';
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
      <div className="draft-queue-empty">
        <GripVertical className="size-6 text-muted-foreground/50" />
        <p className="mt-2 text-sm font-medium">Your draft queue is empty</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Add players from the pool or Suggestions to keep your next choices close.
        </p>
      </div>
    );
  }

  return (
    <MotionReorderList className="draft-queue-list">
      {queuedPlayers.map((player, index) => (
        <MotionReorderItem
          key={player.id}
          order={index}
          className="draft-queue-row"
        >
          <span className="draft-queue-index">
            {String(index + 1)}
          </span>
          <PlayerHeadshot
            playerId={player.id}
            name={player.name}
            position={player.position}
            className="size-9 shrink-0 rounded-full"
          />
          <div className="min-w-0 flex-1">
            <div className="draft-pool-name">{player.name}</div>
            <div className="draft-pool-meta">
              <PositionLabel position={player.position} /> · {player.team} · ECR #{String(player.ecrRank)}
            </div>
          </div>
          <Button
            size="sm"
            className="draft-pill-action"
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
            className="rounded-sm"
            aria-label={`Remove ${player.name} from queue`}
            onClick={() => {
              removePlayerFromQueue(player.id);
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </MotionReorderItem>
      ))}
    </MotionReorderList>
  );
}
