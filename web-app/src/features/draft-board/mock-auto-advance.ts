import { useDraftView, useDraftViewReader } from '@/workspace/useDraftView';
import { type Player } from '@fantasy-draft/shared/league';
import { createSlotSequence } from '@fantasy-draft/shared/draft';
import * as React from 'react';
import { useLeagueTimingEvidence } from '@/hooks/useLeagueTimingEvidence';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import {
  useDraftStore,
  useDraftStoreApi,
  type MockCpuPickPace,
} from '@/stores/draftStore';
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
export function useSimulateNextCpuPick(players: readonly Player[]): () => boolean {
  const draftStore = useDraftStoreApi();
  const readDraftView = useDraftViewReader();
  const sessionMode = useDraftStore((state) => state.sessionMode);
  const timingEvidence = useLeagueTimingEvidence(sessionMode !== 'live');

  return React.useCallback((): boolean => {
    const state = draftStore.getState();
    const view = readDraftView();
    const totalPicks = state.config.totalTeams * state.config.totalRounds;
    if (view.currentPick > totalPicks) return false;

    const keeper = getKeeperAtPick(
      state.preloadedKeepers,
      view.currentPick,
      state.config.totalTeams,
      state.config.draftType
    );
    if (keeper) {
      state.consumeKeeperAtCurrentPick();
      return true;
    }

    if (view.isMyTurn) {
      return false;
    }

    const selection = selectCpuPlayer({
      players,
      draftedPlayerIds: view.draftedPlayerIds,
      history: state.draftHistory,
      keepers: state.preloadedKeepers,
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
  }, [draftStore, readDraftView, timingEvidence.model, players]);
}

/**
 * Advances a mock draft through CPU and keeper selections until the user's pick.
 * Mounted above the routes so picks made from the Assistant also continue the draft.
 */
export function MockDraftAutoAdvance(): null {
  const { players } = usePlayerDataQuery();
  const draftStore = useDraftStoreApi();
  const readDraftView = useDraftViewReader();
  const sessionMode = useDraftStore((state) => state.sessionMode);
  const currentPick = useDraftView((view) => view.currentPick);
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
    const view = readDraftView();
    const totalPicks = state.config.totalTeams * state.config.totalRounds;
    if (view.currentPick > totalPicks) return;
    const keeper = getKeeperAtPick(
      state.preloadedKeepers,
      view.currentPick,
      state.config.totalTeams,
      state.config.draftType
    );
    if (!keeper && view.isMyTurn) {
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
