import { STORAGE_ACTIVATION_ENABLED } from '@fantasy-draft/shared/sync';
import { dispatchWorkspace } from '@/workspace/ui-dispatch';
import { useWorkspace, useDraftState } from '@/workspace/WorkspaceProvider';
import { useDraftView, useDraftViewReader } from '@/workspace/useDraftView';
import { type Player } from '@fantasy-draft/shared/league';
import { createSlotSequence } from '@fantasy-draft/shared/draft';
import * as React from 'react';
import { useLeagueTimingEvidence } from '@/hooks/useLeagueTimingEvidence';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { type MockCpuPickPace } from '@/stores/draftStore';
import { getKeeperAtPick, selectCpuPlayer } from '@fantasy-draft/shared/draft';

const CPU_PICK_DELAY_MS: Record<MockCpuPickPace, number> = {
  watch: 600,
  fast: 200,
  instant: 0,
};

/**
 * Records the next mock selection: a keeper at its slot, otherwise a CPU pick.
 * Returns false at the user's own pick, at draft end, or when no player fits.
 */
export function useSimulateNextCpuPick(players: readonly Player[]): () => boolean | Promise<boolean> {
  const workspace = useWorkspace();
  const readDraftView = useDraftViewReader();
  const sessionMode = useDraftState((state) => state.sessionMode);
  const timingEvidence = useLeagueTimingEvidence(sessionMode !== 'live');

  return React.useCallback((): boolean | Promise<boolean> => {
    const state = workspace.draft.getState();
    const view = readDraftView();
    const totalPicks = state.config.totalTeams * state.config.totalRounds;
    if (view.currentPick > totalPicks) return false;

    const keeper = getKeeperAtPick(
      view.effectiveKeepers,
      view.currentPick,
      state.config.totalTeams,
      state.config.draftType
    );
    if (keeper) {
      if (STORAGE_ACTIVATION_ENABLED && workspace.sendDurable) return workspace.sendDurable(['consumeKeeperAtCurrentPick', view.currentPick]).then(() => true);
      if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'consumeKeeperAtCurrentPick'); } else { workspace.send('consumeKeeperAtCurrentPick'); }
      return true;
    }

    if (view.isMyTurn) {
      return false;
    }

    const selection = selectCpuPlayer({
      players,
      draftedPlayerIds: view.draftedPlayerIds,
      history: state.draftHistory,
      keepers: view.effectiveKeepers,
      currentPick: view.currentPick,
      config: {
        totalTeams: state.config.totalTeams,
        totalRounds: state.config.totalRounds,
        myPickPosition: state.config.myPickPosition,
        draftType: state.config.draftType,
        rosterRequirements: state.config.rosterRequirements,
        randomness: state.mockSettings.randomness,
        seed: state.mockSettings.seed,
      },
      historyModel: timingEvidence.model,
    });
    if (!selection) return false;

    const teamIndex = createSlotSequence({ type: state.config.draftType, teams: state.config.totalTeams, rounds: state.config.totalRounds }).at(view.currentPick).teamIndex;
    const command = ['markPlayerDrafted', selection.player.id,
      selection.player.name,
      selection.player.position,
      teamIndex,
      `Team ${String(teamIndex + 1)}`,
      STORAGE_ACTIVATION_ENABLED && workspace.sendDurable ? view.currentPick : undefined,
      'cpu',
      STORAGE_ACTIVATION_ENABLED && workspace.sendDurable ? { pickNumber: view.currentPick, actor: 'cpu' } : undefined
    ] satisfies import('@/workspace/commands').VoidWorkspaceCommand;
    if (STORAGE_ACTIVATION_ENABLED && workspace.sendDurable) return workspace.sendDurable(command).then(() => true);
    if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, ...command); } else { workspace.send(...command); }
    return true;
  }, [workspace, readDraftView, timingEvidence.model, players]);
}

/**
 * Advances a mock draft through CPU and keeper selections until the user's pick.
 * Mounted above the routes so picks made from the Assistant also continue the draft.
 */
export function MockDraftAutoAdvance(): null {
  const { players } = usePlayerDataQuery();
  const workspace = useWorkspace();
  const readDraftView = useDraftViewReader();
  const sessionMode = useDraftState((state) => state.sessionMode);
  const currentPick = useDraftView((view) => view.currentPick);
  const config = useDraftState((state) => state.config);
  const preloadedKeepers = useDraftState((state) => state.preloadedKeepers);
  const { paused, settingsOpen } = useDraftState((state) => state.mockAutoAdvance);
  const cpuPickDelayMs = useDraftState(
    (state) => CPU_PICK_DELAY_MS[state.mockSettings.cpuPickPace]
  );
  const simulateNextCpuPick = useSimulateNextCpuPick(players);

  React.useEffect(() => {
    if (sessionMode !== 'mock' || paused || settingsOpen || players.length === 0) return;
    const state = workspace.draft.getState();
    const view = readDraftView();
    const totalPicks = state.config.totalTeams * state.config.totalRounds;
    if (view.currentPick > totalPicks) return;
    const keeper = getKeeperAtPick(
      view.effectiveKeepers,
      view.currentPick,
      state.config.totalTeams,
      state.config.draftType
    );
    if (!keeper && view.isMyTurn) {
      return;
    }
    const timer = window.setTimeout(() => {
      // Pause rather than retry when no CPU candidate fits.
      const result = simulateNextCpuPick();
      if (result instanceof Promise) void result.then(advanced => {
        if (!advanced) if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'setMockAutoAdvancePaused', true); } else { workspace.send('setMockAutoAdvancePaused', true); }
      }).catch(() => { if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'setMockAutoAdvancePaused', true); } else { workspace.send('setMockAutoAdvancePaused', true); } });
      else if (!result) if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'setMockAutoAdvancePaused', true); } else { workspace.send('setMockAutoAdvancePaused', true); }
    }, cpuPickDelayMs);
    return () => { window.clearTimeout(timer); };
  }, [
    config,
    cpuPickDelayMs,
    currentPick,
    workspace,
    readDraftView,
    paused,
    players.length,
    preloadedKeepers,
    sessionMode,
    settingsOpen,
    simulateNextCpuPick,
  ]);

  return null;
}
