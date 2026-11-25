import { LIVE_DRAFT_DISPLAY, type DraftDisplayContext } from '../display-context.js';
import type { DecisionLens, Recommendation } from '../../draft.js';
import { formatSignedNumber } from '../format.js';

/** Why the active lens ranks a player, for lenses whose order the attached Best Pick factors do not set. */
const LENS_ORDER_SENTENCES: Readonly<Record<Exclude<DecisionLens, 'best-pick'>, string>> = {
  'ranked-fit': 'Ranked Fit orders the players who keep a legal roster possible by the rankings alone.',
  'best-player': 'Best Player follows the rankings alone.',
};

/**
 * The full reasoning for a player in a Decision Lens. Best Pick's factors set Best Pick's order; in Ranked Fit
 * and Best Player they are only Best Pick's analysis of the same player, so they are labelled that way.
 */
export function getRecommendationExplanation(
  recommendation: Recommendation,
  display: DraftDisplayContext = LIVE_DRAFT_DISPLAY,
  lens: DecisionLens = 'best-pick'
): string {
  const { LEAGUE_LABEL } = display;
  const isBestPick = lens === 'best-pick';
  const score = isBestPick ? 'his score' : 'his Best Pick score';
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
      `${LEAGUE_LABEL} value adds ${factors.leagueValue.score.toFixed(1)} to ${score}: he projects ${formatSignedNumber(factors.leagueValue.valueOverReplacement, 0)} pts over a fill-in starter${scoringDetail}.`;
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
          : `No ${recommendation.position} is projected to be left at that pick.`} Waiting costs ${factors.draftTiming.costOfWaiting.toFixed(1)} expected points, which adds ${factors.draftTiming.score.toFixed(1)} to ${isBestPick ? 'taking him now' : score}.${factors.draftTiming.materiallyChangedOrdering ? ' That next-pick tradeoff changed Best Pick.' : ''}`
        : '';
    const feasibilitySentence = isBestPick && factors.conservativeBoundary.feasibilityException
      ? `No player in the usual range of the rankings could still complete a legal roster, so he is taken early to keep the roster fillable. `
      : '';

    const orderSentence = isBestPick
      ? ''
      : `${LENS_ORDER_SENTENCES[lens]} Best Pick analysis, which does not change this order:`;
    return `${recommendation.playerName} is #${String(factors.playerQuality.ecrRank)} in the rankings. ${orderSentence} ${valueSentence} ${rosterSentence} ${depthSentence} ${tierSupplySentence} ${timingSentence} ${feasibilitySentence}`
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
