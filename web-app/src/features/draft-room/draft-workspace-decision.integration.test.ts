import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player, PositionNeed } from '@fantasy-draft/shared';
import {
  calculateTeamNeeds,
  filterDrafted,
  getRecommendations,
} from '@/lib/calculations';
import { getDraftSynchronizationState } from '@/hooks/useDraftSync';
import { useDraftStore } from '@/stores/draftStore';
import { useDraftSyncConnectionStore } from '@/stores/draftSyncStore';
import { createDraftDecisionOutput } from '@/features/recommendations/draft-decision';
import { blocksProviderIdentityRecommendations } from '@/features/recommendations/DraftDecisionContext';
import { DecisionLensSwitcher } from './DecisionLensSwitcher';
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
    ecrRank,
    positionalRank: ecrRank,
    sleeperAdp: ecrRank,
    valueScore: 0,
    marketRank: ecrRank,
    marketAdp: ecrRank,
    marketAdpTrend: 0,
    isContractYear: false,
    offensiveEnvironmentScore: 5,
    projectedPoints: 200 + valueOverReplacement,
    valueOverReplacement,
    tier: 1,
    tierDropoffScore: 0.5,
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
  const state = useDraftStore.getState();
  const rosterSize = (Object.values(state.myRoster) as string[][]).reduce(
    (total, playerIds) => total + playerIds.length,
    0
  );
  const availablePlayers = filterDrafted(
    [...players],
    state.draftedPlayerIds,
    state.draftHistory
  );
  const recommendations = getRecommendations(availablePlayers, NEEDS, 10, {
    currentPick: state.currentPick,
    totalPicks: state.config.totalTeams * state.config.totalRounds,
    totalTeams: state.config.totalTeams,
    isMyTurn: state.isMyTurn,
    architecture: 'best-pick-policy',
    requirements: state.config.rosterRequirements,
    rosterCounts: {
      QB: state.myRoster.QB.length,
      RB: state.myRoster.RB.length,
      WR: state.myRoster.WR.length,
      TE: state.myRoster.TE.length,
      K: state.myRoster.K.length,
      DEF: state.myRoster.DEF.length,
    },
    selectionsRemaining: state.config.totalRounds - rosterSize,
  });

  return createDraftDecisionOutput(
    recommendations.draftNow,
    recommendations.selection,
    recommendations.bestAvailable,
    state.decisionLens
  );
}

function seedProviderTruthThroughPickFour(): void {
  useDraftStore.getState().reconcileSyncedPicks(
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
    const store = useDraftStore.getState();
    store.preloadKeepers([]);
    store.setConfig({ totalTeams: 10, totalRounds: 15, myPickPosition: 5 });
    store.resetDraft();
    store.setDecisionLens('best-pick');
    store.setPositionFilter('WR');
    store.setSearchQuery('receiver');
    store.setSessionMode('live');
    useDraftSyncConnectionStore.getState().startConnection(
      'sleeper',
      'primary-league-draft'
    );
    useDraftSyncConnectionStore.getState().confirmDraftPosition(5);
  });

  afterEach(() => {
    useDraftSyncConnectionStore.getState().disconnect();
  });

  it('flows confirmed draft state through Recommendations and the rendered Decision Lens interface', () => {
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

    const initialMarkup = renderToStaticMarkup(
      React.createElement(DecisionLensSwitcher, {
        output: initial,
        onChange: () => undefined,
      })
    );
    expect(initialMarkup).toContain('Best Pick');
    expect(initialMarkup).toContain('Roster Builder');
    expect(initialMarkup).toContain('Best Player');
    expect(initialMarkup).toContain('ECR Leader');
    expect(initialMarkup).toContain('Decision Divergence');
    expect(initialMarkup).toContain('Preferred');
    expect(initialMarkup).toContain('43 more than ECR Leader in this league');
    expect(initialMarkup).toContain('ECR Leader remains Best Player at ECR #1');
    expect(initialMarkup).toContain('preparation, mock rehearsal, and the live Primary League draft');
    expect(initialMarkup).toContain('never submits, queues, or confirms a provider pick');

    const stateBeforeSwitch = useDraftStore.getState();
    const connectedBeforeSwitch = useDraftSyncConnectionStore.getState().connection;
    stateBeforeSwitch.setDecisionLens('best-player');
    const stateAfterSwitch = useDraftStore.getState();
    const switched = calculateFromDraftState();
    const switchedMarkup = renderToStaticMarkup(
      React.createElement(DecisionLensSwitcher, {
        output: switched,
        onChange: () => undefined,
      })
    );

    expect(switched.selected?.playerId).toBe('ecr-leader');
    expect(switched.bestPick?.playerId).toBe('roster-rb');
    expect(switched.bestPlayer?.playerId).toBe('ecr-leader');
    expect(switchedMarkup).toContain('Roster Builder');
    expect(switchedMarkup).toContain('ECR Leader');
    expect(switchedMarkup).toContain('Preferred');
    expect(switchedMarkup).toContain('Viewing');
    expect(switchedMarkup).toContain('43 more than ECR Leader in this league');
    expect(stateAfterSwitch.currentPick).toBe(stateBeforeSwitch.currentPick);
    expect(stateAfterSwitch.myRoster).toEqual(stateBeforeSwitch.myRoster);
    expect([...stateAfterSwitch.draftedPlayerIds]).toEqual([
      ...stateBeforeSwitch.draftedPlayerIds,
    ]);
    expect(stateAfterSwitch.filter).toEqual(stateBeforeSwitch.filter);
    expect(useDraftSyncConnectionStore.getState().connection).toEqual(
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

    expect(useDraftStore.getState().isMyTurn).toBe(false);
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
    const state = useDraftStore.getState();
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
      useDraftStore.getState().myRoster,
      useDraftStore.getState().config.rosterRequirements,
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

    const recorded = useDraftStore.getState().recordProvisionalPick({
      pickNumber: 5,
      playerId: 'continuity-leader',
      playerName: 'Continuity Leader',
      position: 'WR',
      teamIndex: 4,
      teamName: 'My Team',
    });
    const current = useDraftStore.getState();
    const after = calculateFromDraftState(continuityPlayers);
    const needsAfter = calculateTeamNeeds(
      current.myRoster,
      current.config.rosterRequirements,
      new Map()
    );

    expect(recorded).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(current.draftHistory.at(-1)?.source).toBe('provisional');
    expect(current.draftedPlayerIds.has('continuity-leader')).toBe(true);
    expect(current.teamRosters[4]?.WR).toContain('continuity-leader');
    expect(current.myRoster.WR).toContain('continuity-leader');
    expect(current.currentPick).toBe(6);
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
    expect(useDraftStore.getState().recordProvisionalPick({
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
    const unsubscribe = useDraftStore.subscribe(() => {
      draftTransitions += 1;
    });
    const confirmation = useDraftStore.getState().reconcileSyncedPicks(
      restoredProviderTruth,
      6
    );
    const reconciled = useDraftStore.getState();
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
    expect(reconciled.myRoster.WR).toEqual(['ecr-leader']);
    expect(reconciled.teamRosters[4]?.WR).toEqual(['ecr-leader']);
    expect(reconciled.draftedPlayerIds.has('ecr-leader')).toBe(true);
    expect(reconciled.currentPick).toBe(6);
    expect(recommendationAfterConfirmation.bestPick?.playerId).toBe(
      recommendationAfterObservation.bestPick?.playerId
    );
    expect(recommendationAfterConfirmation.bestPlayer?.playerId).toBe(
      recommendationAfterObservation.bestPlayer?.playerId
    );
    expect(draftTransitions).toBe(1);

    const summaryMarkup = renderToStaticMarkup(
      React.createElement(ReconciliationSummary, {
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
    expect(useDraftStore.getState().draftHistory).toBe(historyAfterConfirmation);
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
    const confirmedBaseline = useDraftStore.getState().draftHistory.map((pick) => ({
      pickNumber: pick.pickNumber,
      playerId: pick.playerId,
      playerName: pick.playerName,
      position: pick.position,
      teamIndex: pick.teamIndex,
      teamName: pick.teamName,
      isMyPick: pick.teamIndex === 4,
    }));
    expect(useDraftStore.getState().recordProvisionalPick({
      pickNumber: 5,
      playerId: 'ecr-leader',
      playerName: 'ECR Leader',
      position: 'WR',
      teamIndex: 4,
      teamName: 'My Team',
    })).toBe(true);
    expect(useDraftStore.getState().recordProvisionalPick({
      pickNumber: 6,
      playerId: 'next-wr',
      playerName: 'Next Receiver',
      position: 'WR',
      teamIndex: 5,
      teamName: 'Team 6',
    })).toBe(true);
    expect(useDraftStore.getState().recordProvisionalPick({
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
    const reconciliation = useDraftStore.getState().reconcileSyncedPicks(
      restoredProviderTruth,
      8,
      [unresolvedPick]
    );
    const reconciled = useDraftStore.getState();

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
    expect(reconciled.draftedPlayerIds.has('next-wr')).toBe(false);
    expect(reconciled.draftedPlayerIds.has('roster-rb')).toBe(false);
    expect(reconciled.draftedPlayerIds.has('ecr-leader')).toBe(true);
    expect(reconciled.currentPick).toBe(8);
    expect(blocksProviderIdentityRecommendations(
      reconciled.sessionMode,
      reconciled.unresolvedProviderPicks.length
    )).toBe(true);

    const summaryMarkup = renderToStaticMarkup(
      React.createElement(ReconciliationSummary, {
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
      React.createElement(ProviderIdentityBlockedNotice, {
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
    expect(useDraftStore.getState().reconcileSyncedPicks(
      resolvedProviderTruth,
      8
    ).changed).toBe(true);
    const resolved = useDraftStore.getState();
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
    expect(useDraftStore.getState().draftHistory).toBe(canonicalHistory);
  });

  it('rebuilds both Decision Lenses after replacing a provisional player and team', () => {
    const continuityPlayers: readonly Player[] = [
      player('continuity-leader', 'Continuity Leader', 'WR', 1, 60),
      player('continuity-rb', 'Continuity Runner', 'RB', 2, 45),
      player('continuity-wr', 'Continuity Receiver', 'WR', 3, 12),
    ];
    seedProviderTruthThroughPickFour();
    expect(useDraftStore.getState().recordProvisionalPick({
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

    expect(useDraftStore.getState().correctProvisionalPick(5, {
      pickNumber: 6,
      playerId: 'continuity-rb',
      playerName: 'Continuity Runner',
      position: 'RB',
      teamIndex: 5,
      teamName: 'Team 6',
    })).toBe(true);

    const current = useDraftStore.getState();
    const afterCorrection = calculateFromDraftState(continuityPlayers);
    const needsAfterCorrection = calculateTeamNeeds(
      current.myRoster,
      current.config.rosterRequirements,
      new Map()
    );
    const corrected = current.draftHistory.find(
      (pick) => pick.pickNumber === 6
    );

    expect(current.currentPick).toBe(5);
    expect(current.draftedPlayerIds.has('continuity-leader')).toBe(false);
    expect(current.draftedPlayerIds.has('continuity-rb')).toBe(true);
    expect(current.myRoster.WR).toEqual([]);
    expect(current.teamRosters[5]?.RB).toEqual(['continuity-rb']);
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
    const confirmedBefore = useDraftStore.getState().draftHistory.map(
      (pick) => ({ ...pick })
    );
    expect(useDraftStore.getState().recordProvisionalPick({
      pickNumber: 5,
      playerId: 'continuity-leader',
      playerName: 'Continuity Leader',
      position: 'WR',
      teamIndex: 4,
      teamName: 'My Team',
    })).toBe(true);
    expect(useDraftStore.getState().removeProvisionalPick(5)).toBe(true);

    const current = useDraftStore.getState();
    const afterRemoval = calculateFromDraftState(continuityPlayers);
    const needsAfterRemoval = calculateTeamNeeds(
      current.myRoster,
      current.config.rosterRequirements,
      new Map()
    );

    expect(current.draftHistory).toEqual(confirmedBefore);
    expect(current.currentPick).toBe(5);
    expect(current.draftedPlayerIds.has('continuity-leader')).toBe(false);
    expect(current.myRoster.WR).toEqual([]);
    expect(current.teamRosters[4]?.WR).toEqual([]);
    expect(needsAfterRemoval.find(
      (need) => need.position === 'WR'
    )?.startersFilled).toBe(0);
    expect(afterRemoval.bestPick?.playerId).toBe('continuity-leader');
    expect(afterRemoval.bestPlayer?.playerId).toBe('continuity-leader');
  });
});
