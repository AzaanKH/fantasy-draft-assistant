import { DecisionSwap } from '@/components/motion';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { Button } from '@/components/ui/button';
import { GitCompareArrows } from 'lucide-react';
import { ComparisonPlayerPicker } from './ComparisonPlayerPicker';
import {
  getPreferredRecommendation,
  type DraftDecisionView,
} from '@/features/recommendations/draft-decision';
import {
  getRecommendationExplanation,
} from '@/features/recommendations/recommendation-explanation';
import { type Player, type Recommendation } from '@fantasy-draft/shared';
import * as React from 'react';

import { CalculationDetails } from './AssistantAnswers';
import { getComparisonHighlights } from './assistant-analysis';
import { PlayerComparisonMetrics } from './PlayerComparisonMetrics';

const PlayerPointCharts = React.lazy(() => import('./PlayerPointCharts'));

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
    return <p className="text-sm text-muted-foreground xl:text-xl 2xl:text-2xl">A second comparable option is not available yet.</p>;
  }

  const preferred = getPreferredRecommendation(decision, [first, second]) ?? first;
  const firstIsStronger = preferred.playerId === first.playerId;
  const preferredExplanation = decision.explanationByPlayerId.get(preferred.playerId)
    ?? getRecommendationExplanation(preferred);
  const highlights = getComparisonHighlights(first, second, decision);

  return (
    <div className="comparison-answer">
      <div className="comparison-selector">
        {[first, second].map((player, index) => (
          <div key={index} className="comparison-selection">
            <PlayerHeadshot playerId={player.playerId} name={player.playerName} position={player.position} className="comparison-selection-avatar" />
            <div className="min-w-0">
              <span className="comparison-selection-label">{index === 0 ? 'Selected player' : 'Compare with'}</span>
              <strong className="comparison-selection-name">{player.playerName}</strong>
              <span className="comparison-selection-meta">{player.position}{playerById.get(player.playerId)?.team ? ` · ${playerById.get(player.playerId)?.team}` : ''}</span>
            </div>
            {index === 1 ? <ComparisonPlayerPicker
              recommendations={availableComparisons}
              selectedId={second.playerId}
              playerById={playerById}
              onSelect={onComparisonPlayerChange}
            /> : null}
          </div>
        ))}
      </div>
      <DecisionSwap motionKey={second.playerId} className="comparison-detail-layout">
        <div className="comparison-verdict">
          <h2 className="font-semibold">
            {firstIsStronger
              ? `${first.playerName} grades ahead of ${second.playerName} for this pick.`
              : `${second.playerName} grades ahead of ${first.playerName}; here is the tradeoff.`}
          </h2>
          <section className="mt-4" aria-labelledby="meaningful-differences-heading">
            <h3 id="meaningful-differences-heading" className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground xl:text-sm">
              Meaningful differences
            </h3>
            <div className="comparison-highlights mt-2 grid gap-2">
              {(highlights.length > 0 ? highlights : [{
                label: 'No clear edge',
                detail: 'The available signals do not show a clear difference. Review roster needs and any unavailable estimates before choosing.',
              }]).map((highlight) => (
                <div key={highlight.label} className="border-l-2 border-emerald-500/40 bg-emerald-500/[0.06] px-3 py-3">
                  <div className="text-xs font-bold text-emerald-700 dark:text-emerald-300">{highlight.label}</div>
                  <p className="mt-1 text-sm leading-5 text-foreground">{highlight.detail}</p>
                </div>
              ))}
            </div>
          </section>
          <p className="mt-4 max-w-5xl text-sm leading-6 text-muted-foreground xl:text-base xl:leading-7">
            The current Decision Policy weighs player quality against league value, roster fit, tier supply, and next-pick timing. That gives {preferred.playerName} the edge for this pick.
          </p>
          <CalculationDetails explanation={preferredExplanation} />
        </div>
        <div className="min-w-0 space-y-4">
          <React.Suspense fallback={<p role="status" className="py-6 text-sm text-muted-foreground">Loading point comparisons…</p>}>
            <PlayerPointCharts first={first} second={second} preferredPlayerId={preferred.playerId} />
          </React.Suspense>
        <PlayerComparisonMetrics
          first={first}
          second={second}
          preferredPlayerId={preferred.playerId}
          showPointMetrics={false}
          ranks={decision.rankByPlayerId}
          playerById={playerById}
        />
        </div>
      </DecisionSwap>
    </div>
  );
}

export function AssistantComparisonSnapshot({
  recommendations,
  playerById,
  decision,
  onOpenComparison,
}: {
  readonly onOpenComparison: () => void;
  readonly recommendations: readonly Recommendation[];
  readonly playerById: ReadonlyMap<string, Player>;
  readonly decision: DraftDecisionView;
}): React.ReactElement | null {
  const [first, second] = recommendations;
  if (!first || !second) return null;

  const preferredPlayerId = getPreferredRecommendation(decision, [first, second])?.playerId;

  return (
    <aside className="assistant-quick-comparison" aria-label="Quick player comparison">
      <header className="quick-comparison-header">
        <div>
          <h2 className="font-semibold">Quick comparison</h2>
          <p className="mt-1 text-muted-foreground">A snapshot of these two players. Open the comparison to explore the differences or choose another player.</p>
        </div>
        <Button variant="outline" size="sm" onClick={onOpenComparison}>
          <GitCompareArrows className="size-4" aria-hidden="true" />
          Open comparison
        </Button>
      </header>
      <PlayerComparisonMetrics
        first={first}
        second={second}
        preferredPlayerId={preferredPlayerId}
        ranks={decision.rankByPlayerId}
        playerById={playerById}
        compact
      />
    </aside>
  );
}
