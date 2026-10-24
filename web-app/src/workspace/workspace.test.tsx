import { asProbability } from '@fantasy-draft/shared/units';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createDraftStore } from '@/stores/draftStore';
import { createDefaultLeagueSettings } from '@fantasy-draft/shared/league';
import type { ProvisionalPickInput } from '@/stores/draft/types';
import { getDraftView, useDraftViewReader } from './useDraftView';
import { createWorkspace } from './workspace';
import { WorkspaceProvider, useDraftState, useWorkspace } from './WorkspaceProvider';

vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: [] }) }));

function room() {
  const draftStore = createDraftStore();
  return { draftStore, workspace: createWorkspace({ draftStore }) };
}

const pick: ProvisionalPickInput = { pickNumber: 1, playerId: 'a', playerName: 'Player A', position: 'WR', teamIndex: 0, teamName: 'Team 1' };

describe('workspace command ownership', () => {
  it('binds injected connection before children reconcile and keeps imperative reads fresh', () => {
    const first = room();
    const second = room();
    first.workspace.send('connection.startConnection', 'sleeper', 'draft-a');
    first.workspace.send('setSessionMode', 'live');
    first.draftStore.getInitialState = first.draftStore.getState;
    let read: ReturnType<typeof useDraftViewReader> | undefined;
    function Reconcile() {
      expect(useDraftState(state => state.liveSession)).toEqual({ provider: 'sleeper', draftId: 'draft-a' });
      read = useDraftViewReader();
      useWorkspace().send('reconcileSyncedPicks', [{ ...pick, isMyPick: true }], 2, [], 100);
      return null;
    }
    renderToString(createElement(WorkspaceProvider, { workspace: first.workspace, children: createElement(Reconcile) }));
    expect(read?.().currentPick).toBe(2);
    first.workspace.send('branchFromPick', 5);
    expect(read?.().currentPick).toBe(5);
    expect(getDraftView(second.workspace.draft).currentPick).toBe(1);
    first.workspace.send('connection.startConnection', 'espn', '123');
    expect(first.workspace.draft.getState().liveSession).toEqual({ provider: 'espn', draftId: '123' });
    expect(first.workspace.draft.getState().draftHistory).toEqual([]);
    expect(second.workspace.connection.getState().connection).toBeNull();
    first.workspace.dispose(); second.workspace.dispose();
  });

  it('preserves results for accepted, conflicting, corrected, removed, and reconciled provisional picks', () => {
    const { workspace } = room();
    const { send, draft } = workspace;
    send('connection.startConnection', 'sleeper', 'draft-a');
    send('setSessionMode', 'live');
    expect(send('recordProvisionalPick', pick)).toBe(true);
    expect(send('recordProvisionalPick', { ...pick, playerId: 'b' })).toBe(false);
    expect(send('correctProvisionalPick', 1, { ...pick, playerId: 'c' })).toBe(true);
    expect(send('removeProvisionalPick', 1)).toBe(true);
    expect(send('removeProvisionalPick', 1)).toBe(false);
    expect(send('recordProvisionalPick', pick)).toBe(true);
    const result = send('reconcileSyncedPicks', [{ ...pick, isMyPick: true }], 2, [], 200);
    expect(result.confirmations).toEqual([expect.objectContaining({ playerId: 'a' })]);
    expect(draft.getState().draftHistory[0]?.source).toBe('sync');
    expect(send('correctProvisionalPick', 1, { ...pick, playerId: 'c' })).toBe(false);
    send('enterManualContinuity', 200);
    expect(draft.getState().manualContinuityBaselineAt).toBe(200);
    workspace.dispose();
  });

  it('runs configuration, mock CPU, keeper, queue, progress, and UI commands in one room', () => {
    const { workspace } = room();
    const { send, draft } = workspace;
    send('applyLeagueSettings', createDefaultLeagueSettings());
    send('setConfig', { totalTeams: 2, totalRounds: 3, draftType: 'linear', myPickPosition: 2 });
    send('setRosterRequirements', { ...draft.getState().config.rosterRequirements, BENCH: { spots: 4 } });
    send('setSessionMode', 'mock');
    send('setMockSettings', { seed: 123, cpuPickPace: 'instant' });
    send('setMockSettingsOpen', true);
    send('setMockAutoAdvancePaused', true);
    send('setMockSurvivalProbabilities', { a: asProbability(0.25) });
    send('preloadKeepers', [{ playerId: 'keeper', playerName: 'Keeper', position: 'RB', teamIndex: 0, round: 1, isMyKeeper: false }]);
    send('consumeKeeperAtCurrentPick');
    expect(draft.getState().draftHistory[0]?.source).toBe('keeper');
    send('markPlayerDrafted', 'cpu', 'CPU', 'WR', 1, 'Team 2', 2, 'cpu');
    expect(getDraftView(draft).currentPick).toBe(3);
    send('undoLastPick');
    expect(draft.getState().draftHistory).toHaveLength(1);
    send('togglePlayerShortlisted', 'a'); send('togglePlayerShortlisted', 'b');
    send('moveShortlistedPlayer', 'b', -1);
    expect(draft.getState().shortlistedPlayerIds).toEqual(['b', 'a']);
    send('removePlayerFromShortlist', 'a');
    send('setDecisionLens', 'best-player');
    send('setPositionFilter', 'WR'); send('setSearchQuery', 'receiver');
    send('setMockSurvivalProbabilities', { a: asProbability(0.25) });
    expect(draft.getState()).toMatchObject({ decisionLens: 'best-player', filter: { position: 'WR', searchQuery: 'receiver' }, mockSurvivalProbabilities: { a: 0.25 } });
    send('branchFromPick', 4);
    expect(getDraftView(draft).currentPick).toBe(4);
    send('resetDraft');
    expect(getDraftView(draft).currentPick).toBe(1);
    workspace.dispose();
  });

  it('routes every connection family and releases both subscriptions on disposal', () => {
    let change: ((key: string | null, value: string | null) => void) | undefined;
    const stop = vi.fn();
    const draftStore = createDraftStore({ externalChanges: callback => { change = callback; return stop; } });
    const workspace = createWorkspace({ draftStore, initialConnection: { provider: 'sleeper', draftId: 'first', draftPosition: 2 } });
    expect(workspace.draft.getState().liveSession?.draftId).toBe('first');
    workspace.send('connection.confirmDraftPosition', 3);
    workspace.send('connection.setPrimaryLeagueSettings', true);
    expect(workspace.connection.getState().connection?.usePrimaryLeagueSettings).toBe(true);
    workspace.send('connection.setQuickMockSettings', true);
    expect(workspace.connection.getState().connection?.settingsProfile).toBe('quick-mock');
    workspace.send('connection.restoreConnection', { provider: 'espn', draftId: '123', draftPosition: 1 });
    expect(workspace.draft.getState().liveSession).toEqual({ provider: 'espn', draftId: '123' });
    expect(change).toBeTypeOf('function');
    workspace.dispose();
    expect(stop).toHaveBeenCalledOnce();
    expect(workspace.draft.getState().liveSession?.provider).toBe('espn');
  });

  it('requires an explicitly injected workspace', () => {
    function Unbound() { useWorkspace(); return null; }
    expect(() => renderToString(createElement(Unbound))).toThrow('WorkspaceProvider');
  });
});
