import type { Recommendation } from '@fantasy-draft/shared';
import { formatSignedNumber } from '@/lib/utils';

export function getRecommendationExplanation(
  recommendation: Recommendation
): string {
  const diagnostics = recommendation.diagnostics;
  const factors = recommendation.decisionFactors;
  if (!diagnostics) {
    return `Consider ${recommendation.playerName} now: ${recommendation.reason}.`;
  }

  if (factors) {
    const scoringDetail = factors.leagueValue.scoringAdjustment !== undefined &&
      Math.abs(factors.leagueValue.scoringAdjustment) >= 0.5
      ? `, including ${formatSignedNumber(factors.leagueValue.scoringAdjustment, 1)} from Primary League scoring`
      : '';
    const valueSentence =
      `Primary League value adds ${factors.leagueValue.score.toFixed(1)} policy points from ${formatSignedNumber(factors.leagueValue.valueOverReplacement, 0)} points above replacement${scoringDetail}.`;
    const fixedStarterLabel = factors.rosterFit.fixedStartersOpen === 1
      ? 'fixed starter spot'
      : 'fixed starter spots';
    const flexLabel = factors.rosterFit.flexSlotsOpen === 1
      ? 'FLEX spot'
      : 'FLEX spots';
    const rosterSentence = factors.rosterFit.score > 1
      ? `Roster fit adds ${factors.rosterFit.score.toFixed(1)} policy points with ${String(factors.rosterFit.fixedStartersOpen)} ${fixedStarterLabel} and ${String(factors.rosterFit.flexSlotsOpen)} ${flexLabel} open.`
      : `Roster fit adds ${factors.rosterFit.score.toFixed(1)} policy point for bench depth.`;
    const tierSupplySentence = factors.tierSupply.score > 0
      ? `Tier supply adds ${factors.tierSupply.costOfWaiting.toFixed(1)} cost-of-waiting points with ${String(factors.tierSupply.remainingInTier)} left in ${recommendation.position} Tier ${String(factors.tierSupply.currentTier)} and a ${factors.tierSupply.dropoffPoints.toFixed(1)} point drop to the next tier.${factors.tierSupply.materiallyChangedOrdering ? ' That tier cliff changed Best Pick.' : ''}`
      : '';
    const returnProbability = factors.draftTiming.returnProbability;
    const expectedAlternative = factors.draftTiming.expectedAlternative;
    const timingSource = factors.draftTiming.source === 'league-history'
      ? 'Primary League history calibrated to the current consensus market'
      : 'The fallback timing estimate';
    const timingSentence =
      returnProbability !== undefined && factors.draftTiming.nextPickNumber !== undefined
        ? `${timingSource} gives ${String(Math.round(returnProbability * 100))}% Return Probability at pick ${factors.draftTiming.nextPickLabel ?? `#${String(factors.draftTiming.nextPickNumber)}`}. ${expectedAlternative
          ? `${expectedAlternative.playerName} is the expected ${recommendation.position} fallback at ${formatSignedNumber(expectedAlternative.expectedValue, 0)} expected points above replacement.`
          : `No same-position fallback is projected for that selection.`} Waiting costs ${factors.draftTiming.costOfWaiting.toFixed(1)} expected points, worth ${factors.draftTiming.score.toFixed(1)} policy points.${factors.draftTiming.materiallyChangedOrdering ? ' That next-pick tradeoff changed Best Pick.' : ''}`
        : '';
    const feasibilitySentence = factors.conservativeBoundary.feasibilityException
      ? `The normal ECR window had no pick that could still complete a legal roster, so the policy used its roster-feasibility exception. `
      : '';

    return `${recommendation.playerName} is anchored at ECR #${String(factors.playerQuality.ecrRank)}. ${valueSentence} ${rosterSentence} ${tierSupplySentence} ${timingSentence} ${feasibilitySentence}`
      .replace(/\s+/g, ' ')
      .trim();
  }

  const details: string[] = [];
  if (diagnostics.tier !== undefined) {
    if (diagnostics.isLastInTier) {
      details.push(
        `last available player in ${recommendation.position} Tier ${String(diagnostics.tier)}`
      );
    } else if (diagnostics.tierRemaining !== undefined) {
      details.push(
        `one of ${String(diagnostics.tierRemaining)} players remaining in ${recommendation.position} Tier ${String(diagnostics.tier)}`
      );
    } else {
      details.push(`${recommendation.position} Tier ${String(diagnostics.tier)}`);
    }
  }

  details.push(`${formatSignedNumber(diagnostics.valueOverReplacement, 0)} points above replacement`);

  const playerDescription = details.join(' and ');

  if (diagnostics.nextPickSurvivalProbability !== undefined) {
    const probability = Math.round(
      diagnostics.nextPickSurvivalProbability * 100
    );
    const timing = probability < 35
      ? `The chance this player reaches your next pick is only ${String(probability)}%, making waiting risky.`
      : probability < 70
        ? `The chance this player reaches your next pick is ${String(probability)}%, so waiting carries some risk.`
        : `The chance this player reaches your next pick is ${String(probability)}%, so waiting may be reasonable.`;
    return `${recommendation.playerName} is ${playerDescription}. ${timing}`;
  }

  return `${recommendation.playerName} is ${playerDescription}.`;
}
