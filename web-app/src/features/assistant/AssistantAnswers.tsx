import {
  getRecommendationExplanation,
} from '@/features/recommendations/recommendation-explanation';
import { cn } from '@/lib/utils';
import { type Player, type PositionNeed, type Recommendation } from '@fantasy-draft/shared';
import { ChevronDown } from 'lucide-react';
import * as React from 'react';

import {
  type AssistantAnswerRow,
  getRosterAnswer,
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
  const answer = getRosterAnswer(needs, recommendation.position);
  const rows: AssistantAnswerRow[] = [
    { label: 'Open starters', answer: answer.openStarters, tone: 'neutral' },
    { label: `${recommendation.position} slots`, answer: answer.slots, tone: 'neutral' },
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
      <h3 className="rec-answer-title">{answer.headline}</h3>
      <AnswerRows rows={rows} />
      <React.Suspense fallback={<p role="status" className="rec-answer-footnote">Loading positional depth…</p>}>
        <PositionalDepthChart needs={needs} />
      </React.Suspense>
    </div>
  );
}
