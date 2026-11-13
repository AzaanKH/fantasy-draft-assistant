import * as React from 'react';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import {
  CardFlagChip,
  getSuggestionIds,
  hasPrimaryAction,
  ROW_CARD,
  ROW_HEADSHOT,
  SuggestionAvailability,
  SuggestionError,
  SuggestionKeyHint,
  SuggestionMeta,
  SuggestionPrimaryAction,
  SuggestionQueueButton,
  SuggestionReason,
  useSuggestionCardModel,
  VerdictChip,
  type SuggestionCardProps,
} from './suggestion-card-parts';

/**
 * The Assistant's ranked row, two lines so "who, and can I wait?" reads at a glance: rank, name and a quiet
 * "WR3 · DET · Bye 6 · ADP 14" line; then the chips that set this card apart and the line that does the same in words.
 * Availability and actions sit on the right. The leader is the list's largest row and holds its one filled action;
 * the other three are compact, with outlined actions.
 */
export const SuggestionRow = React.memo(function SuggestionRow(props: SuggestionCardProps): React.ReactElement {
  const { recommendation, rank, shortcut, player, isQueued, isSelected, draftStatus, onToggleQueue, onSelect, onExplain, lead = false, signals } = props;
  const { availability, verdict, summary, flag, explanationDetails } = useSuggestionCardModel(props);
  const ids = getSuggestionIds(recommendation.playerId);
  const name = recommendation.playerName;
  return (
    // The name is the card's native selection control for the analysis beside the list; a click elsewhere on the
    // card does the same for pointer users. Draft, Queue and Full reasoning stay independent controls.
    <article
      className={ROW_CARD}
      data-selected={isSelected || undefined}
      data-suggestion-card=""
      data-lead={lead || undefined}
      aria-labelledby={ids.name}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea')) return;
        onSelect?.(recommendation.playerId);
      }}
    >
      <PlayerHeadshot playerId={recommendation.playerId} name={name} position={recommendation.position} className={ROW_HEADSHOT} />
      <div className="suggestion-identity">
        <div className="suggestion-title">
          <span className="suggestion-rank">#{String(rank)}</span>
          <h3 id={ids.name} className="suggestion-name">
            <button type="button" className="suggestion-select" data-suggestion-select="" title={name}
              aria-label={`View analysis for ${name}`} aria-pressed={isSelected} aria-describedby={ids.hint}
              onClick={() => { onSelect?.(recommendation.playerId); }}>
              {name}
            </button>
          </h3>
          <SuggestionMeta recommendation={recommendation} player={player} />
        </div>
        <div className="suggestion-signals" data-card-chips="">
          {/* A verdict the leader already shows is dropped; with no verdict at all (the final pick), the chip is the
              card's keyboard-reachable Details trigger and always stays. */}
          {verdict && signals?.showVerdict === false ? null : <VerdictChip verdict={verdict} withRule={false} details={explanationDetails} />}
          <CardFlagChip flag={flag} player={player} />
          {/* The leader links to its full reasoning; selecting any other card shows its analysis beside the list. */}
          <SuggestionReason summary={summary} playerName={name} onFullReasoning={lead || !onSelect ? () => { onExplain(recommendation.playerId); } : undefined} />
        </div>
      </div>
      <SuggestionAvailability availability={availability} />
      <div className="suggestion-actions" data-suggestion-action={recommendation.playerId}>
        <SuggestionPrimaryAction {...props} quiet={!lead} />
        <SuggestionQueueButton playerId={recommendation.playerId} name={name} isQueued={isQueued} primary={!hasPrimaryAction(props)} compact quiet={!lead} onToggleQueue={onToggleQueue} />
        <SuggestionKeyHint id={ids.hint} shortcut={shortcut} />
      </div>
      <SuggestionError playerId={recommendation.playerId} draftStatus={draftStatus} />
    </article>
  );
});
