import * as React from 'react';
import type { Player } from '@fantasy-draft/shared';
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

export function useDraftPlayerAction(): {
  readonly canDraft: boolean;
  readonly isMyTurn: boolean;
  readonly draftPlayer: (player: Player) => void;
} {
  const sessionMode = useDraftSessionMode();
  const isMyTurn = useIsMyTurn();
  const config = useDraftStore((state) => state.config);
  const currentPick = useDraftStore((state) => state.currentPick);
  const preloadedKeepers = useDraftStore((state) => state.preloadedKeepers);
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
  ) && currentPick <= config.totalTeams * config.totalRounds;

  const draftPlayer = React.useCallback((player: Player) => {
    if (!canDraft) return;
    const teamIndex = getTeamIndexForPick(currentPick, config.totalTeams);
    markPlayerDrafted(
      player.id,
      player.name,
      player.position,
      teamIndex,
      'My Team',
      undefined,
      'manual',
      player.team
    );
    addToMyRoster(player);
  }, [addToMyRoster, canDraft, config.totalTeams, currentPick, markPlayerDrafted]);

  return { canDraft, isMyTurn, draftPlayer };
}
