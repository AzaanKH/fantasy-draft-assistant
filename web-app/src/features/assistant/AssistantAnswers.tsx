import { DRAFT_DISPLAY } from '@/lib/demo-mode';
import {
  getRecommendationExplanation,
  type AssistantAnswerRow,
  getWaitAnswer,
  getWhyRows,
} from '@fantasy-draft/shared/draft';
import { cn } from '@/lib/utils';
import { type DecisionLens, type Recommendation } from '@fantasy-draft/shared/draft';
import { ChevronDown } from 'lucide-react';
import * as React from 'react';


/**
 * The model's own reasoning in plain words, collapsed under the answer. A card's "Full reasoning" opens the Why tab
 * with it expanded, so the card itself never grows.
 */
export function CalculationDetails({ explanation, defaultOpen = false }: { readonly explanation: string; readonly defaultOpen?: boolean }): React.ReactElement {
  return (
    <details className="rec-details" open={defaultOpen || undefined} data-full-reasoning="">
      <summary>
        Full reasoning
        <ChevronDown className="size-4" aria-hidden="true" />
      </summary>
      <p className="motion-expandable">{explanation}</p>
    </details>
  );
}

/** Text tone from the design-system state colors; meaning is always carried by the words too. */
function getSignalValueColor(tone: AssistantAnswerRow['tone']): string {
  return {
    positive: 'text-[color:var(--color-success)]',
    caution: 'text-[color:var(--color-warning)]',
    urgent: 'text-[color:var(--color-danger)]',
    neutral: 'text-foreground',
  }[tone];
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

export function WhyAnswer({ recommendation, isTopPick, positionRank, preferredExplanation, expandReasoning = 0, lens = 'best-pick' }: {
  readonly recommendation: Recommendation;
  /** The Decision Lens that ranked this player; only Best Pick's order comes from its factors. */
  readonly lens?: DecisionLens;
  readonly isTopPick: boolean;
  readonly positionRank?: number;
  readonly preferredExplanation?: string;
  /** A card's Full reasoning request (0 for none); each new request remounts the disclosure open. */
  readonly expandReasoning?: number;
}): React.ReactElement {
  return (
    <div>
      <AnswerRows rows={getWhyRows(recommendation, isTopPick, positionRank, DRAFT_DISPLAY, lens)} />
      <CalculationDetails explanation={preferredExplanation ?? getRecommendationExplanation(recommendation, DRAFT_DISPLAY, lens)} key={expandReasoning} defaultOpen={expandReasoning > 0} />
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
