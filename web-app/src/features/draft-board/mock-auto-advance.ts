import * as React from 'react';
import type { Player } from '@fantasy-draft/shared';
import { useLeagueTimingEvidence } from '@/hooks/useLeagueTimingEvidence';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import {
  calculateIsMyTurn,
  useDraftStore,
  useDraftStoreApi,
  type MockCpuPickPace,
} from '@/stores/draftStore';
import {
  getKeeperAtPick,
  getTeamIndexForPick,
  selectCpuPlayer,
} from '@/lib/mock-draft-engine';

export const CPU_PICK_DELAY_MS: Record<MockCpuPickPace, number> = {
  watch: 600,
  fast: 200,
  instant: 0,
};

/**
 * Records the next mock selection: a keeper at its slot, otherwise a CPU pick.
 * Returns false at the user's own pick, at draft end, or when no player fits.
 */
export function useSimulateNextCpuPick(players: readonly Player[]): () => boolean {
  const draftStore = useDraftStoreApi();
  const sessionMode = useDraftStore((state) => state.sessionMode);
  const timingEvidence = useLeagueTimingEvidence(sessionMode !== 'live');

  return React.useCallback((): boolean => {
    const state = draftStore.getState();
    const totalPicks = state.config.totalTeams * state.config.totalRounds;
    if (state.currentPick > totalPicks) return false;

    const keeper = getKeeperAtPick(
      state.preloadedKeepers,
      state.currentPick,
      state.config.totalTeams
    );
    if (keeper) {
      state.consumeKeeperAtCurrentPick();
      return true;
    }

    if (calculateIsMyTurn(
      state.currentPick,
      state.config.myPickPosition,
      state.config.totalTeams
    )) {
      return false;
    }

    const selection = selectCpuPlayer({
      players,
      draftedPlayerIds: state.draftedPlayerIds,
      history: state.draftHistory,
      keepers: state.preloadedKeepers,
      currentPick: state.currentPick,
      config: {
        totalTeams: state.config.totalTeams,
        totalRounds: state.config.totalRounds,
        myPickPosition: state.config.myPickPosition,
        rosterRequirements: state.config.rosterRequirements,
        randomness: state.mockSettings.randomness,
        seed: state.mockSettings.seed,
      },
      historyModel: timingEvidence.model,
    });
    if (!selection) return false;

    const teamIndex = getTeamIndexForPick(state.currentPick, state.config.totalTeams);
    state.markPlayerDrafted(
      selection.player.id,
      selection.player.name,
      selection.player.position,
      teamIndex,
      `Team ${String(teamIndex + 1)}`,
      undefined,
      'cpu'
    );
    return true;
  }, [draftStore, timingEvidence.model, players]);
}

/**
 * Advances a mock draft through CPU and keeper selections until the user's pick.
 * Mounted above the routes so picks made from the Assistant also continue the draft.
 */
export function MockDraftAutoAdvance(): null {
  const { players } = usePlayerDataQuery();
  const draftStore = useDraftStoreApi();
  const sessionMode = useDraftStore((state) => state.sessionMode);
  const currentPick = useDraftStore((state) => state.currentPick);
  const config = useDraftStore((state) => state.config);
  const preloadedKeepers = useDraftStore((state) => state.preloadedKeepers);
  const { paused, settingsOpen } = useDraftStore((state) => state.mockAutoAdvance);
  const cpuPickDelayMs = useDraftStore(
    (state) => CPU_PICK_DELAY_MS[state.mockSettings.cpuPickPace]
  );
  const simulateNextCpuPick = useSimulateNextCpuPick(players);

  React.useEffect(() => {
    if (sessionMode !== 'mock' || paused || settingsOpen || players.length === 0) return;
    const state = draftStore.getState();
    const totalPicks = state.config.totalTeams * state.config.totalRounds;
    if (state.currentPick > totalPicks) return;
    const keeper = getKeeperAtPick(
      state.preloadedKeepers,
      state.currentPick,
      state.config.totalTeams
    );
    if (!keeper && calculateIsMyTurn(
      state.currentPick,
      state.config.myPickPosition,
      state.config.totalTeams
    )) {
      return;
    }
    const timer = window.setTimeout(() => {
      // Pause rather than retry when no CPU candidate fits.
      if (!simulateNextCpuPick()) draftStore.getState().setMockAutoAdvancePaused(true);
    }, cpuPickDelayMs);
    return () => { window.clearTimeout(timer); };
  }, [
    config,
    cpuPickDelayMs,
    currentPick,
    draftStore,
    paused,
    players.length,
    preloadedKeepers,
    sessionMode,
    settingsOpen,
    simulateNextCpuPick,
  ]);

  return null;
}
