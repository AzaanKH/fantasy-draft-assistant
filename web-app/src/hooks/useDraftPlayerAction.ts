import * as React from 'react';
import type { Player, Position, RosterRequirements } from '@fantasy-draft/shared';
import {
  useDraftSessionMode,
  useDraftStore,
  useIsMyTurn,
} from '@/stores/draftStore';
import { getKeeperAtPick, getTeamIndexForPick } from '@/lib/mock-draft-engine';

export function canDraftFromWorkspace(
  sessionMode: ReturnType<typeof useDraftSessionMode>,
  isMyTurn: boolean,
  hasKeeperAtCurrentPick: boolean
): boolean {
  return sessionMode === 'mock' && isMyTurn && !hasKeeperAtCurrentPick;
}

/** A position whose roster maximum is reached is not a legal pick, matching the recommendation pool. */
export function isPositionFull(
  position: Position,
  roster: Readonly<Record<Position, readonly string[]>>,
  requirements: RosterRequirements
): boolean {
  return roster[position].length >= requirements[position].max;
}

export function useDraftPlayerAction(): {
  readonly canDraft: boolean;
  readonly isMyTurn: boolean;
  /** `canDraft` plus the player's position limit; use it for per-player Draft actions. */
  readonly canDraftPlayer: (player: Pick<Player, 'position'>) => boolean;
  readonly draftPlayer: (player: Player) => void;
} {
  const sessionMode = useDraftSessionMode();
  const isMyTurn = useIsMyTurn();
  const config = useDraftStore((state) => state.config);
  const currentPick = useDraftStore((state) => state.currentPick);
  const preloadedKeepers = useDraftStore((state) => state.preloadedKeepers);
  const myRoster = useDraftStore((state) => state.myRoster);
  const markPlayerDrafted = useDraftStore((state) => state.markPlayerDrafted);
  const addToMyRoster = useDraftStore((state) => state.addToMyRoster);
  const keeperAtCurrentPick = sessionMode === 'mock'
    ? getKeeperAtPick(preloadedKeepers, currentPick, config.totalTeams)
    : undefined;
  // The Draft Workspace is read-only for connected provider drafts. Local pick
  // mutation is reserved for deterministic mock rehearsal; provider picks are
  // observed through sync and are always completed in the provider UI.
  const canDraft = canDraftFromWorkspace(
    sessionMode,
    isMyTurn,
    keeperAtCurrentPick !== undefined
  );

  const canDraftPlayer = React.useCallback(
    (player: Pick<Player, 'position'>) => canDraft && !isPositionFull(player.position, myRoster, config.rosterRequirements),
    [canDraft, config.rosterRequirements, myRoster]
  );

  const draftPlayer = React.useCallback((player: Player) => {
    if (!canDraftPlayer(player)) return;
    const teamIndex = getTeamIndexForPick(currentPick, config.totalTeams);
    markPlayerDrafted(
      player.id,
      player.name,
      player.position,
      teamIndex,
      'My Team'
    );
    addToMyRoster(player);
  }, [addToMyRoster, canDraftPlayer, config.totalTeams, currentPick, markPlayerDrafted]);

  return { canDraft, isMyTurn, canDraftPlayer, draftPlayer };
}
