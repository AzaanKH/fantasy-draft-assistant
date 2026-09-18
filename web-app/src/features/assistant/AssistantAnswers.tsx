import { Badge } from '@/components/ui/badge';
import {
  getRecommendationExplanation,
} from '@/features/recommendations/recommendation-explanation';
import { cn, formatSignedNumber } from '@/lib/utils';
import { type PositionNeed, type Recommendation } from '@fantasy-draft/shared';
import { ChevronDown } from 'lucide-react';
import * as React from 'react';

import {
  getAssistantAnswerSections,
  getNeedSlotSummary,
  getSignalValueColor,
  survivalPercent,
} from './assistant-analysis';

export function CalculationDetails({ explanation }: { readonly explanation: string }): React.ReactElement {
  return (
    <details className="group mt-5 border-t border-border/70 pt-4 xl:mt-6 xl:pt-5">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-md text-sm font-semibold text-foreground outline-none hover:text-emerald-700 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card dark:hover:text-emerald-300 [&::-webkit-details-marker]:hidden">
        Show details
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
      </summary>
      <p className="motion-expandable mt-3 max-w-4xl text-sm leading-6 text-muted-foreground xl:text-base xl:leading-7">
        {explanation}
      </p>
    </details>
  );
}

export function WhyAnswer({ recommendation, isTopPick, positionRank, preferredExplanation }: {
  readonly recommendation: Recommendation;
  readonly isTopPick: boolean;
  readonly positionRank?: number;
  readonly preferredExplanation?: string;
}): React.ReactElement {
  const sections = getAssistantAnswerSections(recommendation, isTopPick, positionRank);
  const fullExplanation = preferredExplanation ?? getRecommendationExplanation(recommendation);

  return (
    <div className="max-w-5xl">
      <dl className="divide-y divide-border/70">
        {sections.map((section) => (
          <div
            key={section.label}
            className="grid gap-1 py-3 first:pt-0 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-5 xl:py-4"
          >
            <dt className={cn(
              'text-xs font-bold uppercase tracking-[0.12em] xl:text-sm',
              getSignalValueColor(section.tone)
            )}>
              {section.label}
            </dt>
            <dd className="text-sm font-medium leading-6 text-foreground xl:text-base xl:leading-7">
              {section.answer}
            </dd>
          </div>
        ))}
      </dl>
      <CalculationDetails explanation={fullExplanation} />
    </div>
  );
}

export function WaitAnswer({ recommendation }: { readonly recommendation: Recommendation }): React.ReactElement {
  const survival = survivalPercent(recommendation);
  const diagnostics = recommendation.diagnostics;
  const expectedAlternative = recommendation.decisionFactors?.draftTiming.expectedAlternative
    ?? diagnostics?.expectedNextPickAlternative;
  if (survival === null) {
    return <p className="text-sm text-muted-foreground xl:text-xl 2xl:text-2xl">Survival estimates are still being calculated.</p>;
  }

  return (
    <div className="max-w-5xl">
      <p className="text-lg font-semibold leading-snug xl:text-[1.875rem] xl:leading-[1.2] 2xl:text-4xl">
        Return Probability for {recommendation.playerName} at pick {diagnostics?.nextPickLabel ?? 'your next selection'} is {String(survival)}%.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground xl:mt-6 xl:text-xl 2xl:mt-7 2xl:text-2xl">
        {survival < 35
          ? `Waiting on ${recommendation.playerName} is high risk; treat this as the likely decision point if the player fits your plan.`
          : survival < 70
            ? `${recommendation.playerName} may return, but the board still carries meaningful uncertainty.`
            : `The model expects ${recommendation.playerName} to remain available, so waiting is a reasonable option.`}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground xl:mt-6 xl:text-xl 2xl:text-2xl">
        {expectedAlternative
          ? `If ${recommendation.playerName} is gone, ${expectedAlternative.playerName} is the expected ${recommendation.position} fallback at ${formatSignedNumber(expectedAlternative.expectedValue, 0)} expected points above replacement.`
          : `No same-position fallback is projected for that selection.`}
      </p>
      {diagnostics?.survivalModelSource === 'league-history' ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground xl:text-base 2xl:text-lg">
          Primary League history supplies 70% of the timing estimate. Current consensus market cost supplies 25%; Sleeper search rank supplies 5%.
        </p>
      ) : null}
    </div>
  );
}

export function RosterAnswer({ needs, recommendation }: {
  readonly needs: readonly PositionNeed[];
  readonly recommendation: Recommendation;
}): React.ReactElement {
  const selectedNeed = needs.find((need) => need.position === recommendation.position);
  const isActionable = selectedNeed && !['filled', 'defer'].includes(selectedNeed.priority);

  return (
    <div className="max-w-5xl">
      <p className="text-lg font-semibold leading-snug xl:text-[1.875rem] xl:leading-[1.2] 2xl:text-4xl">
        {selectedNeed
          ? `${selectedNeed.position} is a ${selectedNeed.priority} roster need right now.`
          : `${recommendation.position} roster context is unavailable.`}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground xl:mt-6 xl:text-xl 2xl:mt-7 2xl:text-2xl">
        {selectedNeed
          ? `${getNeedSlotSummary(selectedNeed)}, with a scarcity score of ${selectedNeed.scarcityScore.toFixed(1)}.`
          : 'Use the remaining picks for value, upside, and bench depth.'}
        {isActionable ? ` ${recommendation.playerName} would address that need.` : ''}
      </p>
      <div className="mt-4 flex flex-wrap gap-2 xl:mt-6 xl:gap-3 2xl:mt-7">
        {needs.map((need) => (
          <Badge
            key={need.position}
            variant="outline"
            className={cn(
              'font-mono xl:px-3 xl:py-1 xl:text-base 2xl:text-lg',
              need.priority === 'critical' && 'border-red-500/40 text-red-700 dark:text-red-300',
              need.priority === 'high' && 'border-orange-500/40 text-orange-700 dark:text-orange-300'
            )}
          >
            {need.position} · {need.priority}
          </Badge>
        ))}
      </div>
    </div>
  );
}

