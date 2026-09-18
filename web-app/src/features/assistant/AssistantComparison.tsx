import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { DecisionSwap } from '@/components/motion';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import {
  getPreferredRecommendation,
  type DraftDecisionView,
} from '@/features/recommendations/draft-decision';
import {
  getRecommendationExplanation,
} from '@/features/recommendations/recommendation-explanation';
import { formatSignedNumber } from '@/lib/utils';
import { type Player, type Recommendation } from '@fantasy-draft/shared';
import { Check } from 'lucide-react';
import * as React from 'react';

import { CalculationDetails } from './AssistantAnswers';
import { getComparisonHighlights, survivalPercent } from './assistant-analysis';

export function CompareAnswer({
  recommendations,
  availableComparisons,
  decision,
  onComparisonPlayerChange,
}: {
  readonly recommendations: readonly Recommendation[];
  readonly availableComparisons: readonly Recommendation[];
  readonly decision: DraftDecisionView;
  readonly onComparisonPlayerChange: (playerId: string) => void;
}): React.ReactElement {
  const [first, second] = recommendations;
  if (!first || !second) {
    return <p className="text-sm text-muted-foreground xl:text-xl 2xl:text-2xl">A second comparable option is not available yet.</p>;
  }

  const firstDiagnostics = first.diagnostics;
  const secondDiagnostics = second.diagnostics;
  const preferred = getPreferredRecommendation(decision, [first, second]) ?? first;
  const firstIsStronger = preferred.playerId === first.playerId;
  const preferredExplanation = decision.explanationByPlayerId.get(preferred.playerId)
    ?? getRecommendationExplanation(preferred);
  const highlights = getComparisonHighlights(first, second, decision);
  const rows = [
    {
      label: 'Recommendation rank',
      first: `#${String(decision.rankByPlayerId.get(first.playerId) ?? '—')}`,
      second: `#${String(decision.rankByPlayerId.get(second.playerId) ?? '—')}`,
    },
    {
      label: 'ECR anchor',
      first: `#${String(firstDiagnostics?.expertRank ?? '—')}`,
      second: `#${String(secondDiagnostics?.expertRank ?? '—')}`,
    },
    {
      label: 'Above replacement',
      first: firstDiagnostics ? formatSignedNumber(firstDiagnostics.valueOverReplacement, 0) : '—',
      second: secondDiagnostics ? formatSignedNumber(secondDiagnostics.valueOverReplacement, 0) : '—',
    },
    {
      label: 'Position tier',
      first: `T${String(firstDiagnostics?.tier ?? '—')}`,
      second: `T${String(secondDiagnostics?.tier ?? '—')}`,
    },
    {
      label: 'Return Probability',
      first: survivalPercent(first) === null ? '—' : `${String(survivalPercent(first))}%`,
      second: survivalPercent(second) === null ? '—' : `${String(survivalPercent(second))}%`,
    },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-col gap-4 border-y border-border/70 bg-muted/20 p-4 sm:flex-row sm:items-end sm:justify-between xl:p-5 2xl:mb-7 2xl:p-6">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground xl:text-sm 2xl:text-base">
            Player A · highlighted
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <strong className="text-lg xl:text-xl 2xl:text-2xl">{first.playerName}</strong>
            <Badge variant="outline" className="font-mono xl:text-sm 2xl:text-base">
              {first.position}
            </Badge>
          </div>
        </div>
        <div className="min-w-0 sm:w-[360px] xl:w-[420px] 2xl:w-[480px]">
          <label
            htmlFor="comparison-player"
            className="mb-2 block text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground xl:text-sm 2xl:text-base"
          >
            Player B · choose player
          </label>
          <Select
            id="comparison-player"
            className="w-full xl:h-11 xl:text-base 2xl:h-12 2xl:text-lg"
            value={second.playerId}
            onValueChange={onComparisonPlayerChange}
            options={availableComparisons.map((recommendation) => ({
              value: recommendation.playerId,
              label: `${recommendation.playerName} · ${recommendation.position}`,
            }))}
          />
        </div>
      </div>
      <DecisionSwap motionKey={second.playerId}>
        <h2 className="max-w-5xl text-lg font-semibold leading-snug xl:text-xl 2xl:text-2xl">
          {firstIsStronger
            ? `${first.playerName} grades ahead of ${second.playerName} for this pick.`
            : `${second.playerName} grades ahead of ${first.playerName}; here is the tradeoff.`}
        </h2>
        <section className="mt-4" aria-labelledby="meaningful-differences-heading">
          <h3 id="meaningful-differences-heading" className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground xl:text-sm">
            Meaningful differences
          </h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {(highlights.length > 0 ? highlights : [{
              label: 'Near tie',
              detail: 'League value, position tier, and Return Probability are close enough that roster preference can decide.',
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
        <div className="mt-4 overflow-hidden border-y border-border/70 xl:mt-6 2xl:mt-7">
          <div className="grid grid-cols-[1.2fr_1fr_1fr] bg-muted/35 px-3 py-2 text-xs font-semibold xl:px-5 xl:py-4 xl:text-base 2xl:px-6 2xl:text-lg">
            <span>Signal</span>
            <span className="truncate">{first.playerName}</span>
            <span className="truncate">{second.playerName}</span>
          </div>
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[1.2fr_1fr_1fr] border-t px-3 py-2 text-xs xl:px-5 xl:py-4 xl:text-base 2xl:px-6 2xl:text-lg">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="font-mono font-semibold">{row.first}</span>
              <span className="font-mono">{row.second}</span>
            </div>
          ))}
        </div>
        <CalculationDetails explanation={preferredExplanation} />
      </DecisionSwap>
    </div>
  );
}

export function AssistantComparisonSnapshot({
  recommendations,
  playerById,
  decision,
}: {
  readonly recommendations: readonly Recommendation[];
  readonly playerById: ReadonlyMap<string, Player>;
  readonly decision: DraftDecisionView;
}): React.ReactElement | null {
  const [first, second] = recommendations;
  if (!first || !second) return null;

  const firstPlayer = playerById.get(first.playerId);
  const secondPlayer = playerById.get(second.playerId);
  const preferredPlayerId = getPreferredRecommendation(decision, [first, second])?.playerId;
  const firstSurvival = survivalPercent(first);
  const secondSurvival = survivalPercent(second);
  const rows = [
    {
      label: 'Recommendation rank',
      first: `#${String(decision.rankByPlayerId.get(first.playerId) ?? '—')}`,
      second: `#${String(decision.rankByPlayerId.get(second.playerId) ?? '—')}`,
    },
    {
      label: 'Position',
      first: first.position,
      second: second.position,
    },
    {
      label: 'Team',
      first: firstPlayer?.team ?? 'FA',
      second: secondPlayer?.team ?? 'FA',
    },
    {
      label: 'Above replacement',
      first: first.diagnostics ? formatSignedNumber(first.diagnostics.valueOverReplacement, 0) : '—',
      second: second.diagnostics ? formatSignedNumber(second.diagnostics.valueOverReplacement, 0) : '—',
    },
    {
      label: 'Position tier',
      first: `Tier ${String(first.diagnostics?.tier ?? '—')}`,
      second: `Tier ${String(second.diagnostics?.tier ?? '—')}`,
    },
    {
      label: 'At next pick',
      first: firstSurvival === null ? '—' : `${String(firstSurvival)}%`,
      second: secondSurvival === null ? '—' : `${String(secondSurvival)}%`,
    },
  ];

  return (
    <aside className="assistant-quick-comparison min-w-0 overflow-hidden rounded-xl border border-border/75 bg-card" aria-label="Quick player comparison">
      <div className="border-b border-border/70 px-5 py-4">
        <h2 className="text-lg font-bold">Quick comparison</h2>
        <p className="mt-1 text-sm leading-snug text-muted-foreground">Current recommendation versus the best alternative</p>
      </div>
      <div className="comparison-profiles">
        {[first, second].map((recommendation, index) => (
          <article key={recommendation.playerId} className="comparison-profile" data-preferred={recommendation.playerId === preferredPlayerId}>
            <div className="comparison-identity">
              <PlayerHeadshot
                playerId={recommendation.playerId}
                name={recommendation.playerName}
                position={recommendation.position}
                className="comparison-portrait"
              />
              <div className="comparison-name">
                <h3>{recommendation.playerName}</h3>
                {recommendation.playerId === preferredPlayerId ? <span className="comparison-preferred"><Check aria-hidden="true" />Preferred</span> : null}
              </div>
            </div>
            <dl className="comparison-stats">
              {rows.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{index === 0 ? row.first : row.second}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </aside>
  );
}

