import { useDraftView } from '@/workspace/useDraftView';
import { type Player } from '@fantasy-draft/shared/league';
import { createSlotSequence } from '@fantasy-draft/shared/draft';
import * as React from 'react';
import {
  useDraftStore,
} from '@/stores/draftStore';

export function useDraftPlayerAction(): {
  readonly canDraft: boolean;
  readonly isMyTurn: boolean;
  /** `canDraft` plus the player's position limit; use it for per-player Draft actions. */
  readonly canDraftPlayer: (player: Pick<Player, 'position'>) => boolean;
  readonly draftPlayer: (player: Player) => void;
} {
  const isMyTurn = useDraftView((view) => view.isMyTurn);
  const canDraft = useDraftView((view) => view.canDraft);
  const canDraftByPosition = useDraftView((view) => view.canDraftByPosition);
  const config = useDraftStore((state) => state.config);
  const currentPick = useDraftView((view) => view.currentPick);
  const markPlayerDrafted = useDraftStore((state) => state.markPlayerDrafted);
  const canDraftPlayer = React.useCallback(
    (player: Pick<Player, 'position'>) => canDraftByPosition[player.position],
    [canDraftByPosition]
  );

  const draftPlayer = React.useCallback((player: Player) => {
    if (!canDraftPlayer(player)) return;
    const teamIndex = createSlotSequence({ type: config.draftType, teams: config.totalTeams, rounds: config.totalRounds }).at(currentPick).teamIndex;
    markPlayerDrafted(
      player.id,
      player.name,
      player.position,
      teamIndex,
      'My Team'
    );
  }, [canDraftPlayer, config.draftType, config.totalTeams, config.totalRounds, currentPick, markPlayerDrafted]);

  return { canDraft, isMyTurn, canDraftPlayer, draftPlayer };
}
