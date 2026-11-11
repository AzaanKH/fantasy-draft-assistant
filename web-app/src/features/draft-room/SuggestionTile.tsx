import * as React from 'react';
import { ArrowRight } from 'lucide-react';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ACTIONS,
  CARD,
  getSuggestionIds,
  hasPrimaryAction,
  HEADSHOT,
  CardFlagChip,
  NAME,
  SuggestionAvailability,
  SuggestionError,
  SuggestionFacts,
  SuggestionKeyHint,
  SuggestionMeta,
  SuggestionPrimaryAction,
  SuggestionQueueButton,
  SuggestionReason,
  useSuggestionCardModel,
  VerdictChip,
  type SuggestionCardProps,
} from './suggestion-card-parts';

/** The draft dock's tile: headshot and identity on top, facts, availability, then the actions with "Why". */
export const SuggestionTile = React.memo(function SuggestionTile(props: SuggestionCardProps): React.ReactElement {
  const { recommendation, rank, shortcut, player, isQueued, isSelected, draftStatus, onToggleQueue, onExplain } = props;
  const { availability, verdict, summary, flag, explanationDetails } = useSuggestionCardModel(props);
  const ids = getSuggestionIds(recommendation.playerId);
  const name = recommendation.playerName;
  return (
    <article className={cn(CARD, 'w-full')} data-selected={isSelected || undefined} data-suggestion-card="" aria-labelledby={ids.name} aria-describedby={ids.hint} tabIndex={0}>
      <div className="suggestion-identity flex items-start gap-3">
        <PlayerHeadshot playerId={recommendation.playerId} name={name} position={recommendation.position} className={HEADSHOT} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs text-muted-foreground">#{String(rank)}</span>
            <SuggestionMeta recommendation={recommendation} player={player} />
            <span className="ml-auto"><SuggestionKeyHint id={ids.hint} shortcut={shortcut} /></span>
          </div>
          <h3 id={ids.name} className={NAME}>{name}</h3>
          <div className="suggestion-signals">
            <VerdictChip verdict={verdict} withRule={false} details={explanationDetails} />
            <CardFlagChip flag={flag} player={player} />
          </div>
          {/* The tile's Why button opens the full reasoning, so the line here is the summary alone. */}
          <SuggestionReason summary={summary} playerName={name} />
        </div>
      </div>

      <SuggestionFacts diagnostics={recommendation.diagnostics} />

      <SuggestionAvailability availability={availability} />

      <div className={cn(ACTIONS, 'suggestion-actions')} data-suggestion-action={recommendation.playerId}>
        <SuggestionPrimaryAction {...props} />
        <SuggestionQueueButton playerId={recommendation.playerId} name={name} isQueued={isQueued} primary={!hasPrimaryAction(props)} compact={false} onToggleQueue={onToggleQueue} />
        <Button variant="ghost" size="sm" aria-label={`Why ${name}?`} onClick={() => { onExplain(recommendation.playerId); }}>
          Why <ArrowRight className="size-4" />
        </Button>
      </div>
      <SuggestionError playerId={recommendation.playerId} draftStatus={draftStatus} />
    </article>
  );
});
