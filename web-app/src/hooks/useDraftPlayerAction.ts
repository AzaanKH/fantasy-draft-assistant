import { commitWorkspaceCommand } from '@/workspace/workspace-command';
import { useWorkspace } from '@/workspace/WorkspaceProvider';
import { getDraftView, useDraftView } from '@/workspace/useDraftView';
import { type Player } from '@fantasy-draft/shared/league';
import { createSlotSequence } from '@fantasy-draft/shared/draft';
import * as React from 'react';
import { useStore } from 'zustand';
import { getPickLock, usePickFailureReporter, usePickOrigin } from '@/workspace/pick-in-flight';
import { takeInjectedHang, takeInjectedPickFailure } from '@/workspace/dev-fault-injection';

/** The triggering control's state while a Draft is saved, or after it failed. Success clears it. */
export type DraftActionStatus =
  | { readonly playerId: string; readonly state: 'pending' }
  | { readonly playerId: string; readonly state: 'failed'; readonly message: string };

/**
 * `reportsFor` lists the players whose failure this control actually renders (for example the four suggestion
 * cards). Omit it when the control shows any of its failures. Pass `'external'` when the caller registers its own
 * reporter with `usePickFailureReporter` and the returned `origin` (the virtualized pool, whose rendered rows are
 * known only later). A failure for a player the control no longer renders, or from a control that is collapsed or
 * otherwise unseen, falls back to the workspace notice.
 */
export function useDraftPlayerAction(reportsFor?: readonly string[] | 'external'): {
  readonly canDraft: boolean;
  readonly isMyTurn: boolean;
  /** `canDraft` plus the player's position limit; use it for per-player Draft actions. */
  readonly canDraftPlayer: (player: Pick<Player, 'position'>) => boolean;
  /** Ignored while any pick in this workspace is still saving. */
  readonly draftPlayer: (player: Player) => void;
  /** Pending or failed Draft started from this hook instance, so only the control that drafted shows it. */
  readonly draftStatus: DraftActionStatus | null;
  /** A Draft or Record save is pending somewhere in the workspace; disable every Draft/Record control. */
  readonly pickInFlight: boolean;
  /** This control's pick origin, for a caller that registers its own failure reporter. */
  readonly origin: string;
} {
  const isMyTurn = useDraftView((view) => view.isMyTurn);
  const canDraft = useDraftView((view) => view.canDraft);
  const canDraftByPosition = useDraftView((view) => view.canDraftByPosition);
  const workspace = useWorkspace();
  const lock = getPickLock(workspace);
  const origin = usePickOrigin();
  // While rendered and visible, this control shows its own failures (for `reportsFor` only, when given); otherwise the
  // workspace notice takes over.
  usePickFailureReporter(lock, origin, reportsFor === 'external' ? undefined : reportsFor, reportsFor !== 'external');
  const inFlight = useStore(lock.store, (state) => state.inFlight);
  const failure = useStore(lock.store, (state) => state.failure);
  const draftStatus = React.useMemo((): DraftActionStatus | null => {
    if (inFlight?.origin === origin) return { playerId: inFlight.playerId, state: 'pending' };
    if (failure?.origin === origin) return { playerId: failure.playerId, state: 'failed', message: failure.message };
    return null;
  }, [failure, inFlight, origin]);
  const canDraftPlayer = React.useCallback(
    (player: Pick<Player, 'position'>) => canDraftByPosition[player.position],
    [canDraftByPosition]
  );

  const draftRef = React.useRef<(player: Player) => void>(() => undefined);
  const draftPlayer = React.useCallback((player: Player) => {
    const { config } = workspace.draft.getState();
    const view = getDraftView(workspace.draft);
    if (!view.canDraftByPosition[player.position]) return;
    const pick = { playerId: player.id, playerName: player.name, origin, retry: lock.bindRetry(() => { draftRef.current(player); }) };
    if (!lock.begin(pick)) return;
    const teamIndex = createSlotSequence({ type: config.draftType, teams: config.totalTeams, rounds: config.totalRounds }).at(view.currentPick).teamIndex;
    let saved: Promise<unknown>;
    const injected = takeInjectedPickFailure();
    const hang = takeInjectedHang('pick');
    try {
      if (injected) throw injected;
      saved = hang ?? Promise.resolve(workspace.sendDurable
        ? workspace.sendDurable(['markPlayerDrafted', player.id, player.name, player.position, teamIndex, 'My Team', view.currentPick, 'manual', { pickNumber: view.currentPick, actor: 'user' }])
        : commitWorkspaceCommand(workspace, 'markPlayerDrafted', player.id, player.name, player.position, teamIndex, 'My Team'));
    } catch (error) {
      saved = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    void saved.then(
      () => { lock.settle(pick); },
      (error: unknown) => {
        // The failing control shows this inline with Retry (or, once it has unmounted, PickFailureNotice does); clear
        // the generic save notice so it is not reported twice.
        workspace.dismissError?.();
        lock.settle(pick, `${player.name} was not drafted. ${error instanceof Error ? error.message : 'The pick could not be saved.'}`);
      }
    );
  }, [lock, origin, workspace]);
  React.useEffect(() => { draftRef.current = draftPlayer; }, [draftPlayer]);

  const pickInFlight = inFlight !== null;
  return React.useMemo(
    () => ({ canDraft, isMyTurn, canDraftPlayer, draftPlayer, draftStatus, pickInFlight, origin }),
    [canDraft, canDraftPlayer, draftPlayer, draftStatus, isMyTurn, origin, pickInFlight]
  );
}
