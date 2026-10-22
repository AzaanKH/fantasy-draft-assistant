import { dispatchWorkspace } from '@/workspace/ui-dispatch';
import { useWorkspace } from '@/workspace/WorkspaceProvider';
import { getDraftView, useDraftView } from '@/workspace/useDraftView';
import { type Player } from '@fantasy-draft/shared/league';
import { createSlotSequence } from '@fantasy-draft/shared/draft';
import * as React from 'react';

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
  const workspace = useWorkspace();
  const canDraftPlayer = React.useCallback(
    (player: Pick<Player, 'position'>) => canDraftByPosition[player.position],
    [canDraftByPosition]
  );

  const draftPlayer = React.useCallback((player: Player) => {
    const { config } = workspace.draft.getState();
    const view = getDraftView(workspace.draft);
    if (!view.canDraftByPosition[player.position]) return;
    const teamIndex = createSlotSequence({ type: config.draftType, teams: config.totalTeams, rounds: config.totalRounds }).at(view.currentPick).teamIndex;
    if (workspace.sendDurable) {
      void workspace.sendDurable(['markPlayerDrafted', player.id, player.name, player.position, teamIndex, 'My Team', view.currentPick, 'manual', { pickNumber: view.currentPick, actor: 'user' }]).catch(() => undefined);
      return;
    }
    dispatchWorkspace(workspace, 'markPlayerDrafted',
      player.id,
      player.name,
      player.position,
      teamIndex,
      'My Team'
    );
  }, [workspace]);

  return { canDraft, isMyTurn, canDraftPlayer, draftPlayer };
}
