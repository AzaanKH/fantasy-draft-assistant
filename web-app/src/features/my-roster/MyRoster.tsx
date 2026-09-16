/**
 * MyRoster Component
 *
 * Popup dialog showing the user's drafted team organized by position.
 * Shows player names, positions, and basic stats.
 */

import * as React from 'react';
import type { Position } from '@fantasy-draft/shared';
import { POSITIONS } from '@fantasy-draft/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useDraftStore } from '@/stores/draftStore';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { cn } from '@/lib/utils';

/**
 * Position colors for visual distinction
 */
const positionColors: Record<Position, string> = {
  QB: 'bg-red-500/20 text-red-700 border-red-500',
  RB: 'bg-green-500/20 text-green-700 border-green-500',
  WR: 'bg-blue-500/20 text-blue-700 border-blue-500',
  TE: 'bg-orange-500/20 text-orange-700 border-orange-500',
  K: 'bg-purple-500/20 text-purple-700 border-purple-500',
  DEF: 'bg-gray-500/20 text-gray-700 border-gray-500',
};

/**
 * Individual player row in the roster
 */
function PlayerSlot({
  playerId,
  position,
}: {
  playerId: string;
  position: Position;
}) {
  const { players } = usePlayerDataQuery();
  const player = React.useMemo(
    () => players.find((p) => p.id === playerId),
    [players, playerId]
  );

  if (!player) {
    return (
      <div className="flex items-center justify-between py-1.5 px-2 rounded bg-muted/30">
        <span className="text-sm text-muted-foreground">Unknown Player</span>
        <Badge variant="outline" className={cn('text-xs', positionColors[position])}>
          {position}
        </Badge>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/50 hover:bg-muted transition-colors">
      <div className="flex items-center gap-3">
        <Badge variant="outline" className={cn('text-xs font-semibold', positionColors[player.position])}>
          {player.position}
        </Badge>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-foreground">{player.name}</span>
          <span className="text-xs text-muted-foreground">{player.team}</span>
        </div>
      </div>
      <div className="flex flex-col items-end text-xs">
        <span className="text-muted-foreground">ECR: {player.ecrRank}</span>
        {player.valueScore > 0 && (
          <span className="text-green-600 font-medium">+{player.valueScore}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Empty slot placeholder
 */
function EmptySlot({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-2 px-3 rounded-md border-2 border-dashed border-muted-foreground/20">
      <span className="text-sm text-muted-foreground/60">Empty {label}</span>
    </div>
  );
}

/**
 * Roster content (used inside dialog)
 */
function RosterContent() {
  const myRoster = useDraftStore((state) => state.myRoster);
  const config = useDraftStore((state) => state.config);
  const requirements = config.rosterRequirements;

  // Calculate total players on roster
  const totalPlayers = React.useMemo(() => {
    const rosterGroups = Object.values(myRoster) as string[][];
    return rosterGroups.reduce((sum, players) => sum + players.length, 0);
  }, [myRoster]);
  const flexPlayers = requirements.FLEX.eligiblePositions.flatMap((position) =>
    myRoster[position]
      .slice(requirements[position].starters)
      .map((id) => ({ id, position }))
  ).slice(0, requirements.FLEX.starters);
  const assignedFlexIds = new Set(flexPlayers.map((player) => player.id));
  const benchPlayers = POSITIONS.flatMap((position) =>
    myRoster[position]
      .slice(requirements[position].starters)
      .filter((id) => !assignedFlexIds.has(id))
      .map((id) => ({ id, position }))
  );

  if (totalPlayers === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p className="text-sm">No players drafted yet.</p>
        <p className="text-xs mt-1">
          Connect to Sleeper or use the draft buttons to add players.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Draft Position: <span className="font-semibold text-foreground">{config.myPickPosition}</span></span>
        <span className="text-muted-foreground"><span className="font-semibold text-foreground">{totalPlayers}</span> / {config.totalRounds} picks</span>
      </div>

      {/* Starters */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
          Starters
        </h4>

        {POSITIONS.flatMap((position) =>
          Array.from({ length: requirements[position].starters }, (_, index) => {
            const playerId = myRoster[position][index];
            return playerId
              ? <PlayerSlot key={`${position}-${String(index)}`} playerId={playerId} position={position} />
              : <EmptySlot key={`${position}-${String(index)}`} label={position} />;
          })
        )}

        {Array.from({ length: requirements.FLEX.starters }, (_, index) => {
          const player = flexPlayers[index];
          return player
            ? <PlayerSlot key={`flex-${player.id}`} playerId={player.id} position={player.position} />
            : <EmptySlot key={`flex-empty-${String(index)}`} label="FLEX" />;
        })}
      </div>

      {/* Bench */}
      {benchPlayers.length > 0 && (
        <div className="space-y-2 pt-4 border-t">
          <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
            Bench
          </h4>
          {benchPlayers.map(({ id, position }) => (
            <PlayerSlot key={id} playerId={id} position={position} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Main MyRoster popup component
 */
export function MyRoster() {
  const totalPlayers = useDraftStore((state) =>
    (Object.values(state.myRoster) as string[][]).reduce(
      (sum, players) => sum + players.length,
      0
    )
  );

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'text-xs',
            totalPlayers > 0 && 'border-green-500 text-green-600'
          )}
        >
          My Team {totalPlayers > 0 && `(${totalPlayers})`}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>My Team</DialogTitle>
          <DialogDescription className="sr-only">
            Review your drafted players by roster position.
          </DialogDescription>
        </DialogHeader>
        <RosterContent />
      </DialogContent>
    </Dialog>
  );
}
