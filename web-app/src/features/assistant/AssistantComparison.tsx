import { DRAFT_DISPLAY } from '@/lib/demo-mode';
import { DecisionSwap } from '@/components/motion';
import {
  getPreferredRecommendation,
  type DraftDecisionView,
  getRecommendationExplanation,
  getComparisonHighlights,
} from '@fantasy-draft/shared/draft';
import { type Player, type Recommendation } from '@fantasy-draft/shared';
import * as React from 'react';
import { CalculationDetails } from './AssistantAnswers';
import { ComparisonPlayerPicker } from './ComparisonPlayerPicker';
import { PlayerComparisonMetrics } from './PlayerComparisonMetrics';

/** Verdict first, then the side-by-side table beside the meaningful differences on wide screens. */
export function CompareAnswer({
  recommendations,
  availableComparisons,
  decision,
  onComparisonPlayerChange,
  playerById,
}: {
  readonly recommendations: readonly Recommendation[];
  readonly availableComparisons: readonly Recommendation[];
  readonly decision: DraftDecisionView;
  readonly onComparisonPlayerChange: (playerId: string) => void;
  readonly playerById: ReadonlyMap<string, Player>;
}): React.ReactElement {
  const [first, second] = recommendations;
  if (!first || !second) {
    return <p className="rec-answer-footnote">A second comparable option is not available yet.</p>;
  }

  const preferred = getPreferredRecommendation(decision, [first, second]) ?? first;
  const other = preferred.playerId === first.playerId ? second : first;
  const preferredExplanation = decision.explanationByPlayerId.get(preferred.playerId)
    ?? getRecommendationExplanation(preferred, DRAFT_DISPLAY);
  const highlights = getComparisonHighlights(first, second, decision, DRAFT_DISPLAY);

  return (
    <div className="rec-compare-answer">
      <div className="rec-compare-heading">
        <h3 className="rec-answer-title">{preferred.playerName} grades ahead of {other.playerName} for this pick.</h3>
        <ComparisonPlayerPicker
          recommendations={availableComparisons}
          selectedId={second.playerId}
          playerById={playerById}
          onSelect={onComparisonPlayerChange}
        />
      </div>
      <DecisionSwap motionKey={second.playerId} className="rec-compare-body">
        <div className="rec-compare-side">
          <dl className="rec-answer-rows" aria-label="Meaningful differences">
            {(highlights.length > 0 ? highlights : [{
              label: 'No clear edge',
              detail: 'The available signals do not show a clear difference. Review roster needs and any unavailable estimates before choosing.',
            }]).map((highlight) => (
              <div key={highlight.label}>
                <dt>{highlight.label}</dt>
                <dd>{highlight.detail}</dd>
              </div>
            ))}
          </dl>
          <CalculationDetails explanation={preferredExplanation} />
        </div>
        <PlayerComparisonMetrics
          first={first}
          second={second}
          preferredPlayerId={preferred.playerId}
          ranks={decision.rankByPlayerId}
          playerById={playerById}
        />
      </DecisionSwap>
    </div>
  );
}
