import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DEFAULT_ROSTER_REQUIREMENTS,
  DEFAULT_SCORING_RULES,
  createLeagueSettings,
  type Player,
  type Position,
  type Roster,
} from '@fantasy-draft/shared';
import {
  calculateAllScarcityScores,
  calculateTeamNeeds,
  getRecommendations,
} from '@/lib/calculations';
import { createDraftDecisionOutput } from '@/features/recommendations/draft-decision';
import { getDraftSynchronizationState } from '@/hooks/useDraftSync';
import { hasRemainingDraftDecision } from '@/hooks/useRecommendations';
import {
  getPickNumberForTeamRound,
  getTeamIndexForPick,
} from '@/lib/mock-draft-engine';
import {
  calculateIsMyTurn,
  useDraftStore,
  type DraftTeamRoster,
  type PreloadedKeeper,
  type SyncedImportedPick,
} from '@/stores/draftStore';
import { ReconciliationSummary } from './ReconciliationSummary';

const TOTAL_TEAMS = 10;
const TOTAL_ROUNDS = 14;
const TOTAL_PICKS = TOTAL_TEAMS * TOTAL_ROUNDS;
const MY_PICK_POSITION = 5;
const TEAM_TARGET: Readonly<Record<Position, number>> = {
  QB: 2,
  RB: 4,
  WR: 5,
  TE: 2,
  K: 1,
  DEF: 0,
};
const POSITION_ORDER: readonly Position[] = [
  'RB', 'WR', 'RB', 'WR', 'TE', 'QB', 'WR',
  'RB', 'WR', 'TE', 'QB', 'RB', 'WR', 'K',
];

const KEEPERS: readonly PreloadedKeeper[] = [
  { playerId: 'keeper-jsn', playerName: 'Jaxon Smith-Njigba', position: 'WR', teamIndex: 0, round: 2, isMyKeeper: false },
  { playerId: 'keeper-egbuka', playerName: 'Emeka Egbuka', position: 'WR', teamIndex: 1, round: 8, isMyKeeper: false },
  { playerId: 'keeper-judkins', playerName: 'Quinshon Judkins', position: 'RB', teamIndex: 2, round: 7, isMyKeeper: false },
  { playerId: 'keeper-dowdle', playerName: 'Rico Dowdle', position: 'RB', teamIndex: 3, round: 14, isMyKeeper: false },
  { playerId: 'keeper-javonte', playerName: 'Javonte Williams', position: 'RB', teamIndex: 4, round: 10, isMyKeeper: true },
  { playerId: 'keeper-hampton', playerName: 'Omarion Hampton', position: 'RB', teamIndex: 5, round: 3, isMyKeeper: false },
  { playerId: 'keeper-taylor', playerName: 'Jonathan Taylor', position: 'RB', teamIndex: 6, round: 1, isMyKeeper: false },
  { playerId: 'keeper-etienne', playerName: 'Travis Etienne Jr.', position: 'RB', teamIndex: 7, round: 9, isMyKeeper: false },
  { playerId: 'keeper-puka', playerName: 'Puka Nacua', position: 'WR', teamIndex: 8, round: 1, isMyKeeper: false },
  { playerId: 'keeper-cook', playerName: 'James Cook III', position: 'RB', teamIndex: 9, round: 3, isMyKeeper: false },
];

interface ScheduledPick {
  readonly pickNumber: number;
  readonly player: Player;
  readonly teamIndex: number;
  readonly isKeeper: boolean;
}

export interface PrimaryLeagueRehearsalResult {
  readonly generatedAt: string;
  readonly status: 'passed' | 'failed';
  readonly configuration: {
    readonly totalTeams: number;
    readonly totalRounds: number;
    readonly totalPicks: number;
    readonly keeperCount: number;
    readonly scoring: {
      readonly reception: number;
      readonly tightEndPremium: number;
      readonly rushAttemptBonus: number;
    };
  };
  readonly transitions: {
    readonly observed: number;
    readonly recommendationChecks: number;
    readonly waitingRecommendationChecks: number;
    readonly noDecisionChecks: number;
    readonly synchronizationStates: readonly string[];
  };
  readonly reconciliation: {
    readonly confirmations: number;
    readonly corrections: number;
    readonly removals: number;
    readonly visibleOutcomes: readonly string[];
  };
  readonly completion: {
    readonly canonicalPicks: number;
    readonly providerPicks: number;
    readonly keeperPicks: number;
    readonly missedPickNumbers: readonly number[];
    readonly duplicatePickNumbers: readonly number[];
    readonly duplicatePlayerIds: readonly string[];
    readonly rosterMismatches: readonly string[];
    readonly remainingAvailablePlayerIds: readonly string[];
    readonly currentPick: number;
  };
  readonly failures: readonly string[];
}

function createPlayer(
  id: string,
  name: string,
  position: Position,
  ecrRank: number,
  positionalRank: number
): Player {
  const baseline: Readonly<Record<Position, number>> = {
    QB: 340,
    RB: 285,
    WR: 280,
    TE: 245,
    K: 155,
    DEF: 145,
  };
  const projectedPoints = baseline[position] - positionalRank * 2;
  const valueOverReplacement = Math.max(1, 70 - positionalRank * 2.5);
  return {
    id,
    name,
    position,
    team: 'DET',
    byeWeek: 6,
    ecrRank,
    positionalRank,
    sleeperAdp: ecrRank + 2,
    consensusAdp: ecrRank + 1,
    valueScore: 1,
    marketRank: ecrRank + 1,
    marketAdp: ecrRank + 1,
    marketAdpTrend: 0,
    isContractYear: false,
    offensiveEnvironmentScore: 6,
    projectedPoints,
    valueOverReplacement,
    tier: Math.ceil(positionalRank / 6),
    tierSource: 'league-projection',
    tierDropoffScore: positionalRank % 6 === 0 ? 0.8 : 0.2,
    tierDropoffPoints: positionalRank % 6 === 0 ? 8 : 2,
    nextPickSurvivalProbability: Math.max(0.05, 0.82 - ecrRank / 220),
    ceilingScore: 8,
    floorScore: 6,
    upsideScore: 7,
    uncertaintyScore: 3,
    injuryRiskScore: 2,
    predictionSource: 'fantasypros',
    newsStatus: 'healthy',
    stackPartnerTeam: 'DET',
    highlightLevel: 'neutral',
  };
}

function buildSchedule(): {
  readonly picks: readonly ScheduledPick[];
  readonly provisionalPlayers: readonly Player[];
} {
  const keeperByPick = new Map(KEEPERS.map((keeper) => [
    getPickNumberForTeamRound(keeper.teamIndex, keeper.round, TOTAL_TEAMS),
    keeper,
  ]));
  const positionQueues = Array.from({ length: TOTAL_TEAMS }, (_, teamIndex) => {
    const queue = [...POSITION_ORDER];
    const keeper = KEEPERS.find((candidate) => candidate.teamIndex === teamIndex);
    if (!keeper) throw new Error(`Missing deterministic keeper for team ${String(teamIndex + 1)}.`);
    const keeperPositionIndex = queue.indexOf(keeper.position);
    if (keeperPositionIndex < 0) {
      throw new Error(`Keeper position ${keeper.position} is absent from the roster plan.`);
    }
    queue.splice(keeperPositionIndex, 1);
    return queue;
  });
  const positionalRanks: Record<Position, number> = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    K: 0,
    DEF: 0,
  };
  const picks: ScheduledPick[] = [];

  for (let pickNumber = 1; pickNumber <= TOTAL_PICKS; pickNumber += 1) {
    const teamIndex = getTeamIndexForPick(pickNumber, TOTAL_TEAMS);
    const keeper = keeperByPick.get(pickNumber);
    const position = keeper?.position ?? positionQueues[teamIndex]?.shift();
    if (!position) throw new Error(`No position planned for pick ${String(pickNumber)}.`);
    positionalRanks[position] += 1;
    picks.push({
      pickNumber,
      teamIndex,
      isKeeper: keeper !== undefined,
      player: createPlayer(
        keeper?.playerId ?? `scheduled-${String(pickNumber)}`,
        keeper?.playerName ?? `Scheduled Player ${String(pickNumber)}`,
        position,
        pickNumber,
        positionalRanks[position]
      ),
    });
  }

  const provisionalPlayers = [
    createPlayer('provisional-conflict', 'Conflicting Local Observation', 'WR', 500, positionalRanks.WR + 1),
    createPlayer('provisional-extra', 'Extra Local Observation', 'RB', 501, positionalRanks.RB + 1),
  ];
  return { picks, provisionalPlayers };
}

function toProviderPick(pick: ScheduledPick): SyncedImportedPick {
  return {
    pickNumber: pick.pickNumber,
    playerId: pick.player.id,
    playerName: pick.player.name,
    position: pick.player.position,
    teamIndex: pick.teamIndex,
    teamName: pick.teamIndex === MY_PICK_POSITION - 1
      ? 'My Team'
      : `Team ${String(pick.teamIndex + 1)}`,
    isMyPick: pick.teamIndex === MY_PICK_POSITION - 1,
  };
}

function rosterSize(roster: Roster): number {
  return (Object.values(roster) as readonly (readonly string[])[]).reduce(
    (total, players) => total + players.length,
    0
  );
}

function emptyRoster(): DraftTeamRoster {
  return { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
}

function nextOpenPick(
  pickNumber: number,
  keeperPickNumbers: ReadonlySet<number>
): number {
  let nextPick = pickNumber + 1;
  while (nextPick <= TOTAL_PICKS && keeperPickNumbers.has(nextPick)) {
    nextPick += 1;
  }
  return nextPick;
}

function repeatedNumbers(values: readonly number[]): number[] {
  const seen = new Set<number>();
  const repeated = new Set<number>();
  values.forEach((value) => {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  });
  return [...repeated].sort((left, right) => left - right);
}

function repeatedStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  values.forEach((value) => {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  });
  return [...repeated].sort();
}

function compareRosters(
  expected: readonly DraftTeamRoster[],
  actual: readonly DraftTeamRoster[]
): string[] {
  const mismatches: string[] = [];
  expected.forEach((expectedRoster, teamIndex) => {
    const actualRoster = actual[teamIndex];
    if (!actualRoster) {
      mismatches.push(`Team ${String(teamIndex + 1)} is missing.`);
      return;
    }
    for (const position of Object.keys(TEAM_TARGET) as Position[]) {
      const expectedIds = [...expectedRoster[position]].sort();
      const actualIds = [...actualRoster[position]].sort();
      if (expectedIds.join('\0') !== actualIds.join('\0')) {
        mismatches.push(`Team ${String(teamIndex + 1)} ${position} differs.`);
      }
    }
    const actualTotal = rosterSize(actualRoster);
    if (actualTotal !== TOTAL_ROUNDS) {
      mismatches.push(`Team ${String(teamIndex + 1)} has ${String(actualTotal)} players.`);
    }
    for (const position of Object.keys(TEAM_TARGET) as Position[]) {
      if (actualRoster[position].length !== TEAM_TARGET[position]) {
        mismatches.push(
          `Team ${String(teamIndex + 1)} has ${String(actualRoster[position].length)} ${position}, expected ${String(TEAM_TARGET[position])}.`
        );
      }
    }
  });
  return mismatches;
}

export function runPrimaryLeagueRehearsal(
  now: number = Date.now()
): PrimaryLeagueRehearsalResult {
  const failures: string[] = [];
  const failUnless = (condition: boolean, message: string): void => {
    if (!condition) failures.push(message);
  };
  const { picks, provisionalPlayers } = buildSchedule();
  const allPlayers = [...picks.map((pick) => pick.player), ...provisionalPlayers];
  const playersById = new Map(allPlayers.map((player) => [player.id, player]));
  const providerSchedule = picks.filter((pick) => !pick.isKeeper);
  const providerPicks: SyncedImportedPick[] = [];
  const keeperPickNumbers = new Set(
    picks.filter((pick) => pick.isKeeper).map((pick) => pick.pickNumber)
  );
  const expectedRosters = Array.from({ length: TOTAL_TEAMS }, emptyRoster);
  picks.forEach((pick) => {
    expectedRosters[pick.teamIndex]?.[pick.player.position].push(pick.player.id);
  });

  const leagueSettings = createLeagueSettings({
    source: 'sleeper',
    leagueId: 'deterministic-primary-league',
    totalTeams: TOTAL_TEAMS,
    scoringRules: DEFAULT_SCORING_RULES,
    rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS,
    keepersEnabled: true,
  }, now);
  const store = useDraftStore.getState();
  store.preloadKeepers([]);
  store.setConfig({
    totalTeams: TOTAL_TEAMS,
    totalRounds: TOTAL_ROUNDS,
    myPickPosition: MY_PICK_POSITION,
    rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS,
  });
  store.applyLeagueSettings(leagueSettings);
  store.setSessionMode('live');
  store.preloadKeepers(KEEPERS);
  store.resetDraft();
  store.setDecisionLens('best-pick');

  failUnless(useDraftStore.getState().keepersInitialized, 'Keeper supply did not initialize.');
  failUnless(useDraftStore.getState().preloadedKeepers.length === 10, 'Keeper supply did not contain 10 assignments.');
  failUnless(leagueSettings.scoringRules.receiving.reception === 1, 'Full PPR was not applied.');
  failUnless(leagueSettings.scoringRules.receiving.tePremium === 0.5, 'TE premium was not applied.');
  failUnless(leagueSettings.scoringRules.rushing.attemptBonus === 0.2, 'Rush-attempt scoring was not applied.');

  let observedTransitions = 0;
  let recommendationChecks = 0;
  let waitingRecommendationChecks = 0;
  let noDecisionChecks = 0;
  const synchronizationStates: string[] = [
    getDraftSynchronizationState('connected'),
  ];

  const observeDecision = (label: string): void => {
    observedTransitions += 1;
    const state = useDraftStore.getState();
    const myRosterSize = rosterSize(state.myRoster);
    const shouldRecommend = hasRemainingDraftDecision(
      state.currentPick,
      TOTAL_PICKS,
      myRosterSize,
      TOTAL_ROUNDS
    );
    if (!shouldRecommend) {
      noDecisionChecks += 1;
      return;
    }

    const availablePlayers = allPlayers.filter(
      (player) => !state.draftedPlayerIds.has(player.id)
    );
    const managerIsOnTheClock = calculateIsMyTurn(
      state.currentPick,
      state.config.myPickPosition,
      state.config.totalTeams
    );
    const scarcity = calculateAllScarcityScores(availablePlayers);
    const needs = calculateTeamNeeds(
      state.myRoster,
      state.config.rosterRequirements,
      scarcity,
      {
        currentPick: state.currentPick,
        totalPicks: TOTAL_PICKS,
        totalRounds: TOTAL_ROUNDS,
      }
    );
    const rosterPlayers = (Object.values(state.myRoster) as string[][]).flatMap((ids) =>
      ids.flatMap((id) => {
        const player = playersById.get(id);
        return player
          ? [{
              id: player.id,
              position: player.position,
              projectedPoints: player.projectedPoints,
              ceilingScore: player.ceilingScore,
            }]
          : [];
      })
    );
    const recommendations = getRecommendations(availablePlayers, needs, 10, {
      currentPick: state.currentPick,
      totalPicks: TOTAL_PICKS,
      totalTeams: TOTAL_TEAMS,
      isMyTurn: managerIsOnTheClock,
      architecture: 'best-pick-policy',
      requirements: state.config.rosterRequirements,
      rosterPlayers,
      selectionsRemaining: TOTAL_ROUNDS - myRosterSize,
      rosterCounts: {
        QB: state.myRoster.QB.length,
        RB: state.myRoster.RB.length,
        WR: state.myRoster.WR.length,
        TE: state.myRoster.TE.length,
        K: state.myRoster.K.length,
        DEF: state.myRoster.DEF.length,
      },
    });
    const decision = createDraftDecisionOutput(
      recommendations.draftNow,
      recommendations.selection,
      recommendations.bestAvailable,
      state.decisionLens
    );
    recommendationChecks += 1;
    if (!managerIsOnTheClock) waitingRecommendationChecks += 1;
    failUnless(decision.bestPick !== null, `${label}: Best Pick is missing.`);
    failUnless(decision.bestPlayer !== null, `${label}: Best Player is missing.`);
    failUnless(decision.selected?.playerId === decision.bestPick?.playerId, `${label}: Best Pick is not selected.`);
    failUnless(
      decision.bestPick === null || !state.draftedPlayerIds.has(decision.bestPick.playerId),
      `${label}: Best Pick is already drafted.`
    );
    failUnless(
      decision.bestPlayer === null || !state.draftedPlayerIds.has(decision.bestPlayer.playerId),
      `${label}: Best Player is already drafted.`
    );
    failUnless(
      decision.bestPick?.decisionFactors !== undefined,
      `${label}: Best Pick has no decision evidence.`
    );
    failUnless(
      (decision.bestPick?.reason.trim().length ?? 0) > 0,
      `${label}: Best Pick has no explanation.`
    );
  };

  observeDecision('Initial keeper state');

  for (const scheduled of providerSchedule.filter((pick) => pick.pickNumber <= 64)) {
    providerPicks.push(toProviderPick(scheduled));
    useDraftStore.getState().reconcileSyncedPicks(
      providerPicks,
      nextOpenPick(scheduled.pickNumber, keeperPickNumbers)
    );
    observeDecision(`Provider pick ${String(scheduled.pickNumber)}`);
  }

  synchronizationStates.push(getDraftSynchronizationState('reconnecting'));
  synchronizationStates.push(getDraftSynchronizationState('reconnecting', true));
  const matchingPick = providerSchedule.find((pick) => pick.pickNumber === 65);
  const conflictingProviderPick = providerSchedule.find((pick) => pick.pickNumber === 66);
  const removedLocalSlot = providerSchedule.find((pick) => pick.pickNumber === 68);
  if (!matchingPick || !conflictingProviderPick || !removedLocalSlot) {
    throw new Error('The deterministic outage window overlaps a keeper slot.');
  }
  const conflictingLocalPlayer = provisionalPlayers[0];
  const extraLocalPlayer = provisionalPlayers[1];
  if (!conflictingLocalPlayer || !extraLocalPlayer) {
    throw new Error('The deterministic Provisional Pick fixtures are missing.');
  }
  const recordProvisional = (
    scheduled: ScheduledPick,
    player: Player
  ): boolean => useDraftStore.getState().recordProvisionalPick({
    pickNumber: scheduled.pickNumber,
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    teamIndex: scheduled.teamIndex,
    teamName: scheduled.teamIndex === MY_PICK_POSITION - 1
      ? 'My Team'
      : `Team ${String(scheduled.teamIndex + 1)}`,
  });
  failUnless(recordProvisional(matchingPick, matchingPick.player), 'Matching Provisional Pick was rejected.');
  observeDecision('Matching Provisional Pick');
  failUnless(recordProvisional(conflictingProviderPick, conflictingLocalPlayer), 'Conflicting Provisional Pick was rejected.');
  observeDecision('Conflicting Provisional Pick');
  failUnless(recordProvisional(removedLocalSlot, extraLocalPlayer), 'Extra Provisional Pick was rejected.');
  observeDecision('Extra Provisional Pick');

  const restoredThroughPick67 = providerSchedule.filter(
    (pick) => pick.pickNumber >= 65 && pick.pickNumber <= 67
  );
  providerPicks.push(...restoredThroughPick67.map(toProviderPick));
  synchronizationStates.push(getDraftSynchronizationState('syncing'));
  const reconciliation = useDraftStore.getState().reconcileSyncedPicks(
    providerPicks,
    68
  );
  synchronizationStates.push(getDraftSynchronizationState('connected'));
  observeDecision('Restored Provider Truth');

  const reconciliationMarkup = renderToStaticMarkup(
    React.createElement(ReconciliationSummary, {
      summary: {
        confirmedAt: now,
        confirmations: reconciliation.confirmations,
        corrections: reconciliation.corrections,
        removals: reconciliation.removals,
        unresolvedIdentities: reconciliation.unresolvedIdentities,
      },
      totalTeams: TOTAL_TEAMS,
      onDismiss: () => undefined,
    })
  );
  const visibleOutcomes = [
    ['Confirmed', 'Confirmed · 1'],
    ['Corrected', 'Corrected · 1'],
    ['Removed', 'Removed · 1'],
  ].filter(([, text]) => reconciliationMarkup.includes(text ?? ''))
    .map(([label]) => label ?? '');
  failUnless(reconciliation.confirmations.length === 1, 'Reconciliation did not confirm one matching Provisional Pick.');
  failUnless(reconciliation.corrections.length === 1, 'Reconciliation did not correct one conflicting Provisional Pick.');
  failUnless(reconciliation.removals.length === 1, 'Reconciliation did not remove one extra Provisional Pick.');
  failUnless(visibleOutcomes.length === 3, 'Reconciliation outcomes were not all visible.');

  for (const scheduled of providerSchedule.filter((pick) => pick.pickNumber >= 68)) {
    providerPicks.push(toProviderPick(scheduled));
    useDraftStore.getState().reconcileSyncedPicks(
      providerPicks,
      nextOpenPick(scheduled.pickNumber, keeperPickNumbers)
    );
    observeDecision(`Provider pick ${String(scheduled.pickNumber)}`);
  }
  synchronizationStates.push(getDraftSynchronizationState('complete'));

  const finalState = useDraftStore.getState();
  const canonicalPicks = [
    ...providerPicks.map((pick) => ({ pickNumber: pick.pickNumber, playerId: pick.playerId })),
    ...KEEPERS.map((keeper) => ({
      pickNumber: getPickNumberForTeamRound(keeper.teamIndex, keeper.round, TOTAL_TEAMS),
      playerId: keeper.playerId,
    })),
  ].sort((left, right) => left.pickNumber - right.pickNumber);
  const canonicalPickNumbers = canonicalPicks.map((pick) => pick.pickNumber);
  const canonicalPlayerIds = canonicalPicks.map((pick) => pick.playerId);
  const missedPickNumbers = Array.from({ length: TOTAL_PICKS }, (_, index) => index + 1)
    .filter((pickNumber) => !canonicalPickNumbers.includes(pickNumber));
  const duplicatePickNumbers = repeatedNumbers(canonicalPickNumbers);
  const duplicatePlayerIds = repeatedStrings(canonicalPlayerIds);
  const rosterMismatches = compareRosters(expectedRosters, finalState.teamRosters);
  const remainingAvailablePlayerIds = allPlayers
    .filter((player) => !finalState.draftedPlayerIds.has(player.id))
    .map((player) => player.id)
    .sort();

  failUnless(providerPicks.length === 130, `Expected 130 ordinary provider picks, found ${String(providerPicks.length)}.`);
  failUnless(canonicalPicks.length === TOTAL_PICKS, `Expected ${String(TOTAL_PICKS)} canonical picks, found ${String(canonicalPicks.length)}.`);
  failUnless(missedPickNumbers.length === 0, `Missed picks: ${missedPickNumbers.join(', ')}.`);
  failUnless(duplicatePickNumbers.length === 0, `Duplicate pick numbers: ${duplicatePickNumbers.join(', ')}.`);
  failUnless(duplicatePlayerIds.length === 0, `Duplicate players: ${duplicatePlayerIds.join(', ')}.`);
  failUnless(rosterMismatches.length === 0, rosterMismatches.join(' '));
  failUnless(finalState.draftHistory.length === 130, 'Final provider history does not contain 130 ordinary picks.');
  failUnless(finalState.draftHistory.every((pick) => pick.source === 'sync'), 'A provisional pick remained after final reconciliation.');
  failUnless(finalState.draftedPlayerIds.size === TOTAL_PICKS, 'Final unavailable-player set does not contain exactly 140 drafted players.');
  failUnless(finalState.currentPick === TOTAL_PICKS + 1, 'Draft did not advance to its completed cursor.');
  failUnless(
    remainingAvailablePlayerIds.join('\0') === provisionalPlayers.map((player) => player.id).sort().join('\0'),
    'The remaining available-player pool did not restore both discarded provisional players.'
  );
  failUnless(noDecisionChecks > 0, 'The completed manager roster never suppressed Recommendations.');
  failUnless(waitingRecommendationChecks > 0, 'Recommendations were not checked while the manager waited.');

  return {
    generatedAt: new Date(now).toISOString(),
    status: failures.length === 0 ? 'passed' : 'failed',
    configuration: {
      totalTeams: TOTAL_TEAMS,
      totalRounds: TOTAL_ROUNDS,
      totalPicks: TOTAL_PICKS,
      keeperCount: KEEPERS.length,
      scoring: {
        reception: leagueSettings.scoringRules.receiving.reception,
        tightEndPremium: leagueSettings.scoringRules.receiving.tePremium,
        rushAttemptBonus: leagueSettings.scoringRules.rushing.attemptBonus,
      },
    },
    transitions: {
      observed: observedTransitions,
      recommendationChecks,
      waitingRecommendationChecks,
      noDecisionChecks,
      synchronizationStates,
    },
    reconciliation: {
      confirmations: reconciliation.confirmations.length,
      corrections: reconciliation.corrections.length,
      removals: reconciliation.removals.length,
      visibleOutcomes,
    },
    completion: {
      canonicalPicks: canonicalPicks.length,
      providerPicks: providerPicks.length,
      keeperPicks: KEEPERS.length,
      missedPickNumbers,
      duplicatePickNumbers,
      duplicatePlayerIds,
      rosterMismatches,
      remainingAvailablePlayerIds,
      currentPick: finalState.currentPick,
    },
    failures,
  };
}
