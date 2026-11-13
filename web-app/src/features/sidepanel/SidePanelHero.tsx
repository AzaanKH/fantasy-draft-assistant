import { describeMissingAvailability, formatAvailabilityPercent, getNextPickAvailability } from '@/lib/next-pick-availability';
import { type Player } from '@fantasy-draft/shared/league';
import * as React from 'react';
import { GitCompareArrows, Lightbulb } from 'lucide-react';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { MotionIdentitySwap } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { PlayerStatusFacts, VerdictChip } from '@/features/draft-room/suggestion-card-parts';
import { getRecommendationVerdict } from '@/features/draft-room/suggestion-reasons';
import { type DraftDecisionView, formatSignedNumber } from '@fantasy-draft/shared/draft';
import { cn } from '@/lib/utils';
import { HERO_CARD } from './SidePanelFrame';
import { getCompactDecisionExplanation } from './sidepanel-insights';

/** One inline figure in the hero's stat line; a missing figure is a quieter word ("No later pick"). */
function HeroStat({ value, label, muted = false, positive = false }: {
  readonly value: string;
  readonly label: string;
  readonly muted?: boolean;
  readonly positive?: boolean;
}): React.ReactElement {
  return (
    <span className="whitespace-nowrap">
      <strong className={muted ? 'font-semibold text-muted-foreground' : cn('font-mono font-bold', positive && 'text-success')}>{value}</strong>
      {' '}<span className="text-muted-foreground">{label}</span>
    </span>
  );
}

/**
 * The top recommendation, compact enough that the compare list starts on the first screen at 360-420px: a small
 * headshot, one stat line, one plain sentence that adds what the stats do not, and two small actions.
 */
export function RecommendationHero({
  decision,
  player,
  onCompare,
  onAskWhy,
}: {
  readonly decision: DraftDecisionView;
  readonly player?: Player;
  readonly onCompare: () => void;
  readonly onAskWhy: () => void;
}): React.ReactElement {
  const recommendation = decision.preferred ?? undefined;
  if (!recommendation) {
    return (
      <section className="rounded-xl border border-border/80 bg-card p-5 text-center">
        <h2 className="font-bold">No recommendation available</h2>
        <p className="mt-2 text-sm text-muted-foreground">Try another position or wait for the next synced pick.</p>
      </section>
    );
  }

  const diagnostics = recommendation.diagnostics;
  const availability = getNextPickAvailability(diagnostics);
  const missingAvailability = describeMissingAvailability(availability);
  const explanation = getCompactDecisionExplanation(recommendation);

  return (
    <section className={HERO_CARD}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-2xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Your best pick</div>
        <VerdictChip verdict={getRecommendationVerdict(recommendation)} />
      </div>
      <MotionIdentitySwap motionKey={recommendation.playerId}>
        <div className="mt-2 flex items-center gap-2.5">
          <PlayerHeadshot
            playerId={recommendation.playerId}
            name={recommendation.playerName}
            position={recommendation.position}
            className="size-11 rounded-lg border border-border/80"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-bold leading-6">{recommendation.playerName}</div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              <span className="position-text font-mono font-bold" data-position={recommendation.position}>{recommendation.position}</span>
              {player?.team ? <span>· {player.team}</span> : null}
              {player ? <PlayerStatusFacts player={player} /> : null}
            </div>
          </div>
        </div>
      </MotionIdentitySwap>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
        <HeroStat value={diagnostics ? formatSignedNumber(diagnostics.valueOverReplacement, 0) : 'Not estimated'} label="Over fill-in" muted={!diagnostics} positive />
        <HeroStat value={`Tier ${String(diagnostics?.tier ?? '?')}`} label={diagnostics?.isLastInTier ? 'last in tier' : 'at position'} />
        <HeroStat
          value={missingAvailability ?? formatAvailabilityPercent(availability)}
          label={availability.kind === 'no-next-pick' ? 'final pick' : diagnostics?.nextPickLabel ? `at ${diagnostics.nextPickLabel}` : 'at next pick'}
          muted={missingAvailability !== null}
        />
      </div>
      {explanation ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{explanation}</p> : null}
      <div className="mt-2.5 flex gap-2">
        <Button size="sm" className="min-w-max flex-1" onClick={onCompare}>
          <GitCompareArrows className="size-4" /> Compare options
        </Button>
        <Button size="sm" className="min-w-max flex-1" variant="outline" onClick={onAskWhy}>
          <Lightbulb className="size-4" /> Ask why
        </Button>
      </div>
    </section>
  );
}
