import {
  getRecommendationExplanation,
} from '@/features/recommendations/recommendation-explanation';
import { cn } from '@/lib/utils';
import { type Player, type PositionNeed, type Recommendation } from '@fantasy-draft/shared';
import { ChevronDown } from 'lucide-react';
import * as React from 'react';

import {
  type AssistantAnswerRow,
  getSignalValueColor,
  getWaitAnswer,
  getWhyRows,
} from './assistant-analysis';

const PositionalDepthChart = React.lazy(() => import('./PositionalDepthChart'));

export function CalculationDetails({ explanation }: { readonly explanation: string }): React.ReactElement {
  return (
    <details className="rec-details group">
      <summary>
        Show calculation
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <p className="motion-expandable">{explanation}</p>
    </details>
  );
}

function AnswerRows({ rows }: { readonly rows: readonly AssistantAnswerRow[] }): React.ReactElement {
  return (
    <dl className="rec-answer-rows">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd className={cn(row.tone !== 'neutral' && getSignalValueColor(row.tone))}>{row.answer}</dd>
        </div>
      ))}
    </dl>
  );
}

export function WhyAnswer({ recommendation, isTopPick, positionRank, preferredExplanation }: {
  readonly recommendation: Recommendation;
  readonly isTopPick: boolean;
  readonly positionRank?: number;
  readonly preferredExplanation?: string;
}): React.ReactElement {
  return (
    <div>
      <AnswerRows rows={getWhyRows(recommendation, isTopPick, positionRank)} />
      <CalculationDetails explanation={preferredExplanation ?? getRecommendationExplanation(recommendation)} />
    </div>
  );
}

export function WaitAnswer({ recommendation, teamsNeedingPosition }: {
  readonly recommendation: Recommendation;
  /** Context from the picks before the manager's next turn, or null when no picks remain. */
  readonly teamsNeedingPosition: string | null;
}): React.ReactElement {
  const answer = getWaitAnswer(recommendation);
  const rows = teamsNeedingPosition
    ? [...answer.rows, { label: 'Before your pick', answer: teamsNeedingPosition, tone: 'neutral' as const }]
    : answer.rows;

  return (
    <div>
      <h3 className="rec-answer-title">{answer.headline}</h3>
      <AnswerRows rows={rows} />
      <p className="rec-answer-footnote">
        {recommendation.diagnostics?.survivalModelSource === 'league-history'
          ? 'Primary League history supplies 70% of the timing estimate, current consensus market cost 25%, and Sleeper search rank 5%. '
          : ''}
        Team needs are roster context. An estimate is not a guarantee.
      </p>
    </div>
  );
}

export function RosterAnswer({ needs, recommendation, player, sameByeName }: {
  readonly needs: readonly PositionNeed[];
  readonly recommendation: Recommendation;
  readonly player?: Player;
  readonly sameByeName: string | null;
}): React.ReactElement {
  const selectedNeed = needs.find((need) => need.position === recommendation.position);
  const openStarters = needs
    .filter((need) => need.startersFilled < need.startersNeeded && need.position !== 'K' && need.position !== 'DEF')
    .map((need) => {
      const open = need.startersNeeded - need.startersFilled;
      return open > 1 ? `${need.position} ×${String(open)}` : need.position;
    });
  const fillsStarter = selectedNeed !== undefined && selectedNeed.startersFilled < selectedNeed.startersNeeded;
  const rows: AssistantAnswerRow[] = [
    { label: 'Open starters', answer: openStarters.length > 0 ? openStarters.join(', ') : 'All fixed starter slots are filled.', tone: 'neutral' },
    {
      label: `${recommendation.position} slots`,
      answer: selectedNeed
        ? `${String(selectedNeed.startersFilled)} of ${String(selectedNeed.startersNeeded)} filled · ${selectedNeed.priority} need`
        : 'Roster context is unavailable.',
      tone: 'neutral',
    },
  ];
  if (player?.byeWeek) {
    rows.push({
      label: 'Bye week',
      answer: sameByeName
        ? `Bye ${String(player.byeWeek)}, same week as ${sameByeName}.`
        : `Bye ${String(player.byeWeek)}. No overlap with your ${recommendation.position}s.`,
      tone: sameByeName ? 'caution' : 'neutral',
    });
  }

  return (
    <div className="min-w-0">
      <h3 className="rec-answer-title">
        {fillsStarter
          ? `Fills an open ${recommendation.position} starter slot.`
          : `${recommendation.position} starters are filled. This adds depth.`}
      </h3>
      <AnswerRows rows={rows} />
      <React.Suspense fallback={<p role="status" className="rec-answer-footnote">Loading positional depth…</p>}>
        <PositionalDepthChart needs={needs} />
      </React.Suspense>
    </div>
  );
}
