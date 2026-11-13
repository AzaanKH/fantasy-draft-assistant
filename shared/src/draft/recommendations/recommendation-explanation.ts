import { LIVE_DRAFT_DISPLAY, type DraftDisplayContext } from '../display-context.js';
import type { Recommendation } from '../../draft.js';
import { formatSignedNumber } from '../format.js';

export function getRecommendationExplanation(
  recommendation: Recommendation,
  display: DraftDisplayContext = LIVE_DRAFT_DISPLAY
): string {
  const { LEAGUE_LABEL } = display;
  const diagnostics = recommendation.diagnostics;
  const factors = recommendation.decisionFactors;
  if (!diagnostics) {
    return `Consider ${recommendation.playerName} now: ${recommendation.reason}.`;
  }

  if (factors) {
    const scoringDetail = factors.leagueValue.scoringAdjustment !== undefined &&
      Math.abs(factors.leagueValue.scoringAdjustment) >= 0.5
      ? `, including ${formatSignedNumber(factors.leagueValue.scoringAdjustment, 1)} from ${LEAGUE_LABEL} scoring`
      : '';
    const valueSentence =
      `${LEAGUE_LABEL} value adds ${factors.leagueValue.score.toFixed(1)} to his score: he projects ${formatSignedNumber(factors.leagueValue.valueOverReplacement, 0)} pts over a fill-in starter${scoringDetail}.`;
    const fixedStarterLabel = factors.rosterFit.fixedStartersOpen === 1
      ? 'fixed starter spot'
      : 'fixed starter spots';
    const flexLabel = factors.rosterFit.flexSlotsOpen === 1
      ? 'FLEX spot'
      : 'FLEX spots';
    const rosterSentence = factors.rosterFit.score > 1
      ? `Roster fit adds ${factors.rosterFit.score.toFixed(1)} with ${String(factors.rosterFit.fixedStartersOpen)} ${fixedStarterLabel} and ${String(factors.rosterFit.flexSlotsOpen)} ${flexLabel} open.`
      : `Roster fit adds ${factors.rosterFit.score.toFixed(1)} for bench depth.`;
    const depthSentence = factors.depthValue.score > 0
      ? `Depth adds ${factors.depthValue.score.toFixed(1)} because the roster has ${String(factors.depthValue.reserveCount)} ${recommendation.position} reserves against a target of ${String(factors.depthValue.targetReserveCount)} and recovers ${factors.depthValue.contingencyPoints.toFixed(1)} projected points on average when a starter is unavailable.${factors.depthValue.materiallyChangedOrdering ? ' That bench protection changed Best Pick.' : ''}`
      : '';
    const tierSupplySentence = factors.tierSupply.score > 0
      ? `A thinning tier adds ${factors.tierSupply.costOfWaiting.toFixed(1)} with ${String(factors.tierSupply.remainingInTier)} left in ${recommendation.position} Tier ${String(factors.tierSupply.currentTier)} and a ${factors.tierSupply.dropoffPoints.toFixed(1)} point drop to the next tier.${factors.tierSupply.materiallyChangedOrdering ? ' That tier cliff changed Best Pick.' : ''}`
      : '';
    const returnProbability = factors.draftTiming.returnProbability;
    const expectedAlternative = factors.draftTiming.expectedAlternative;
    const timingSource = factors.draftTiming.source === 'league-history'
      ? 'Primary League history calibrated to the current consensus market'
      : 'The fallback timing estimate';
    const timingSentence =
      returnProbability !== undefined && factors.draftTiming.nextPickNumber !== undefined
        ? `${timingSource} gives a ${String(Math.round(returnProbability * 100))}% chance he's still there at pick ${factors.draftTiming.nextPickLabel ?? `#${String(factors.draftTiming.nextPickNumber)}`}. ${expectedAlternative
          ? `If you wait, ${expectedAlternative.playerName} is the best estimated ${recommendation.position} option, at ${formatSignedNumber(expectedAlternative.expectedValue, 0)} expected pts over a fill-in starter.`
          : `No ${recommendation.position} is projected to be left at that pick.`} Waiting costs ${factors.draftTiming.costOfWaiting.toFixed(1)} expected points, which adds ${factors.draftTiming.score.toFixed(1)} to taking him now.${factors.draftTiming.materiallyChangedOrdering ? ' That next-pick tradeoff changed Best Pick.' : ''}`
        : '';
    const feasibilitySentence = factors.conservativeBoundary.feasibilityException
      ? `No player in the usual range of the rankings could still complete a legal roster, so he is taken early to keep the roster fillable. `
      : '';

    return `${recommendation.playerName} is #${String(factors.playerQuality.ecrRank)} in the rankings. ${valueSentence} ${rosterSentence} ${depthSentence} ${tierSupplySentence} ${timingSentence} ${feasibilitySentence}`
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

  details.push(`${formatSignedNumber(diagnostics.valueOverReplacement, 0)} pts over a fill-in starter`);

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
