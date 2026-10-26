import { asProbability, asRank, asVor } from '@fantasy-draft/shared/units';
import { deriveDraftState } from '@/stores/draft/source';
import { DRAFT_DISPLAY } from '@/lib/demo-mode';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '@fantasy-draft/shared/league';
import type { PositionNeed } from '@fantasy-draft/shared/draft';
import {
  calculateTeamNeeds,
  filterDrafted,
  getRecommendations,
  createDraftDecisionOutput,
} from '@fantasy-draft/shared/draft';
import { getDraftSynchronizationState } from '@/hooks/useDraftSync';
import { createDraftStore } from '@/stores/draftStore';
const draftStore = createDraftStore();
import { createConnectionTestDriver } from '@/workspace/connection-test-driver';
const connectionStore = createConnectionTestDriver({ initialConnection: null, persist: () => undefined });
import { blocksProviderIdentityRecommendations } from '@/features/recommendations/DraftDecisionContext';
import { ProviderIdentityBlockedNotice } from './ProviderIdentityBlockedNotice';
import { ReconciliationSummary } from './ReconciliationSummary';

function player(
  id: string,
  name: string,
  position: Player['position'],
  ecrRank: number,
  valueOverReplacement: number
): Player {
  return {
    id,
    name,
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
    projectedPoints: 200 + valueOverReplacement,
    valueOverReplacement: asVor(valueOverReplacement),
    tier: 1,
    tierDropoffScore: 0.5,
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

const PLAYERS: readonly Player[] = [
  player('ecr-leader', 'ECR Leader', 'WR', 1, 2),
  player('roster-rb', 'Roster Builder', 'RB', 2, 45),
  player('next-wr', 'Next Receiver', 'WR', 3, 12),
];

const NEEDS: readonly PositionNeed[] = [
  {
    position: 'RB',
    priority: 'critical',
    startersFilled: 0,
    startersNeeded: 2,
    flexSlotsFilled: 0,
    flexSlotsNeeded: 2,
    isFlexEligible: true,
    scarcityScore: 9,
  },
  {
    position: 'WR',
    priority: 'low',
    startersFilled: 2,
    startersNeeded: 2,
    flexSlotsFilled: 2,
    flexSlotsNeeded: 2,
    isFlexEligible: true,
    scarcityScore: 2,
  },
];

function calculateFromDraftState(players: readonly Player[] = PLAYERS) {
  const state = draftStore.getState();
  const rosterSize = (Object.values(deriveDraftState(state).myRoster) as string[][]).reduce(
    (total, playerIds) => total + playerIds.length,
    0
  );
  const availablePlayers = filterDrafted(
    [...players],
    deriveDraftState(state).draftedPlayerIds,
    state.draftHistory
  );
  const recommendations = getRecommendations(availablePlayers, NEEDS, 10, {
    currentPick: deriveDraftState(state).currentPick,
    totalPicks: state.config.totalTeams * state.config.totalRounds,
    totalTeams: state.config.totalTeams,
    isMyTurn: deriveDraftState(state).isMyTurn,
    requirements: state.config.rosterRequirements,
    rosterCounts: {
      QB: deriveDraftState(state).myRoster.QB.length,
      RB: deriveDraftState(state).myRoster.RB.length,
      WR: deriveDraftState(state).myRoster.WR.length,
      TE: deriveDraftState(state).myRoster.TE.length,
      K: deriveDraftState(state).myRoster.K.length,
      DEF: deriveDraftState(state).myRoster.DEF.length,
    },
    selectionsRemaining: state.config.totalRounds - rosterSize,
  }, DRAFT_DISPLAY);

  return createDraftDecisionOutput(
    recommendations.draftNow,
    recommendations.selection,
    recommendations.bestAvailable,
    state.decisionLens,
    DRAFT_DISPLAY
  );
}

function seedProviderTruthThroughPickFour(): void {
  draftStore.getState().reconcileSyncedPicks(
    Array.from({ length: 4 }, (_, index) => ({
      pickNumber: index + 1,
      playerId: `confirmed-${String(index + 1)}`,
      playerName: `Confirmed ${String(index + 1)}`,
      position: 'QB' as const,
      teamIndex: index,
      teamName: `Team ${String(index + 1)}`,
      isMyPick: false,
    })),
    5
  );
}

describe('Draft Workspace decision integration', () => {
  beforeEach(() => {
    connectionStore.getState().startConnection(
      'sleeper',
      'primary-league-draft'
    );
    connectionStore.getState().confirmDraftPosition(5);
    const store = draftStore.getState();
    store.preloadKeepers([]);
    store.setConfig({ totalTeams: 10, totalRounds: 15, myPickPosition: 5 });
    store.resetDraft();
    store.setDecisionLens('best-pick');
    store.setPositionFilter('WR');
    store.setSearchQuery('receiver');
    store.setSessionMode('live');
  });

  afterEach(() => {
    connectionStore.getState().disconnect();
  });

  it('updates recommendations when the decision lens or confirmed picks change', () => {
    const initial = calculateFromDraftState();
    expect(initial).toMatchObject({
      bestPick: { playerId: 'roster-rb' },
      bestPlayer: { playerId: 'ecr-leader' },
      selectedLens: 'best-pick',
      selected: { playerId: 'roster-rb' },
      decisionDivergence: true,
      decisionDivergenceFactor: 'league-value',
    });
    expect(initial.decisionDivergenceExplanation).toBe(
      'Prefer Roster Builder over ECR Leader because Roster Builder is +45 points above replacement, 43 more than ECR Leader in this league, while ECR Leader remains Best Player at ECR #1.'
    );

    const stateBeforeSwitch = draftStore.getState();
    const connectedBeforeSwitch = connectionStore.getState().connection;
    stateBeforeSwitch.setDecisionLens('best-player');
    const stateAfterSwitch = draftStore.getState();
    const switched = calculateFromDraftState();
    expect(switched.selected?.playerId).toBe('ecr-leader');
    expect(switched.bestPick?.playerId).toBe('roster-rb');
    expect(switched.bestPlayer?.playerId).toBe('ecr-leader');
    expect(deriveDraftState(stateAfterSwitch).currentPick).toBe(deriveDraftState(stateBeforeSwitch).currentPick);
    expect(deriveDraftState(stateAfterSwitch).myRoster).toEqual(deriveDraftState(stateBeforeSwitch).myRoster);
    expect([...deriveDraftState(stateAfterSwitch).draftedPlayerIds]).toEqual([
      ...deriveDraftState(stateBeforeSwitch).draftedPlayerIds,
    ]);
    expect(stateAfterSwitch.filter).toEqual(stateBeforeSwitch.filter);
    expect(connectionStore.getState().connection).toEqual(
      connectedBeforeSwitch
    );

    stateAfterSwitch.reconcileSyncedPicks([
      {
        pickNumber: 1,
        playerId: 'ecr-leader',
        playerName: 'ECR Leader',
        position: 'WR',
        teamIndex: 0,
        teamName: 'Team 1',
        isMyPick: false,
      },
    ], 2);
    const afterConfirmedPick = calculateFromDraftState();

    expect(deriveDraftState(draftStore.getState()).isMyTurn).toBe(false);
    expect(afterConfirmedPick.selected).not.toBeNull();
    expect(afterConfirmedPick.bestPick?.playerId).not.toBe('ecr-leader');
    expect(afterConfirmedPick.bestPlayer?.playerId).not.toBe('ecr-leader');
    expect(afterConfirmedPick.bestPlayer?.playerId).toBe('roster-rb');
  });

  it('keeps Recommendations coherent after sync loss and a Provisional Pick', () => {
    const continuityPlayers: readonly Player[] = [
      player('continuity-leader', 'Continuity Leader', 'WR', 1, 60),
      player('continuity-rb', 'Continuity Runner', 'RB', 2, 45),
      player('continuity-wr', 'Continuity Receiver', 'WR', 3, 12),
    ];
    const state = draftStore.getState();
    state.setConfig({ myPickPosition: 5 });
    state.reconcileSyncedPicks([
      {
        pickNumber: 1,
        playerId: 'confirmed-1',
        playerName: 'Confirmed 1',
        position: 'QB',
        teamIndex: 0,
        teamName: 'Team 1',
        isMyPick: false,
      },
      {
        pickNumber: 2,
        playerId: 'confirmed-2',
        playerName: 'Confirmed 2',
        position: 'QB',
        teamIndex: 1,
        teamName: 'Team 2',
        isMyPick: false,
      },
      {
        pickNumber: 3,
        playerId: 'confirmed-3',
        playerName: 'Confirmed 3',
        position: 'QB',
        teamIndex: 2,
        teamName: 'Team 3',
        isMyPick: false,
      },
      {
        pickNumber: 4,
        playerId: 'confirmed-4',
        playerName: 'Confirmed 4',
        position: 'QB',
        teamIndex: 3,
        teamName: 'Team 4',
        isMyPick: false,
      },
    ], 5);

    const before = calculateFromDraftState(continuityPlayers);
    const needsBefore = calculateTeamNeeds(
      deriveDraftState(draftStore.getState()).myRoster,
      draftStore.getState().config.rosterRequirements,
      new Map()
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect(getDraftSynchronizationState('connected')).toBe('confirmed');
    expect(getDraftSynchronizationState('reconnecting')).toBe('delayed');
    expect(getDraftSynchronizationState('reconnecting', true)).toBe(
      'manual-continuity'
    );
    expect(before.bestPick?.playerId).toBe('continuity-leader');
    expect(before.bestPlayer?.playerId).toBe('continuity-leader');

    const recorded = draftStore.getState().recordProvisionalPick({
      pickNumber: 5,
      playerId: 'continuity-leader',
      playerName: 'Continuity Leader',
      position: 'WR',
      teamIndex: 4,
      teamName: 'My Team',
    });
    const current = draftStore.getState();
    const after = calculateFromDraftState(continuityPlayers);
    const needsAfter = calculateTeamNeeds(
      deriveDraftState(current).myRoster,
      current.config.rosterRequirements,
      new Map()
    );

    expect(recorded).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(current.draftHistory.at(-1)?.source).toBe('provisional');
    expect(deriveDraftState(current).draftedPlayerIds.has('continuity-leader')).toBe(true);
    expect(deriveDraftState(current).teamRosters[4]?.WR).toContain('continuity-leader');
    expect(deriveDraftState(current).myRoster.WR).toContain('continuity-leader');
    expect(deriveDraftState(current).currentPick).toBe(6);
    expect(needsBefore.find((need) => need.position === 'WR')?.startersFilled).toBe(0);
    expect(needsAfter.find((need) => need.position === 'WR')?.startersFilled).toBe(1);
    expect(after.bestPick?.playerId).not.toBe('continuity-leader');
    expect(after.bestPlayer?.playerId).not.toBe('continuity-leader');
    expect(after.bestPick?.diagnostics?.nextPickSurvivalProbability).toBeDefined();
    expect(after.bestPlayer).not.toBeNull();

    fetchSpy.mockRestore();
  });

  it('confirms a perfect manual match without replaying the Recommendation transition', () => {
    seedProviderTruthThroughPickFour();
    expect(draftStore.getState().recordProvisionalPick({
      pickNumber: 5,
      playerId: 'ecr-leader',
      playerName: 'ECR Leader',
      position: 'WR',
      teamIndex: 4,
      teamName: 'My Team',
    })).toBe(true);
    const recommendationAfterObservation = calculateFromDraftState();
    expect(recommendationAfterObservation.bestPick?.playerId).toBe('roster-rb');
    expect(recommendationAfterObservation.bestPlayer?.playerId).toBe('roster-rb');

    const restoredProviderTruth = [
      ...Array.from({ length: 4 }, (_, index) => ({
        pickNumber: index + 1,
        playerId: `confirmed-${String(index + 1)}`,
        playerName: `Confirmed ${String(index + 1)}`,
        position: 'QB' as const,
        teamIndex: index,
        teamName: `Team ${String(index + 1)}`,
        isMyPick: false,
      })),
      {
        pickNumber: 5,
        playerId: 'ecr-leader',
        playerName: 'ECR Leader',
        position: 'WR' as const,
        teamIndex: 4,
        teamName: 'My Team',
        isMyPick: true,
      },
    ];
    let draftTransitions = 0;
    const unsubscribe = draftStore.subscribe(() => {
      draftTransitions += 1;
    });
    const confirmation = draftStore.getState().reconcileSyncedPicks(
      restoredProviderTruth,
      6
    );
    const reconciled = draftStore.getState();
    const recommendationAfterConfirmation = calculateFromDraftState();

    expect(confirmation.confirmations).toEqual([
      expect.objectContaining({
        pickNumber: 5,
        playerId: 'ecr-leader',
        playerName: 'ECR Leader',
      }),
    ]);
    expect(reconciled.draftHistory.filter(
      (pick) => pick.playerId === 'ecr-leader'
    )).toEqual([
      expect.objectContaining({ pickNumber: 5, source: 'sync' }),
    ]);
    expect(deriveDraftState(reconciled).myRoster.WR).toEqual(['ecr-leader']);
    expect(deriveDraftState(reconciled).teamRosters[4]?.WR).toEqual(['ecr-leader']);
    expect(deriveDraftState(reconciled).draftedPlayerIds.has('ecr-leader')).toBe(true);
    expect(deriveDraftState(reconciled).currentPick).toBe(6);
    expect(recommendationAfterConfirmation.bestPick?.playerId).toBe(
      recommendationAfterObservation.bestPick?.playerId
    );
    expect(recommendationAfterConfirmation.bestPlayer?.playerId).toBe(
      recommendationAfterObservation.bestPlayer?.playerId
    );
    expect(draftTransitions).toBe(1);

    const summaryMarkup = renderToStaticMarkup(
      React.createElement(ReconciliationSummary, { draftType: 'snake',
        summary: {
          confirmedAt: 200,
          confirmations: confirmation.confirmations,
          corrections: [],
          removals: [],
          unresolvedIdentities: [],
        },
        totalTeams: 10,
        onDismiss: () => undefined,
      })
    );
    expect(summaryMarkup).toContain('Provider Truth reconciled');
    expect(summaryMarkup).toContain('Confirmed · 1');
    expect(summaryMarkup).toContain('ECR Leader');
    expect(summaryMarkup).toContain('1.05 · #5');
    expect(summaryMarkup).toContain('My Team');

    const historyAfterConfirmation = reconciled.draftHistory;
    const repeat = reconciled.reconcileSyncedPicks(restoredProviderTruth, 6);
    const recommendationAfterRepeat = calculateFromDraftState();

    expect(repeat).toEqual({
      changed: false,
      confirmations: [],
      corrections: [],
      removals: [],
      unresolvedIdentities: [],
    });
    expect(draftStore.getState().draftHistory).toBe(historyAfterConfirmation);
    expect(draftTransitions).toBe(1);
    expect(recommendationAfterRepeat.bestPick?.playerId).toBe(
      recommendationAfterConfirmation.bestPick?.playerId
    );
    expect(recommendationAfterRepeat.bestPlayer?.playerId).toBe(
      recommendationAfterConfirmation.bestPlayer?.playerId
    );

    unsubscribe();
  });

  it('reconciles every Provider Truth outcome before restoring live Recommendations', () => {
    seedProviderTruthThroughPickFour();
    const confirmedBaseline = draftStore.getState().draftHistory.map((pick) => ({
      pickNumber: pick.pickNumber,
      playerId: pick.playerId,
      playerName: pick.playerName,
      position: pick.position,
      teamIndex: pick.teamIndex,
      teamName: pick.teamName,
      isMyPick: pick.teamIndex === 4,
    }));
    expect(draftStore.getState().recordProvisionalPick({
      pickNumber: 5,
      playerId: 'ecr-leader',
      playerName: 'ECR Leader',
      position: 'WR',
      teamIndex: 4,
      teamName: 'My Team',
    })).toBe(true);
    expect(draftStore.getState().recordProvisionalPick({
      pickNumber: 6,
      playerId: 'next-wr',
      playerName: 'Next Receiver',
      position: 'WR',
      teamIndex: 5,
      teamName: 'Team 6',
    })).toBe(true);
    expect(draftStore.getState().recordProvisionalPick({
      pickNumber: 8,
      playerId: 'roster-rb',
      playerName: 'Roster Builder',
      position: 'RB',
      teamIndex: 7,
      teamName: 'Team 8',
    })).toBe(true);

    const restoredProviderTruth = [
      ...confirmedBaseline.map((pick) => pick.pickNumber === 1
        ? {
            ...pick,
            playerId: 'provider-correction',
            playerName: 'Provider Correction',
          }
        : pick),
      {
        pickNumber: 5,
        playerId: 'ecr-leader',
        playerName: 'ECR Leader',
        position: 'WR' as const,
        teamIndex: 4,
        teamName: 'My Team',
        isMyPick: true,
      },
      {
        pickNumber: 6,
        playerId: 'provider-tight-end',
        playerName: 'Provider Tight End',
        position: 'TE' as const,
        teamIndex: 5,
        teamName: 'Team 6',
        isMyPick: false,
      },
    ];
    const unresolvedPick = {
      pickNumber: 7,
      playerId: 'unmapped-player-7',
      playerName: 'Unmapped Player',
      nflTeam: 'DET',
    };
    const reconciliation = draftStore.getState().reconcileSyncedPicks(
      restoredProviderTruth,
      8,
      [unresolvedPick]
    );
    const reconciled = draftStore.getState();

    expect(reconciliation.confirmations).toEqual([
      expect.objectContaining({ pickNumber: 5, playerId: 'ecr-leader' }),
    ]);
    expect(reconciliation.corrections.map((correction) => ({
      pickNumber: correction.pickNumber,
      previousPlayerId: correction.previous.playerId,
      providerPlayerId: correction.provider.playerId,
    }))).toEqual([
      {
        pickNumber: 1,
        previousPlayerId: 'confirmed-1',
        providerPlayerId: 'provider-correction',
      },
      {
        pickNumber: 6,
        previousPlayerId: 'next-wr',
        providerPlayerId: 'provider-tight-end',
      },
    ]);
    expect(reconciliation.removals).toEqual([
      expect.objectContaining({
        pickNumber: 8,
        playerId: 'roster-rb',
        source: 'provisional',
      }),
    ]);
    expect(reconciliation.unresolvedIdentities).toEqual([unresolvedPick]);
    expect(deriveDraftState(reconciled).draftedPlayerIds.has('next-wr')).toBe(false);
    expect(deriveDraftState(reconciled).draftedPlayerIds.has('roster-rb')).toBe(false);
    expect(deriveDraftState(reconciled).draftedPlayerIds.has('ecr-leader')).toBe(true);
    expect(deriveDraftState(reconciled).currentPick).toBe(8);
    expect(blocksProviderIdentityRecommendations(
      reconciled.sessionMode,
      reconciled.unresolvedProviderPicks.length
    )).toBe(true);

    const summaryMarkup = renderToStaticMarkup(
      React.createElement(ReconciliationSummary, { draftType: 'snake',
        summary: {
          confirmedAt: 300,
          confirmations: reconciliation.confirmations,
          corrections: reconciliation.corrections,
          removals: reconciliation.removals,
          unresolvedIdentities: reconciliation.unresolvedIdentities,
        },
        totalTeams: 10,
        onDismiss: () => undefined,
      })
    );
    expect(summaryMarkup).toContain('Confirmed · 1');
    expect(summaryMarkup).toContain('Corrected · 2');
    expect(summaryMarkup).toContain('Removed · 1');
    expect(summaryMarkup).toContain('Unresolved identities · 1');
    expect(summaryMarkup).toContain('Provider ID');
    expect(summaryMarkup).toContain('unmapped-player-7');

    const blockedMarkup = renderToStaticMarkup(
      React.createElement(ProviderIdentityBlockedNotice, { draftType: 'snake',
        unresolvedPicks: reconciled.unresolvedProviderPicks,
        totalTeams: 10,
      })
    );
    expect(blockedMarkup).toContain('Live recommendations paused');
    expect(blockedMarkup).toContain('Best Pick');
    expect(blockedMarkup).toContain('refresh player identity data');

    const resolvedProviderTruth = [
      ...restoredProviderTruth,
      {
        pickNumber: 7,
        playerId: 'resolved-player-7',
        playerName: 'Resolved Player',
        position: 'QB' as const,
        teamIndex: 6,
        teamName: 'Team 7',
        isMyPick: false,
      },
    ];
    expect(draftStore.getState().reconcileSyncedPicks(
      resolvedProviderTruth,
      8
    ).changed).toBe(true);
    const resolved = draftStore.getState();
    const recommendations = calculateFromDraftState();
    expect(blocksProviderIdentityRecommendations(
      resolved.sessionMode,
      resolved.unresolvedProviderPicks.length
    )).toBe(false);
    expect(recommendations.bestPick?.playerId).toBe('roster-rb');
    expect(recommendations.bestPlayer?.playerId).toBe('roster-rb');
    expect(
      recommendations.bestPick?.diagnostics?.nextPickSurvivalProbability
    ).toBeDefined();

    const canonicalHistory = resolved.draftHistory;
    expect(resolved.reconcileSyncedPicks(resolvedProviderTruth, 8).changed).toBe(false);
    expect(draftStore.getState().draftHistory).toBe(canonicalHistory);
  });

  it('rebuilds both Decision Lenses after replacing a provisional player and team', () => {
    const continuityPlayers: readonly Player[] = [
      player('continuity-leader', 'Continuity Leader', 'WR', 1, 60),
      player('continuity-rb', 'Continuity Runner', 'RB', 2, 45),
      player('continuity-wr', 'Continuity Receiver', 'WR', 3, 12),
    ];
    seedProviderTruthThroughPickFour();
    expect(draftStore.getState().recordProvisionalPick({
      pickNumber: 5,
      playerId: 'continuity-leader',
      playerName: 'Continuity Leader',
      position: 'WR',
      teamIndex: 4,
      teamName: 'My Team',
    })).toBe(true);

    const beforeCorrection = calculateFromDraftState(continuityPlayers);
    expect(beforeCorrection.bestPick?.playerId).not.toBe('continuity-leader');
    expect(beforeCorrection.bestPlayer?.playerId).not.toBe('continuity-leader');

    expect(draftStore.getState().correctProvisionalPick(5, {
      pickNumber: 6,
      playerId: 'continuity-rb',
      playerName: 'Continuity Runner',
      position: 'RB',
      teamIndex: 5,
      teamName: 'Team 6',
    })).toBe(true);

    const current = draftStore.getState();
    const afterCorrection = calculateFromDraftState(continuityPlayers);
    const needsAfterCorrection = calculateTeamNeeds(
      deriveDraftState(current).myRoster,
      current.config.rosterRequirements,
      new Map()
    );
    const corrected = current.draftHistory.find(
      (pick) => pick.pickNumber === 6
    );

    expect(deriveDraftState(current).currentPick).toBe(5);
    expect(deriveDraftState(current).draftedPlayerIds.has('continuity-leader')).toBe(false);
    expect(deriveDraftState(current).draftedPlayerIds.has('continuity-rb')).toBe(true);
    expect(deriveDraftState(current).myRoster.WR).toEqual([]);
    expect(deriveDraftState(current).teamRosters[5]?.RB).toEqual(['continuity-rb']);
    expect(corrected).toMatchObject({
      source: 'provisional',
      provisionalRevision: 1,
      teamIndex: 5,
      playerId: 'continuity-rb',
    });
    expect(needsAfterCorrection.find(
      (need) => need.position === 'WR'
    )?.startersFilled).toBe(0);
    expect(afterCorrection.bestPick?.playerId).toBe('continuity-leader');
    expect(afterCorrection.bestPlayer?.playerId).toBe('continuity-leader');
    expect(
      afterCorrection.bestPick?.diagnostics?.nextPickSurvivalProbability
    ).toBeDefined();
  });

  it('restores local draft decisions after removing an accidental Provisional Pick', () => {
    const continuityPlayers: readonly Player[] = [
      player('continuity-leader', 'Continuity Leader', 'WR', 1, 60),
      player('continuity-rb', 'Continuity Runner', 'RB', 2, 45),
      player('continuity-wr', 'Continuity Receiver', 'WR', 3, 12),
    ];
    seedProviderTruthThroughPickFour();
    const confirmedBefore = draftStore.getState().draftHistory.map(
      (pick) => ({ ...pick })
    );
    expect(draftStore.getState().recordProvisionalPick({
      pickNumber: 5,
      playerId: 'continuity-leader',
      playerName: 'Continuity Leader',
      position: 'WR',
      teamIndex: 4,
      teamName: 'My Team',
    })).toBe(true);
    expect(draftStore.getState().removeProvisionalPick(5)).toBe(true);

    const current = draftStore.getState();
    const afterRemoval = calculateFromDraftState(continuityPlayers);
    const needsAfterRemoval = calculateTeamNeeds(
      deriveDraftState(current).myRoster,
      current.config.rosterRequirements,
      new Map()
    );

    expect(current.draftHistory).toEqual(confirmedBefore);
    expect(deriveDraftState(current).currentPick).toBe(5);
    expect(deriveDraftState(current).draftedPlayerIds.has('continuity-leader')).toBe(false);
    expect(deriveDraftState(current).myRoster.WR).toEqual([]);
    expect(deriveDraftState(current).teamRosters[4]?.WR).toEqual([]);
    expect(needsAfterRemoval.find(
      (need) => need.position === 'WR'
    )?.startersFilled).toBe(0);
    expect(afterRemoval.bestPick?.playerId).toBe('continuity-leader');
    expect(afterRemoval.bestPlayer?.playerId).toBe('continuity-leader');
  });
});
