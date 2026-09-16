import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_ROSTER_REQUIREMENTS,
  type Player,
  type PositionNeed,
} from '@fantasy-draft/shared';
import {
  canonicalizeKeeperSupply,
  isKeeperSupplyComplete,
} from './keeper-supply';
import { filterDrafted, getRecommendations } from '@/lib/calculations';
import { getPickNumberForTeamRound } from '@/lib/mock-draft-engine';
import {
  createDraftDecisionOutput,
} from '@/features/recommendations/draft-decision';
import { useDraftStore } from '@/stores/draftStore';

const TOTAL_TEAMS = 10;
const TOTAL_ROUNDS = 15;

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

describe('canonicalizeKeeperSupply', () => {
  it('assigns each keeper its exact snake-draft selection at the configured round cost', () => {
    const supply = canonicalizeKeeperSupply([
      entry('jt', 'Jonathan Taylor', 'RB', 6, 1),
      entry('jsn', 'Jaxon Smith-Njigba', 'WR', 0, 2),
      entry('javonte', 'Javonte Williams', 'RB', 4, 10, true),
    ], { totalTeams: TOTAL_TEAMS, totalRounds: TOTAL_ROUNDS });

    expect(supply.duplicatePlayerIds).toEqual([]);
    expect(supply.invalidEntries).toEqual([]);
    expect(supply.conflictingEntries).toEqual([]);
    expect(supply.assignments.map((keeper) => [keeper.playerId, keeper.pickNumber])).toEqual([
      ['jt', 7],
      ['jsn', 20],
      ['javonte', 96],
    ]);
  });

  it('keeps one deterministic assignment per kept player when entries duplicate a player', () => {
    const supply = canonicalizeKeeperSupply([
      entry('dup', 'Duplicate Keeper', 'WR', 1, 3),
      entry('dup', 'Duplicate Keeper', 'WR', 1, 4),
      entry('other', 'Other Keeper', 'RB', 2, 5),
    ], { totalTeams: TOTAL_TEAMS, totalRounds: TOTAL_ROUNDS });

    expect(supply.duplicatePlayerIds).toEqual(['dup']);
    expect(supply.assignments.map((keeper) => [keeper.playerId, keeper.pickNumber])).toEqual([
      ['dup', 22],
      ['other', 43],
    ]);
  });

  it('drops entries outside the draft and resolves same-slot conflicts deterministically', () => {
    const supply = canonicalizeKeeperSupply([
      entry('late', 'Late Keeper', 'WR', 3, TOTAL_ROUNDS + 1),
      entry('bad-team', 'Bad Team Keeper', 'QB', TOTAL_TEAMS, 2),
      entry('slot-a', 'Slot A', 'RB', 2, 6),
      entry('slot-b', 'Slot B', 'TE', 2, 6),
    ], { totalTeams: TOTAL_TEAMS, totalRounds: TOTAL_ROUNDS });

    expect(supply.assignments.map((keeper) => keeper.playerId)).toEqual(['slot-a']);
    expect(supply.invalidEntries.map((keeper) => keeper.playerId)).toEqual([
      'late',
      'bad-team',
    ]);
    expect(supply.conflictingEntries.map((keeper) => keeper.playerId)).toEqual(['slot-b']);
  });

  it('requires the full current-season supply before mock recommendations can run', () => {
    const ready = {
      keepersEnabled: true,
      season: 2026,
      expectedSeason: 2026,
      isConfirmed: true,
      configuredCount: 10,
      expectedCount: 10,
      resolvedCount: 10,
      canonicalCount: 10,
      unresolvedNames: [],
      duplicateNames: [],
      invalidAssignments: [],
    } as const;

    expect(isKeeperSupplyComplete(ready)).toBe(true);
    expect(isKeeperSupplyComplete({ ...ready, season: 2025 })).toBe(false);
    expect(isKeeperSupplyComplete({ ...ready, configuredCount: 9 })).toBe(false);
    expect(isKeeperSupplyComplete({
      ...ready,
      canonicalCount: 9,
      invalidAssignments: ['Player, team 2, round 4'],
    })).toBe(false);
  });
});

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
    ecrRank,
    positionalRank: ecrRank,
    sleeperAdp: ecrRank,
    valueScore: 0,
    marketRank: ecrRank,
    marketAdp: ecrRank,
    marketAdpTrend: 0,
    isContractYear: false,
    offensiveEnvironmentScore: 5,
    projectedPoints: 200 - ecrRank,
    valueOverReplacement: Math.max(0, 20 - ecrRank / 5),
    tier: 1,
    tierDropoffScore: 0.8,
    nextPickSurvivalProbability: 0.5,
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
describe('Primary League keeper supply end-to-end', () => {
  const pool = buildPrimaryLeaguePool();
  const resolvedKeepers = resolveFixtureKeepers(pool);
  const keeperPlayerIds = new Set(resolvedKeepers.map((keeper) => keeper.playerId));

  const resetStore = (): void => {
    useDraftStore.getState().setSessionMode('setup');
    useDraftStore.getState().setConfig({
      totalTeams: TOTAL_TEAMS,
      totalRounds: TOTAL_ROUNDS,
      myPickPosition: 5,
      rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS,
    });
    useDraftStore.getState().preloadKeepers([]);
    useDraftStore.getState().resetDraft();
  };

  const availablePlayers = () => {
    const state = useDraftStore.getState();
    return filterDrafted(
      pool,
      state.draftedPlayerIds,
      [...state.draftHistory, ...state.preloadedKeepers]
    );
  };

  const decisionOutputForBothLenses = () => {
    const needs = createNeeds([
      { position: 'RB', priority: 'critical' },
      { position: 'WR', priority: 'critical' },
    ]);
    const bestPick = getRecommendations(availablePlayers(), needs, 10, {
      architecture: 'pick-ev',
      currentPick: useDraftStore.getState().currentPick,
      totalPicks: TOTAL_TEAMS * TOTAL_ROUNDS,
      totalTeams: TOTAL_TEAMS,
      rosterCounts: { RB: 0, WR: 0 },
    });
    return createDraftDecisionOutput(
      bestPick.draftNow,
      bestPick.selection,
      bestPick.bestAvailable,
      'best-pick'
    );
  };

  beforeEach(resetStore);

  it('reserves every confirmed keeper before ordinary picks and hides them from both lenses', () => {
    useDraftStore.getState().preloadKeepers(resolvedKeepers);

    const state = useDraftStore.getState();
    expect(state.preloadedKeepers).toHaveLength(KEEPER_FIXTURE.length);
    expect(state.currentPick).toBe(1);
    expect(state.draftHistory).toHaveLength(0);
    expect([...state.draftedPlayerIds].sort()).toEqual(
      [...keeperPlayerIds].sort()
    );
    expect(state.myRoster.RB).toEqual(['keeper-4']);

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
    useDraftStore.getState().preloadKeepers(resolvedKeepers);

    let candidateIndex = 0;
    for (let pickNumber = 1; pickNumber <= 30; pickNumber += 1) {
      const state = useDraftStore.getState();
      const keeperAtPick = state.preloadedKeepers.find(
        (keeper) =>
          getPickNumberForTeamRound(keeper.teamIndex, keeper.round, TOTAL_TEAMS) === pickNumber
      );

      if (keeperAtPick) {
        useDraftStore.getState().consumeKeeperAtCurrentPick();
        expect(useDraftStore.getState().currentPick).toBe(pickNumber + 1);
        continue;
      }

      const candidate = pool.find((player) => player.id === `candidate-${String(candidateIndex)}`);
      candidateIndex += 1;
      if (!candidate) throw new Error('Ran out of candidates');
      const teamIndex = (pickNumber - 1) % TOTAL_TEAMS;
      useDraftStore.getState().markPlayerDrafted(
        candidate.id,
        candidate.name,
        candidate.position,
        teamIndex,
        `Team ${String(teamIndex + 1)}`
      );
    }

    const state = useDraftStore.getState();
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
      expect(state.draftedPlayerIds.has(keeper.playerId)).toBe(true);
    }
    for (const keeper of state.preloadedKeepers) {
      expect(state.draftedPlayerIds.has(keeper.playerId)).toBe(true);
    }
    // My roster keeps Javonte from initialization even before his pick arrives.
    expect(state.myRoster.RB).toEqual(['keeper-4']);
    expect(state.currentPick).toBe(31);
  });

  it('prevents a provider snapshot containing reserved keepers from importing them again', () => {
    useDraftStore.getState().preloadKeepers(resolvedKeepers);

    useDraftStore.getState().reconcileSyncedPicks([
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

    const state = useDraftStore.getState();
    for (const keeperId of keeperPlayerIds) {
      const representations = state.draftHistory.filter(
        (pick) => pick.playerId === keeperId
      );
      expect(representations).toHaveLength(0);
    }
    expect(state.draftedPlayerIds.size).toBe(KEEPER_FIXTURE.length + 1);
    expect(state.myRoster.RB).toEqual(['keeper-4']);

    useDraftStore.getState().markPlayerDrafted(
      'keeper-4',
      'Javonte Williams',
      'RB',
      4,
      'My Team',
      96,
      'sync'
    );
    const afterImport = useDraftStore.getState();
    expect(afterImport.draftHistory.some((pick) => pick.playerId === 'keeper-4')).toBe(false);
    expect(afterImport.myRoster.RB).toEqual(['keeper-4']);
  });

  it('preserves the confirmed keeper baseline across resets and mode changes', () => {
    useDraftStore.getState().preloadKeepers(resolvedKeepers);
    useDraftStore.getState().setSessionMode('mock');
    useDraftStore.getState().markPlayerDrafted('candidate-0', 'Candidate Zero', 'WR', 0, 'Team 1');
    useDraftStore.getState().resetDraft();

    let state = useDraftStore.getState();
    expect(state.sessionMode).toBe('mock');
    expect(state.draftHistory).toHaveLength(0);
    expect(state.currentPick).toBe(1);
    expect(state.draftedPlayerIds.size).toBe(KEEPER_FIXTURE.length);
    expect(state.myRoster.RB).toEqual(['keeper-4']);
    expect(state.preloadedKeepers).toHaveLength(KEEPER_FIXTURE.length);

    useDraftStore.getState().setSessionMode('live');
    useDraftStore.getState().setConfig({ myPickPosition: 3 });
    state = useDraftStore.getState();
    expect(state.draftedPlayerIds.size).toBe(KEEPER_FIXTURE.length);
    // Slot 3 inherits team 3's keeper (Quinshon Judkins) without duplication.
    expect(state.myRoster.RB).toEqual(['keeper-2']);
    expect(state.preloadedKeepers).toHaveLength(KEEPER_FIXTURE.length);

    useDraftStore.getState().setSessionMode('setup');
    useDraftStore.getState().setConfig({ myPickPosition: 5 });
    expect(useDraftStore.getState().myRoster.RB).toEqual(['keeper-4']);
  });
});
