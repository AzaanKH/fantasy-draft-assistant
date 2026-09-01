import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_ROSTER_REQUIREMENTS,
  DEFAULT_SCORING_RULES,
  createLeagueSettings,
} from '@fantasy-draft/shared';
import { createDraftStore, useDraftStore } from './draftStore';

describe('draftStore shortlist', () => {
  beforeEach(() => {
    useDraftStore.getState().setSessionMode('setup');
    useDraftStore.getState().setConfig({
      totalTeams: 10,
      totalRounds: 15,
      myPickPosition: 5,
    });
    useDraftStore.getState().preloadKeepers([]);
    useDraftStore.getState().resetDraft();
    useDraftStore.getState().setDecisionLens('best-pick');
  });

  it('distinguishes setup, mock, and live draft sessions', () => {
    expect(useDraftStore.getState().sessionMode).toBe('setup');

    useDraftStore.getState().setSessionMode('mock');
    expect(useDraftStore.getState().sessionMode).toBe('mock');

    useDraftStore.getState().setSessionMode('live');
    expect(useDraftStore.getState().sessionMode).toBe('live');
  });

  it('invalidates provider readiness until provider roster settings return', () => {
    const store = createDraftStore();
    const providerSettings = createLeagueSettings({
      source: 'sleeper',
      leagueId: 'primary-league',
      totalTeams: 10,
      scoringRules: DEFAULT_SCORING_RULES,
      rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS,
      keepersEnabled: true,
    });
    store.getState().applyLeagueSettings(providerSettings);

    store.getState().setRosterRequirements({
      ...DEFAULT_ROSTER_REQUIREMENTS,
      BENCH: { spots: DEFAULT_ROSTER_REQUIREMENTS.BENCH.spots + 1 },
    });

    expect(store.getState().leagueSettings).toMatchObject({
      source: 'default',
      leagueId: null,
    });
    expect(store.getState().config.rosterRequirements.BENCH.spots).toBe(6);

    store.getState().applyLeagueSettings(providerSettings);
    expect(store.getState().leagueSettings.source).toBe('sleeper');
    expect(store.getState().config.rosterRequirements.BENCH.spots).toBe(5);
  });

  it('records a Provisional Pick in the canonical sequence and every affected roster', () => {
    const store = useDraftStore.getState();
    store.setSessionMode('live');
    store.setConfig({ myPickPosition: 3 });
    store.reconcileSyncedPicks([
      {
        pickNumber: 1,
        playerId: 'confirmed-one',
        playerName: 'Confirmed One',
        position: 'QB',
        teamIndex: 0,
        teamName: 'Team 1',
        isMyPick: false,
      },
      {
        pickNumber: 2,
        playerId: 'confirmed-two',
        playerName: 'Confirmed Two',
        position: 'WR',
        teamIndex: 1,
        teamName: 'Team 2',
        isMyPick: false,
      },
    ], 3);

    const recorded = useDraftStore.getState().recordProvisionalPick({
      pickNumber: 3,
      playerId: 'observed-rb',
      playerName: 'Observed Running Back',
      position: 'RB',
      teamIndex: 2,
      teamName: 'My Team',
    });
    const state = useDraftStore.getState();

    expect(recorded).toBe(true);
    expect(state.draftHistory.at(-1)).toMatchObject({
      pickNumber: 3,
      playerId: 'observed-rb',
      source: 'provisional',
    });
    expect(state.draftedPlayerIds.has('observed-rb')).toBe(true);
    expect(state.teamRosters[2]?.RB).toEqual(['observed-rb']);
    expect(state.myRoster.RB).toEqual(['observed-rb']);
    expect(state.currentPick).toBe(4);

    expect(useDraftStore.getState().recordProvisionalPick({
      pickNumber: 4,
      playerId: 'observed-rb',
      playerName: 'Observed Running Back',
      position: 'RB',
      teamIndex: 3,
      teamName: 'Team 4',
    })).toBe(false);
    expect(useDraftStore.getState().draftHistory).toHaveLength(3);
  });

  it('confirms a matching Provisional Pick once across repeated Provider Truth snapshots', () => {
    const store = useDraftStore.getState();
    store.setSessionMode('live');
    store.setConfig({ myPickPosition: 3 });
    const providerPicks = [
      {
        pickNumber: 1,
        playerId: 'confirmed-one',
        playerName: 'Confirmed One',
        position: 'QB' as const,
        teamIndex: 0,
        teamName: 'Team 1',
        isMyPick: false,
      },
      {
        pickNumber: 2,
        playerId: 'confirmed-two',
        playerName: 'Confirmed Two',
        position: 'WR' as const,
        teamIndex: 1,
        teamName: 'Team 2',
        isMyPick: false,
      },
    ];
    store.reconcileSyncedPicks(providerPicks, 3);
    expect(useDraftStore.getState().recordProvisionalPick({
      pickNumber: 3,
      playerId: 'observed-rb',
      playerName: 'Observed Running Back',
      position: 'RB',
      teamIndex: 2,
      teamName: 'My Team',
    })).toBe(true);
    useDraftStore.getState().setMockSurvivalProbabilities({
      'next-player': 0.75,
    });

    const restoredProviderTruth = [
      ...providerPicks,
      {
        pickNumber: 3,
        playerId: 'observed-rb',
        playerName: 'Observed Running Back',
        position: 'RB' as const,
        teamIndex: 2,
        teamName: 'My Team',
        isMyPick: true,
      },
    ];
    let transitions = 0;
    const unsubscribe = useDraftStore.subscribe(() => {
      transitions += 1;
    });

    const firstResult = useDraftStore.getState().reconcileSyncedPicks(
      restoredProviderTruth,
      4
    );
    const confirmed = useDraftStore.getState();

    expect(firstResult).toEqual({
      changed: true,
      confirmations: [{
        pickNumber: 3,
        playerId: 'observed-rb',
        playerName: 'Observed Running Back',
        position: 'RB',
        teamIndex: 2,
        teamName: 'My Team',
      }],
      corrections: [],
      removals: [],
      unresolvedIdentities: [],
    });
    expect(confirmed.draftHistory).toHaveLength(3);
    expect(confirmed.draftHistory.filter(
      (pick) => pick.playerId === 'observed-rb'
    )).toEqual([
      expect.objectContaining({
        pickNumber: 3,
        source: 'sync',
      }),
    ]);
    expect([...confirmed.draftedPlayerIds].filter(
      (playerId) => playerId === 'observed-rb'
    )).toHaveLength(1);
    expect(confirmed.teamRosters[2]?.RB).toEqual(['observed-rb']);
    expect(confirmed.myRoster.RB).toEqual(['observed-rb']);
    expect(confirmed.currentPick).toBe(4);
    expect(confirmed.mockSurvivalProbabilities).toEqual({});
    expect(transitions).toBe(1);

    const historyAfterConfirmation = confirmed.draftHistory;
    const rostersAfterConfirmation = confirmed.teamRosters;
    const repeatedResult = confirmed.reconcileSyncedPicks(
      restoredProviderTruth,
      4
    );
    const repeated = useDraftStore.getState();

    expect(repeatedResult).toEqual({
      changed: false,
      confirmations: [],
      corrections: [],
      removals: [],
      unresolvedIdentities: [],
    });
    expect(repeated.draftHistory).toBe(historyAfterConfirmation);
    expect(repeated.teamRosters).toBe(rostersAfterConfirmation);
    expect(transitions).toBe(1);

    unsubscribe();
  });

  it('rebuilds canonical state and reports conflicts, removals, provider corrections, and unresolved identities', () => {
    const store = useDraftStore.getState();
    store.setSessionMode('live');
    store.setConfig({ myPickPosition: 4 });
    const initialProviderTruth = [
      {
        pickNumber: 1,
        playerId: 'old-provider-rb',
        playerName: 'Old Provider Runner',
        position: 'RB' as const,
        teamIndex: 0,
        teamName: 'Team 1',
        isMyPick: false,
      },
      {
        pickNumber: 2,
        playerId: 'provider-wr',
        playerName: 'Provider Receiver',
        position: 'WR' as const,
        teamIndex: 1,
        teamName: 'Team 2',
        isMyPick: false,
      },
      {
        pickNumber: 3,
        playerId: 'provider-qb',
        playerName: 'Provider Quarterback',
        position: 'QB' as const,
        teamIndex: 2,
        teamName: 'Team 3',
        isMyPick: false,
      },
    ];
    store.reconcileSyncedPicks(initialProviderTruth, 4);
    useDraftStore.getState().togglePlayerShortlisted('wrong-local-te');
    useDraftStore.getState().togglePlayerShortlisted('extra-local-wr');
    expect(useDraftStore.getState().recordProvisionalPick({
      pickNumber: 4,
      playerId: 'wrong-local-te',
      playerName: 'Wrong Local Tight End',
      position: 'TE',
      teamIndex: 3,
      teamName: 'My Team',
    })).toBe(true);
    expect(useDraftStore.getState().recordProvisionalPick({
      pickNumber: 6,
      playerId: 'extra-local-wr',
      playerName: 'Extra Local Receiver',
      position: 'WR',
      teamIndex: 5,
      teamName: 'Team 6',
    })).toBe(true);

    const restoredProviderTruth = [
      ...initialProviderTruth.map((pick) => pick.pickNumber === 1
        ? {
            ...pick,
            playerId: 'corrected-provider-rb',
            playerName: 'Corrected Provider Runner',
          }
        : pick),
      {
        pickNumber: 4,
        playerId: 'official-provider-wr',
        playerName: 'Official Provider Receiver',
        position: 'WR' as const,
        teamIndex: 3,
        teamName: 'My Team',
        isMyPick: true,
      },
    ];
    const unresolvedPick = {
      pickNumber: 5,
      playerId: 'unmapped-provider-id',
      playerName: 'Unmapped Provider Player',
      nflTeam: 'DET',
    };
    let transitions = 0;
    const unsubscribe = useDraftStore.subscribe(() => {
      transitions += 1;
    });

    const result = useDraftStore.getState().reconcileSyncedPicks(
      restoredProviderTruth,
      6,
      [unresolvedPick]
    );
    const reconciled = useDraftStore.getState();

    expect(result).toMatchObject({
      changed: true,
      confirmations: [],
      corrections: [
        {
          pickNumber: 1,
          previous: { playerId: 'old-provider-rb' },
          provider: { playerId: 'corrected-provider-rb' },
        },
        {
          pickNumber: 4,
          previous: { playerId: 'wrong-local-te' },
          provider: { playerId: 'official-provider-wr' },
        },
      ],
      removals: [
        {
          pickNumber: 6,
          playerId: 'extra-local-wr',
          source: 'provisional',
        },
      ],
      unresolvedIdentities: [unresolvedPick],
    });
    expect(reconciled.draftHistory.map((pick) => [
      pick.pickNumber,
      pick.playerId,
      pick.source,
    ])).toEqual([
      [1, 'corrected-provider-rb', 'sync'],
      [2, 'provider-wr', 'sync'],
      [3, 'provider-qb', 'sync'],
      [4, 'official-provider-wr', 'sync'],
    ]);
    expect(reconciled.draftedPlayerIds.has('old-provider-rb')).toBe(false);
    expect(reconciled.draftedPlayerIds.has('wrong-local-te')).toBe(false);
    expect(reconciled.draftedPlayerIds.has('extra-local-wr')).toBe(false);
    expect(reconciled.draftedPlayerIds.has('corrected-provider-rb')).toBe(true);
    expect(reconciled.draftedPlayerIds.has('official-provider-wr')).toBe(true);
    expect(reconciled.teamRosters[0]?.RB).toEqual(['corrected-provider-rb']);
    expect(reconciled.teamRosters[3]?.TE).toEqual([]);
    expect(reconciled.teamRosters[3]?.WR).toEqual(['official-provider-wr']);
    expect(reconciled.myRoster.WR).toEqual(['official-provider-wr']);
    expect(reconciled.currentPick).toBe(6);
    expect(reconciled.unresolvedProviderPicks).toEqual([unresolvedPick]);
    expect([...reconciled.shortlistedPlayerIds].sort()).toEqual([
      'extra-local-wr',
      'wrong-local-te',
    ]);
    expect(transitions).toBe(1);

    const canonicalHistory = reconciled.draftHistory;
    const canonicalRosters = reconciled.teamRosters;
    expect(reconciled.reconcileSyncedPicks(
      restoredProviderTruth,
      6,
      [unresolvedPick]
    )).toEqual({
      changed: false,
      confirmations: [],
      corrections: [],
      removals: [],
      unresolvedIdentities: [],
    });
    expect(useDraftStore.getState().draftHistory).toBe(canonicalHistory);
    expect(useDraftStore.getState().teamRosters).toBe(canonicalRosters);
    expect(transitions).toBe(1);

    const identityResolvedProviderTruth = [
      ...restoredProviderTruth,
      {
        pickNumber: 5,
        playerId: 'resolved-provider-player',
        playerName: 'Resolved Provider Player',
        position: 'RB' as const,
        teamIndex: 4,
        teamName: 'Team 5',
        isMyPick: false,
      },
    ];
    expect(useDraftStore.getState().reconcileSyncedPicks(
      identityResolvedProviderTruth,
      6,
      []
    )).toMatchObject({ changed: true, unresolvedIdentities: [] });
    expect(useDraftStore.getState().unresolvedProviderPicks).toEqual([]);

    expect(useDraftStore.getState().recordProvisionalPick({
      pickNumber: 6,
      playerId: 'cycle-two-local',
      playerName: 'Cycle Two Local',
      position: 'TE',
      teamIndex: 5,
      teamName: 'Team 6',
    })).toBe(true);
    const cycleTwoProviderTruth = [
      ...identityResolvedProviderTruth,
      {
        pickNumber: 6,
        playerId: 'cycle-two-provider',
        playerName: 'Cycle Two Provider',
        position: 'WR' as const,
        teamIndex: 5,
        teamName: 'Team 6',
        isMyPick: false,
      },
    ];
    const secondCycle = useDraftStore.getState().reconcileSyncedPicks(
      cycleTwoProviderTruth,
      7
    );
    expect(secondCycle.corrections.map((correction) => ({
      pickNumber: correction.pickNumber,
      previousPlayerId: correction.previous.playerId,
      providerPlayerId: correction.provider.playerId,
    }))).toEqual([{
      pickNumber: 6,
      previousPlayerId: 'cycle-two-local',
      providerPlayerId: 'cycle-two-provider',
    }]);
    expect(useDraftStore.getState().reconcileSyncedPicks(
      cycleTwoProviderTruth,
      7
    ).changed).toBe(false);

    unsubscribe();
  });

  it('rejects provisional entries outside live mode or assigned to the wrong snake slot', () => {
    const store = useDraftStore.getState();
    expect(store.recordProvisionalPick({
      pickNumber: 1,
      playerId: 'player-a',
      playerName: 'Player A',
      position: 'WR',
      teamIndex: 0,
      teamName: 'Team 1',
    })).toBe(false);

    store.setSessionMode('live');
    expect(useDraftStore.getState().recordProvisionalPick({
      pickNumber: 1,
      playerId: 'player-a',
      playerName: 'Player A',
      position: 'WR',
      teamIndex: 4,
      teamName: 'My Team',
    })).toBe(false);
    expect(useDraftStore.getState().draftHistory).toEqual([]);
  });

  it('corrects and removes only Provisional Picks without creating duplicate draft state', () => {
    const store = useDraftStore.getState();
    store.setSessionMode('live');
    store.setConfig({ myPickPosition: 3 });
    store.togglePlayerShortlisted('observed-old');
    store.togglePlayerShortlisted('observed-new');
    store.reconcileSyncedPicks([
      {
        pickNumber: 1,
        playerId: 'confirmed-one',
        playerName: 'Confirmed One',
        position: 'QB',
        teamIndex: 0,
        teamName: 'Team 1',
        isMyPick: false,
      },
      {
        pickNumber: 2,
        playerId: 'confirmed-two',
        playerName: 'Confirmed Two',
        position: 'WR',
        teamIndex: 1,
        teamName: 'Team 2',
        isMyPick: false,
      },
    ], 3);
    expect(useDraftStore.getState().recordProvisionalPick({
      pickNumber: 3,
      playerId: 'observed-old',
      playerName: 'Observed Old Player',
      position: 'RB',
      teamIndex: 2,
      teamName: 'My Team',
    })).toBe(true);
    expect(useDraftStore.getState().recordProvisionalPick({
      pickNumber: 4,
      playerId: 'other-provisional',
      playerName: 'Other Provisional Player',
      position: 'TE',
      teamIndex: 3,
      teamName: 'Team 4',
    })).toBe(true);

    const originalTimestamp = useDraftStore.getState().draftHistory.find(
      (pick) => pick.pickNumber === 3
    )?.timestamp;
    const replacement = {
      pickNumber: 5,
      playerId: 'observed-new',
      playerName: 'Observed New Player',
      position: 'WR' as const,
      teamIndex: 4,
      teamName: 'Team 5',
    };

    expect(useDraftStore.getState().correctProvisionalPick(1, replacement)).toBe(false);
    expect(useDraftStore.getState().removeProvisionalPick(1)).toBe(false);
    expect(useDraftStore.getState().correctProvisionalPick(3, {
      ...replacement,
      pickNumber: 4,
      teamIndex: 3,
      teamName: 'Team 4',
    })).toBe(false);
    expect(useDraftStore.getState().correctProvisionalPick(3, {
      ...replacement,
      playerId: 'other-provisional',
      playerName: 'Other Provisional Player',
      position: 'TE',
    })).toBe(false);
    expect(useDraftStore.getState().correctProvisionalPick(3, replacement)).toBe(true);

    let state = useDraftStore.getState();
    const corrected = state.draftHistory.find((pick) => pick.pickNumber === 5);
    expect(corrected).toMatchObject({
      playerId: 'observed-new',
      playerName: 'Observed New Player',
      position: 'WR',
      teamIndex: 4,
      teamName: 'Team 5',
      source: 'provisional',
      timestamp: originalTimestamp,
      provisionalRevision: 1,
    });
    expect(corrected?.provisionalUpdatedAt).toEqual(expect.any(Number));
    expect(state.currentPick).toBe(3);
    expect(state.draftedPlayerIds.has('observed-old')).toBe(false);
    expect(state.draftedPlayerIds.has('observed-new')).toBe(true);
    expect(state.myRoster.RB).toEqual([]);
    expect(state.teamRosters[4]?.WR).toEqual(['observed-new']);
    expect(state.shortlistedPlayerIds).toEqual(['observed-old']);
    expect(new Set(state.draftHistory.map((pick) => pick.pickNumber)).size).toBe(
      state.draftHistory.length
    );
    expect(new Set(state.draftHistory.map((pick) => pick.playerId)).size).toBe(
      state.draftHistory.length
    );

    expect(state.removeProvisionalPick(5)).toBe(true);
    state = useDraftStore.getState();
    expect(state.draftHistory.some((pick) => pick.pickNumber === 5)).toBe(false);
    expect(state.draftedPlayerIds.has('observed-new')).toBe(false);
    expect(state.teamRosters[4]?.WR).toEqual([]);
    expect(state.shortlistedPlayerIds).toEqual(['observed-old', 'observed-new']);
    expect(state.removeProvisionalPick(5)).toBe(false);
    expect(useDraftStore.getState().draftHistory).toHaveLength(3);
  });

  it('defaults to Best Pick and changes only the Decision Lens', () => {
    const store = useDraftStore.getState();
    store.setSessionMode('live');
    store.setPositionFilter('WR');
    store.setSearchQuery('lamb');
    store.markPlayerDrafted('drafted-rb', 'Drafted RB', 'RB', 0, 'Team 1', 1, 'sync');

    const before = useDraftStore.getState();
    expect(before.decisionLens).toBe('best-pick');
    const preserved = {
      currentPick: before.currentPick,
      draftedPlayerIds: [...before.draftedPlayerIds],
      myRoster: before.myRoster,
      filter: before.filter,
      sessionMode: before.sessionMode,
    };

    before.setDecisionLens('best-player');
    const after = useDraftStore.getState();

    expect(after.decisionLens).toBe('best-player');
    expect({
      currentPick: after.currentPick,
      draftedPlayerIds: [...after.draftedPlayerIds],
      myRoster: after.myRoster,
      filter: after.filter,
      sessionMode: after.sessionMode,
    }).toEqual(preserved);
  });

  it('reserves keepers before the draft and preserves them on reset', () => {
    const { preloadKeepers, markPlayerDrafted, resetDraft } = useDraftStore.getState();

    preloadKeepers([
      {
        playerId: 'my-keeper',
        playerName: 'My Keeper',
        position: 'RB',
        teamIndex: 4,
        round: 10,
        isMyKeeper: true,
      },
      {
        playerId: 'other-keeper',
        playerName: 'Other Keeper',
        position: 'WR',
        teamIndex: 1,
        round: 4,
        isMyKeeper: false,
      },
    ]);

    let state = useDraftStore.getState();
    expect(state.currentPick).toBe(1);
    expect(state.draftHistory).toHaveLength(0);
    expect([...state.draftedPlayerIds].sort()).toEqual(['my-keeper', 'other-keeper']);
    expect(state.myRoster.RB).toEqual(['my-keeper']);

    markPlayerDrafted('other-keeper', 'Other Keeper', 'WR', 1, 'Team 2');
    expect(useDraftStore.getState().currentPick).toBe(1);

    markPlayerDrafted('fresh-pick', 'Fresh Pick', 'QB', 0, 'My Team');
    expect(useDraftStore.getState().currentPick).toBe(2);
    resetDraft();

    state = useDraftStore.getState();
    expect(state.currentPick).toBe(1);
    expect(state.draftHistory).toHaveLength(0);
    expect([...state.draftedPlayerIds].sort()).toEqual(['my-keeper', 'other-keeper']);
    expect(state.myRoster.RB).toEqual(['my-keeper']);
  });

  it('retains preloaded keepers when synced draft picks are reconciled', () => {
    const { preloadKeepers, reconcileSyncedPicks } = useDraftStore.getState();
    preloadKeepers([
      {
        playerId: 'keeper',
        playerName: 'Keeper',
        position: 'TE',
        teamIndex: 1,
        round: 4,
        isMyKeeper: false,
      },
    ]);

    reconcileSyncedPicks([
      {
        pickNumber: 1,
        playerId: 'fresh-pick',
        playerName: 'Fresh Pick',
        position: 'RB',
        teamIndex: 0,
        teamName: 'My Team',
        isMyPick: true,
      },
    ], 2);

    expect([...useDraftStore.getState().draftedPlayerIds]).toEqual([
      'fresh-pick',
      'keeper',
    ]);
    expect(useDraftStore.getState().currentPick).toBe(2);
  });

  it('consumes a keeper at its assigned snake-draft selection', () => {
    const state = useDraftStore.getState();
    state.preloadKeepers([
      {
        playerId: 'javonte',
        playerName: 'Javonte Williams',
        position: 'RB',
        teamIndex: 4,
        round: 10,
        isMyKeeper: true,
      },
    ]);
    state.branchFromPick(96);
    useDraftStore.getState().consumeKeeperAtCurrentPick();

    let current = useDraftStore.getState();
    expect(current.currentPick).toBe(97);
    expect(current.draftHistory).toEqual([
      expect.objectContaining({
        pickNumber: 96,
        playerId: 'javonte',
        teamIndex: 4,
        source: 'keeper',
      }),
    ]);

    current.undoLastPick();
    current = useDraftStore.getState();
    expect(current.currentPick).toBe(96);
    expect(current.draftHistory).toHaveLength(0);
    expect(current.draftedPlayerIds.has('javonte')).toBe(true);
  });

  it('branches from any completed pick while preserving keeper reservations', () => {
    const state = useDraftStore.getState();
    state.preloadKeepers([
      {
        playerId: 'keeper',
        playerName: 'Keeper',
        position: 'RB',
        teamIndex: 4,
        round: 10,
        isMyKeeper: true,
      },
    ]);
    state.markPlayerDrafted('one', 'One', 'WR', 0, 'Team 1');
    useDraftStore.getState().markPlayerDrafted('two', 'Two', 'QB', 1, 'Team 2');
    useDraftStore.getState().markPlayerDrafted('three', 'Three', 'TE', 2, 'Team 3');
    useDraftStore.getState().branchFromPick(2);

    const branched = useDraftStore.getState();
    expect(branched.currentPick).toBe(2);
    expect(branched.draftHistory.map((pick) => pick.playerId)).toEqual(['one']);
    expect([...branched.draftedPlayerIds].sort()).toEqual(['keeper', 'one']);
  });

  it('keeps players in the order they were starred and toggles them off', () => {
    const { togglePlayerShortlisted } = useDraftStore.getState();

    togglePlayerShortlisted('player-a');
    togglePlayerShortlisted('player-b');
    expect(useDraftStore.getState().shortlistedPlayerIds).toEqual([
      'player-a',
      'player-b',
    ]);

    togglePlayerShortlisted('player-a');
    expect(useDraftStore.getState().shortlistedPlayerIds).toEqual(['player-b']);
  });

  it('removes drafted players and does not add them back to the shortlist', () => {
    const { markPlayerDrafted, togglePlayerShortlisted } = useDraftStore.getState();

    togglePlayerShortlisted('player-a');
    markPlayerDrafted('player-a', 'Player A', 'WR', 0, 'Team 1');
    expect(useDraftStore.getState().shortlistedPlayerIds).toEqual([]);

    togglePlayerShortlisted('player-a');
    expect(useDraftStore.getState().shortlistedPlayerIds).toEqual([]);
  });

  it('removes shortlisted players when importing a pick', () => {
    const { markPlayerDrafted, togglePlayerShortlisted } = useDraftStore.getState();

    togglePlayerShortlisted('player-a');
    markPlayerDrafted('player-a', 'Player A', 'WR', 1, 'Team 1', 3);
    expect(useDraftStore.getState().shortlistedPlayerIds).toEqual([]);
  });

  it('restores a shortlisted player in the same position when undoing a pick', () => {
    const { markPlayerDrafted, togglePlayerShortlisted, undoLastPick } =
      useDraftStore.getState();

    togglePlayerShortlisted('player-a');
    togglePlayerShortlisted('player-b');
    markPlayerDrafted('player-a', 'Player A', 'WR', 0, 'Team 1');
    undoLastPick();

    expect(useDraftStore.getState().shortlistedPlayerIds).toEqual([
      'player-a',
      'player-b',
    ]);
  });

  it('replaces imported Sleeper picks when the canonical snapshot changes', () => {
    useDraftStore.getState().setConfig({ myPickPosition: 1 });
    const { markPlayerDrafted, reconcileSyncedPicks } = useDraftStore.getState();

    markPlayerDrafted('manual-player', 'Manual Player', 'RB', 0, 'My Team', 1);

    reconcileSyncedPicks([
      {
        pickNumber: 1,
        playerId: 'player-a',
        playerName: 'Player A',
        position: 'WR',
        teamIndex: 0,
        teamName: 'My Team',
        isMyPick: true,
      },
      {
        pickNumber: 2,
        playerId: 'player-b',
        playerName: 'Player B',
        position: 'RB',
        teamIndex: 1,
        teamName: 'Team 2',
        isMyPick: false,
      },
    ], 3);

    reconcileSyncedPicks([
      {
        pickNumber: 1,
        playerId: 'player-c',
        playerName: 'Player C',
        position: 'TE',
        teamIndex: 0,
        teamName: 'My Team',
        isMyPick: true,
      },
    ], 2);

    const state = useDraftStore.getState();
    expect([...state.draftedPlayerIds]).toEqual(['player-c']);
    expect(state.draftHistory).toHaveLength(1);
    expect(state.myRoster.TE).toEqual(['player-c']);
    expect(state.myRoster.WR).toEqual([]);
    expect(state.currentPick).toBe(2);
  });

  it('initializes canonical keeper supply identically across repeated preloads', () => {
    const { preloadKeepers } = useDraftStore.getState();
    const keepers = [
      {
        playerId: 'keeper-a',
        playerName: 'Keeper A',
        position: 'RB' as const,
        teamIndex: 4,
        round: 10,
        isMyKeeper: true,
      },
      {
        playerId: 'keeper-b',
        playerName: 'Keeper B',
        position: 'WR' as const,
        teamIndex: 1,
        round: 4,
        isMyKeeper: false,
      },
    ];

    preloadKeepers(keepers);
    preloadKeepers(keepers);

    const state = useDraftStore.getState();
    expect(state.preloadedKeepers).toHaveLength(2);
    expect(state.keepersInitialized).toBe(true);
    expect([...state.draftedPlayerIds].sort()).toEqual(['keeper-a', 'keeper-b']);
    expect(state.myRoster.RB).toEqual(['keeper-a']);
    expect(state.myRoster.WR).toEqual([]);
    expect(state.draftHistory).toHaveLength(0);
  });

  it('rejects duplicate and conflicting keeper supply instead of applying a partial baseline', () => {
    useDraftStore.getState().preloadKeepers([
      {
        playerId: 'dup',
        playerName: 'Duplicate Keeper',
        position: 'WR',
        teamIndex: 1,
        round: 3,
        isMyKeeper: false,
      },
      {
        playerId: 'dup',
        playerName: 'Duplicate Keeper',
        position: 'WR',
        teamIndex: 1,
        round: 4,
        isMyKeeper: false,
      },
      {
        playerId: 'slot-a',
        playerName: 'Slot A',
        position: 'RB',
        teamIndex: 5,
        round: 6,
        isMyKeeper: false,
      },
      {
        playerId: 'slot-b',
        playerName: 'Slot B',
        position: 'TE',
        teamIndex: 5,
        round: 6,
        isMyKeeper: false,
      },
    ]);

    const state = useDraftStore.getState();
    expect(state.preloadedKeepers).toEqual([]);
    expect(state.keepersInitialized).toBe(false);
    expect(state.draftedPlayerIds.size).toBe(0);
    expect(state.myRoster.RB).toEqual([]);
    expect(state.myRoster.WR).toEqual([]);
  });

  it('keeps an explicitly incomplete empty supply uninitialized', () => {
    useDraftStore.getState().preloadKeepers([], false);

    const state = useDraftStore.getState();
    expect(state.preloadedKeepers).toEqual([]);
    expect(state.keepersInitialized).toBe(false);
    expect(state.draftedPlayerIds.size).toBe(0);
  });

  it('lets Provider Truth override a stale keeper assignment', () => {
    const { preloadKeepers, reconcileSyncedPicks } =
      useDraftStore.getState();

    // Keeper configures team 2, round 4 -> overall pick 39.
    preloadKeepers([
      {
        playerId: 'keeper',
        playerName: 'Keeper',
        position: 'TE',
        teamIndex: 1,
        round: 4,
        isMyKeeper: false,
      },
    ]);

    // Completed provider history puts the configured keeper in another slot.
    reconcileSyncedPicks([
      {
        pickNumber: 38,
        playerId: 'keeper',
        playerName: 'Keeper',
        position: 'TE',
        teamIndex: 0,
        teamName: 'Team 1',
        isMyPick: false,
      },
    ], 39);

    const state = useDraftStore.getState();
    expect(state.draftHistory).toEqual([
      expect.objectContaining({
        pickNumber: 38,
        playerId: 'keeper',
        source: 'sync',
      }),
    ]);
    expect(state.preloadedKeepers).toHaveLength(1);
    expect(state.draftedPlayerIds.has('keeper')).toBe(true);
    expect(state.teamRosters[0]?.TE).toEqual(['keeper']);
    expect(state.teamRosters[1]?.TE).toEqual([]);
    expect(state.currentPick).toBe(39);
  });

  it('reconciles the Rashee Rice and Omarion Hampton keeper conflict from Provider Truth', () => {
    const { preloadKeepers, reconcileSyncedPicks } =
      useDraftStore.getState();

    preloadKeepers([
      {
        playerId: '12507',
        playerName: 'Omarion Hampton',
        position: 'RB',
        teamIndex: 5,
        round: 3,
        isMyKeeper: false,
      },
    ]);

    reconcileSyncedPicks([
      {
        pickNumber: 26,
        playerId: '10229',
        playerName: 'Rashee Rice',
        position: 'WR',
        teamIndex: 5,
        teamName: 'Team 6',
        isMyPick: false,
      },
      {
        pickNumber: 28,
        playerId: '12507',
        playerName: 'Omarion Hampton',
        position: 'RB',
        teamIndex: 7,
        teamName: 'Team 8',
        isMyPick: false,
      },
    ], 36);

    const state = useDraftStore.getState();
    expect(state.draftHistory.map((pick) => [pick.pickNumber, pick.playerId])).toEqual([
      [26, '10229'],
      [28, '12507'],
    ]);
    expect([...state.draftedPlayerIds].sort()).toEqual(['10229', '12507']);
    expect(state.preloadedKeepers).toHaveLength(1);
    expect(state.teamRosters[5]?.WR).toEqual(['10229']);
    expect(state.teamRosters[5]?.RB).toEqual([]);
    expect(state.teamRosters[7]?.RB).toEqual(['12507']);
    expect(state.currentPick).toBe(36);
  });

  it('deduplicates a synced keeper on my roster', () => {
    useDraftStore.getState().setConfig({ myPickPosition: 2 });
    useDraftStore.getState().preloadKeepers([
      {
        playerId: 'keeper',
        playerName: 'Keeper',
        position: 'TE',
        teamIndex: 1,
        round: 4,
        isMyKeeper: true,
      },
    ]);

    useDraftStore.getState().reconcileSyncedPicks([
      {
        pickNumber: 39,
        playerId: 'keeper',
        playerName: 'Keeper',
        position: 'TE',
        teamIndex: 1,
        teamName: 'My Team',
        isMyPick: true,
      },
    ], 40);

    const state = useDraftStore.getState();
    expect(state.draftHistory).toEqual([]);
    expect(state.myRoster.TE).toEqual(['keeper']);
    expect(state.currentPick).toBe(40);
  });

  it('preserves Provider Truth when keeper initialization finishes after sync', () => {
    useDraftStore.getState().setSessionMode('live');
    useDraftStore.getState().reconcileSyncedPicks([
      {
        pickNumber: 38,
        playerId: 'keeper',
        playerName: 'Keeper',
        position: 'TE',
        teamIndex: 0,
        teamName: 'Team 1',
        isMyPick: false,
      },
    ], 39);

    useDraftStore.getState().preloadKeepers([
      {
        playerId: 'keeper',
        playerName: 'Keeper',
        position: 'TE',
        teamIndex: 1,
        round: 4,
        isMyKeeper: false,
      },
    ]);

    const state = useDraftStore.getState();
    expect(state.draftHistory).toEqual([
      expect.objectContaining({
        pickNumber: 38,
        playerId: 'keeper',
        source: 'sync',
      }),
    ]);
    expect(state.preloadedKeepers).toHaveLength(1);
    expect(state.teamRosters[0]?.TE).toEqual(['keeper']);
    expect(state.teamRosters[1]?.TE).toEqual([]);
    expect(state.currentPick).toBe(39);
  });
});
