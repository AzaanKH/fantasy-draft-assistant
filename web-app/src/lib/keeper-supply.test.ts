import { asProbability, asRank, asVor } from '@fantasy-draft/shared/units';
import { deriveDraftState } from '@/stores/draft/source';
import { DRAFT_DISPLAY } from '@/lib/demo-mode';
import {
  type Player,
} from '@fantasy-draft/shared/league';
import {
  createSlotSequence,
  type PositionNeed,
} from '@fantasy-draft/shared/draft';
import {
  DEFAULT_ROSTER_REQUIREMENTS,
} from '@fantasy-draft/shared/league';
import { beforeEach, describe, expect, it } from 'vitest';
import { filterDrafted, getRecommendations, createDraftDecisionOutput } from '@fantasy-draft/shared/draft';
import { createDraftStore } from '@/stores/draftStore';

function entry(
  playerId: string,
  playerName: string,
  position: Player['position'],
  teamIndex: number,
  round: number,
  isMyKeeper = false
) {
  return { playerId, playerName, position, teamIndex, round, isMyKeeper };
}

const TOTAL_TEAMS = 10;
const TOTAL_ROUNDS = 15;

const KEEPER_FIXTURE = [
  { playerName: 'Jaxon Smith-Njigba', position: 'WR', teamIndex: 0, round: 2 },
  { playerName: 'Emeka Egbuka', position: 'WR', teamIndex: 1, round: 8 },
  { playerName: 'Quinshon Judkins', position: 'RB', teamIndex: 2, round: 7 },
  { playerName: 'Rico Dowdle', position: 'RB', teamIndex: 3, round: 10 },
  { playerName: 'Javonte Williams', position: 'RB', teamIndex: 4, round: 10, isMyKeeper: true },
  { playerName: 'Omarion Hampton', position: 'RB', teamIndex: 5, round: 3 },
  { playerName: 'Jonathan Taylor', position: 'RB', teamIndex: 6, round: 1 },
  { playerName: 'Travis Etienne Jr.', position: 'RB', teamIndex: 7, round: 9 },
  { playerName: 'Puka Nacua', position: 'WR', teamIndex: 8, round: 1 },
  { playerName: 'James Cook III', position: 'RB', teamIndex: 9, round: 3 },
] as const;

function createPlayer(
  id: string,
  position: Player['position'],
  ecrRank: number,
  name?: string
): Player {
  return {
    id,
    name: name ?? `Player ${id}`,
    position,
    team: 'DET',
    byeWeek: 6,
    ecrRank: asRank(ecrRank),
    positionalRank: asRank(ecrRank),
    sleeperAdp: ecrRank,
    valueScore: 0,
    marketRank: ecrRank,
    marketAdp: ecrRank,
    marketAdpTrend: 0,
    isContractYear: false,
    offensiveEnvironmentScore: 5,
    projectedPoints: 200 - ecrRank,
    valueOverReplacement: asVor(Math.max(0, 20 - ecrRank / 5)),
    tier: 1,
    tierDropoffScore: 0.8,
    nextPickSurvivalProbability: asProbability(0.5),
    ceilingScore: 7,
    floorScore: 6,
    upsideScore: 6,
    uncertaintyScore: 3,
    injuryRiskScore: 2,
    predictionSource: 'heuristic',
    newsStatus: 'healthy',
    stackPartnerTeam: 'DET',
    highlightLevel: 'neutral',
  };
}

function createNeeds(
  needsConfig: Array<{ position: Player['position']; priority: PositionNeed['priority'] }>
): PositionNeed[] {
  return needsConfig.map(({ position, priority }) => ({
    position,
    priority,
    startersFilled: priority === 'critical' ? 0 : 1,
    startersNeeded: position === 'QB' ? 1 : 2,
    flexSlotsFilled: 0,
    flexSlotsNeeded: 0,
    isFlexEligible: false,
    scarcityScore: priority === 'critical' ? 9 : 5,
  }));
}

function buildPrimaryLeaguePool(): Player[] {
  const keepers = KEEPER_FIXTURE.map((keeper, index) =>
    createPlayer(`keeper-${String(index)}`, keeper.position, 5 + index * 3, keeper.playerName)
  );
  const candidates = Array.from({ length: 40 }, (_, index) =>
    createPlayer(`candidate-${String(index)}`, index % 2 === 0 ? 'WR' : 'RB', 60 + index)
  );
  return [...keepers, ...candidates];
}

function resolveFixtureKeepers(pool: readonly Player[]) {
  return KEEPER_FIXTURE.map((keeper) => {
    const player = pool.find((candidate) => candidate.name === keeper.playerName);
    if (!player) throw new Error(`Missing fixture player: ${keeper.playerName}`);
    return {
      playerId: player.id,
      playerName: player.name,
      position: player.position,
      teamIndex: keeper.teamIndex,
      round: keeper.round,
      isMyKeeper: 'isMyKeeper' in keeper ? keeper.isMyKeeper : false,
    };
  });
}
const draftStore = createDraftStore();

describe('Primary League keeper supply end-to-end', () => {
  const pool = buildPrimaryLeaguePool();
  const resolvedKeepers = resolveFixtureKeepers(pool);
  const keeperPlayerIds = new Set(resolvedKeepers.map((keeper) => keeper.playerId));

  const resetStore = (): void => {
    draftStore.getState().setSessionMode('setup');
    draftStore.getState().setConfig({
      totalTeams: TOTAL_TEAMS,
      totalRounds: TOTAL_ROUNDS,
      myPickPosition: 5,
      rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS,
    });
    draftStore.getState().preloadKeepers([]);
    draftStore.getState().resetDraft();
  };

  const availablePlayers = () => {
    const state = draftStore.getState();
    return filterDrafted(
      pool,
      deriveDraftState(state).draftedPlayerIds,
      [...state.draftHistory, ...state.preloadedKeepers]
    );
  };

  const decisionOutputForBothLenses = () => {
    const needs = createNeeds([
      { position: 'RB', priority: 'critical' },
      { position: 'WR', priority: 'critical' },
    ]);
    const bestPick = getRecommendations(availablePlayers(), needs, 10, {
      currentPick: deriveDraftState(draftStore.getState()).currentPick,
      totalPicks: TOTAL_TEAMS * TOTAL_ROUNDS,
      totalTeams: TOTAL_TEAMS,
      rosterCounts: { RB: 0, WR: 0 },
    }, DRAFT_DISPLAY);
    return createDraftDecisionOutput(
      bestPick.draftNow,
      bestPick.selection,
      bestPick.bestAvailable,
      'best-pick',
      DRAFT_DISPLAY
    );
  };

  beforeEach(resetStore);

  it('reserves every confirmed keeper before ordinary picks and hides them from both lenses', () => {
    draftStore.getState().preloadKeepers(resolvedKeepers);

    const state = draftStore.getState();
    expect(state.preloadedKeepers).toHaveLength(KEEPER_FIXTURE.length);
    expect(deriveDraftState(state).currentPick).toBe(1);
    expect(state.draftHistory).toHaveLength(0);
    expect([...deriveDraftState(state).draftedPlayerIds].sort()).toEqual(
      [...keeperPlayerIds].sort()
    );
    expect(deriveDraftState(state).myRoster.RB).toEqual(['keeper-4']);

    const output = decisionOutputForBothLenses();
    for (const view of [output.bestPickView, output.bestPlayerView]) {
      const visibleIds = new Set(view.recommendations.map((pick) => pick.playerId));
      for (const keeperId of keeperPlayerIds) {
        expect(visibleIds.has(keeperId)).toBe(false);
        expect(view.preferred?.playerId).not.toBe(keeperId);
      }
    }
  });

  it('places each keeper exactly once at its configured slot as the cursor advances', () => {
    draftStore.getState().preloadKeepers(resolvedKeepers);

    let candidateIndex = 0;
    for (let pickNumber = 1; pickNumber <= 30; pickNumber += 1) {
      const state = draftStore.getState();
      const keeperAtPick = state.preloadedKeepers.find(
        (keeper) =>
          createSlotSequence({ type: 'snake', teams: TOTAL_TEAMS, rounds: keeper.round }).forTeamRound(keeper.teamIndex, keeper.round).pick === pickNumber
      );

      if (keeperAtPick) {
        draftStore.getState().consumeKeeperAtCurrentPick();
        expect(deriveDraftState(draftStore.getState()).currentPick).toBe(pickNumber + 1);
        continue;
      }

      const candidate = pool.find((player) => player.id === `candidate-${String(candidateIndex)}`);
      candidateIndex += 1;
      if (!candidate) throw new Error('Ran out of candidates');
      const teamIndex = (pickNumber - 1) % TOTAL_TEAMS;
      draftStore.getState().markPlayerDrafted(
        candidate.id,
        candidate.name,
        candidate.position,
        teamIndex,
        `Team ${String(teamIndex + 1)}`
      );
    }

    const state = draftStore.getState();
    const historyByPlayerId = new Map<string, number[]>();
    for (const pick of state.draftHistory) {
      historyByPlayerId.set(pick.playerId, [
        ...(historyByPlayerId.get(pick.playerId) ?? []),
        pick.pickNumber,
      ]);
    }
    // Keepers inside the rehearsed window land exactly once at their slot.
    const expectedPicksWithinWindow: Array<[number, number]> = [
      [6, 7],
      [8, 9],
      [0, 20],
      [5, 26],
      [9, 30],
    ];
    for (const [index, pickNumber] of expectedPicksWithinWindow) {
      const keeper = resolvedKeepers[index];
      if (!keeper) throw new Error(`Missing fixture keeper at index ${String(index)}`);
      expect(historyByPlayerId.get(keeper.playerId)).toEqual([pickNumber]);
    }
    // Later-round keepers stay reserved and out of the sequence until reached.
    for (const [index, keeper] of resolvedKeepers.entries()) {
      if (expectedPicksWithinWindow.some(([slotIndex]) => slotIndex === index)) continue;
      expect(historyByPlayerId.has(keeper.playerId)).toBe(false);
      expect(deriveDraftState(state).draftedPlayerIds.has(keeper.playerId)).toBe(true);
    }
    for (const keeper of state.preloadedKeepers) {
      expect(deriveDraftState(state).draftedPlayerIds.has(keeper.playerId)).toBe(true);
    }
    expect(deriveDraftState(state).myRoster.RB).toEqual(['keeper-4', 'candidate-21']);
    expect(deriveDraftState(state).myRoster).toEqual(deriveDraftState(state).teamRosters[state.config.myPickPosition - 1]);
    expect(deriveDraftState(state).currentPick).toBe(31);
  });

  it('prevents a provider snapshot containing reserved keepers from importing them again', () => {
    draftStore.getState().preloadKeepers(resolvedKeepers);

    draftStore.getState().reconcileSyncedPicks([
      {
        pickNumber: 1,
        playerId: 'fresh-1',
        playerName: 'Fresh One',
        position: 'WR',
        teamIndex: 0,
        teamName: 'Team 1',
        isMyPick: false,
      },
      {
        pickNumber: 7,
        playerId: 'keeper-6',
        playerName: 'Jonathan Taylor',
        position: 'RB',
        teamIndex: 6,
        teamName: 'Team 7',
        isMyPick: false,
      },
      {
        pickNumber: 9,
        playerId: 'keeper-8',
        playerName: 'Puka Nacua',
        position: 'WR',
        teamIndex: 8,
        teamName: 'Team 9',
        isMyPick: false,
      },
      {
        pickNumber: 96,
        playerId: 'keeper-4',
        playerName: 'Javonte Williams',
        position: 'RB',
        teamIndex: 4,
        teamName: 'My Team',
        isMyPick: true,
      },
    ], 10);

    const state = draftStore.getState();
    for (const keeperId of keeperPlayerIds) {
      const representations = state.draftHistory.filter(
        (pick) => pick.playerId === keeperId
      );
      expect(representations).toHaveLength(0);
    }
    expect(deriveDraftState(state).draftedPlayerIds.size).toBe(KEEPER_FIXTURE.length + 1);
    expect(deriveDraftState(state).myRoster.RB).toEqual(['keeper-4']);

    draftStore.getState().markPlayerDrafted(
      'keeper-4',
      'Javonte Williams',
      'RB',
      4,
      'My Team',
      96,
      'sync'
    );
    const afterImport = draftStore.getState();
    expect(afterImport.draftHistory.some((pick) => pick.playerId === 'keeper-4')).toBe(false);
    expect(deriveDraftState(afterImport).myRoster.RB).toEqual(['keeper-4']);
  });

  it('preserves the confirmed keeper baseline across resets and mode changes', () => {
    draftStore.getState().preloadKeepers(resolvedKeepers);
    draftStore.getState().setSessionMode('mock');
    draftStore.getState().markPlayerDrafted('candidate-0', 'Candidate Zero', 'WR', 0, 'Team 1');
    draftStore.getState().resetDraft();

    let state = draftStore.getState();
    expect(state.sessionMode).toBe('mock');
    expect(state.draftHistory).toHaveLength(0);
    expect(deriveDraftState(state).currentPick).toBe(1);
    expect(deriveDraftState(state).draftedPlayerIds.size).toBe(KEEPER_FIXTURE.length);
    expect(deriveDraftState(state).myRoster.RB).toEqual(['keeper-4']);
    expect(state.preloadedKeepers).toHaveLength(KEEPER_FIXTURE.length);

    draftStore.getState().setSessionMode('live');
    draftStore.getState().setConfig({ myPickPosition: 3 });
    state = draftStore.getState();
    expect(deriveDraftState(state).draftedPlayerIds.size).toBe(KEEPER_FIXTURE.length);
    // Slot 3 inherits team 3's keeper (Quinshon Judkins) without duplication.
    expect(deriveDraftState(state).myRoster.RB).toEqual(['keeper-2']);
    expect(state.preloadedKeepers).toHaveLength(KEEPER_FIXTURE.length);

    draftStore.getState().setSessionMode('setup');
    draftStore.getState().setConfig({ myPickPosition: 5 });
    expect(deriveDraftState(draftStore.getState()).myRoster.RB).toEqual(['keeper-4']);
  });
});


describe('keeper supply after a league size change', () => {
  it.each([
    { initialTeams: 12, teamIndex: 11, initialRounds: 15, round: 2, next: { totalTeams: 10 } },
    { initialTeams: 10, teamIndex: 1, initialRounds: 15, round: 15, next: { totalRounds: 14 } },
  ])('invalidates reservations outside the new config $next', ({ initialTeams, teamIndex, initialRounds, round, next }) => {
    const store = createDraftStore();
    store.getState().setConfig({ totalTeams: initialTeams, totalRounds: initialRounds });
    store.getState().preloadKeepers([entry('keeper', 'Keeper', 'WR', teamIndex, round)]);
    expect(deriveDraftState(store.getState()).draftedPlayerIds.has('keeper')).toBe(true);
    expect(() => { store.getState().setConfig(next); }).not.toThrow();
    expect(store.getState().preloadedKeepers).toEqual([]);
    expect(store.getState().keepersInitialized).toBe(false);
    expect(deriveDraftState(store.getState()).draftedPlayerIds.has('keeper')).toBe(false);
  });
});
