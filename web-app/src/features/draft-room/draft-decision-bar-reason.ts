import type {
  DecisionDivergenceFactor,
  Recommendation,
} from '@fantasy-draft/shared';
import { formatSignedNumber } from '@/lib/utils';

function sentenceCase(value: string): string {
  const trimmed = value.trim().replace(/[.]+$/, '');
  return trimmed.length > 0
    ? `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`
    : 'Current roster and draft timing put this player first.';
}

function getReasonFactor(
  recommendation: Recommendation,
  divergenceFactor: DecisionDivergenceFactor | null
): DecisionDivergenceFactor | null {
  if (divergenceFactor) return divergenceFactor;
  const factors = recommendation.decisionFactors;
  if (!factors) return null;
  if (factors.draftTiming.materiallyChangedOrdering) return 'draft-timing';
  if (factors.tierSupply.materiallyChangedOrdering) return 'tier-supply';
  if (factors.rosterFit.materiallyChangedOrdering) return 'roster-fit';
  if (factors.leagueValue.materiallyChangedOrdering) return 'league-value';
  return null;
}

export function getDraftDecisionBarReason(
  recommendation: Recommendation,
  divergenceFactor: DecisionDivergenceFactor | null = null
): string {
  const factors = recommendation.decisionFactors;
  if (!factors) {
    return sentenceCase(recommendation.reason.split(' · ')[0] ?? recommendation.reason);
  }

  if (factors.conservativeBoundary.feasibilityException) {
    const selectionLabel = factors.rosterFit.selectionsRemaining === 1
      ? 'selection'
      : 'selections';
    return `Keeps a legal roster possible with ${String(factors.rosterFit.selectionsRemaining)} ${selectionLabel} left.`;
  }

  const reasonFactor = getReasonFactor(recommendation, divergenceFactor);
  if (reasonFactor === 'draft-timing') {
    return `Waiting costs ${factors.draftTiming.costOfWaiting.toFixed(1)} expected points before your next selection.`;
  }
  if (reasonFactor === 'tier-supply') {
    const optionLabel = factors.tierSupply.remainingInTier === 1 ? 'option remains' : 'options remain';
    return `${String(factors.tierSupply.remainingInTier)} ${recommendation.position} ${optionLabel} in Tier ${String(factors.tierSupply.currentTier)} before a ${factors.tierSupply.dropoffPoints.toFixed(1)} point drop.`;
  }
  if (reasonFactor === 'roster-fit') {
    const openSpots = factors.rosterFit.fixedStartersOpen + factors.rosterFit.flexSlotsOpen;
    return `Roster fit moves ${recommendation.position} first with ${String(openSpots)} starting spots still open.`;
  }
  if (reasonFactor === 'league-value') {
    return `League value moves this pick first at ${formatSignedNumber(factors.leagueValue.valueOverReplacement, 0)} points above replacement.`;
  }

  return `ECR #${String(factors.playerQuality.ecrRank)} with ${formatSignedNumber(factors.leagueValue.valueOverReplacement, 0)} points above replacement.`;
}
