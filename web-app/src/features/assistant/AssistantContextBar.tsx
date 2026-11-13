import { createSlotSequence, type DecisionLens, type Recommendation } from '@fantasy-draft/shared/draft';
import type { Player } from '@fantasy-draft/shared/league';
import { type DraftProvider, type DraftType } from '@fantasy-draft/shared/sync';
import * as React from 'react';
import { PositionTag } from '@/components/PositionTag';
import { formatAvailabilityPercent, getNextPickAvailability } from '@/lib/next-pick-availability';
import { formatNextTurn, getSyncStatus, picksUntilTurn, type AssistantDraftMode, type PickWindow } from './assistant-context';
import { ViewedPlayerAction } from './ViewedPlayerAction';
import { useNow } from '@/workspace/useNow';
import { LensToggle } from './AssistantLayout';
import { DraftTurnBanner } from '@/features/draft-room/DraftTurnBanner';

/**
 * The Assistant's one bar: the view tabs, the turn, and the Best Pick / Best Player lens. Each fact is said once on
 * the page. The app header owns the current pick and the mode, so the banner says only whose turn it is and the line
 * beside it says when yours comes; sync freshness shows here only for a live draft. Turn status is the shared
 * keeper-aware banner, so a reserved keeper never reads as "your turn".
 */
export function AssistantContextBar({
  tabs,
  topPick,
  pickWindow,
  totalTeams,
  draftType,
  sync,
  lens,
  onLensChange,
}: {
  /** The Suggestions / Position tiers tabs, at the bar's start. */
  readonly tabs: React.ReactNode;
  /** The top suggestion, on views where its card is not on screen. */
  readonly topPick?: React.ReactNode;
  readonly pickWindow: PickWindow;
  readonly totalTeams: number;
  readonly draftType: DraftType;
  readonly sync: AssistantSyncStatusInput;
  readonly lens: DecisionLens;
  readonly onLensChange: (lens: DecisionLens) => void;
}): React.ReactElement {
  const nextLabel = pickWindow.nextPick === null ? null : createSlotSequence({ type: draftType, teams: totalTeams, rounds: Math.ceil(pickWindow.nextPick / totalTeams) }).label(pickWindow.nextPick);
  const nextTurn = formatNextTurn(picksUntilTurn(pickWindow), nextLabel);

  return (
    <div className="rec-context">
      {tabs}
      {topPick}
      <div className="rec-context-pick">
        <DraftTurnBanner variant="compact" showPick={false} />
        {pickWindow.onClock
          // On the clock, the line beside the banner looks ahead to the next turn.
          ? <span className="rec-context-next" data-next-turn={nextTurn ? '' : undefined}>{nextTurn ?? 'Your final pick'}</span>
          // Waiting, the banner counts the picks, so this line finishes its sentence with where your pick falls.
          : <span className="rec-context-next">{nextLabel ? `at ${nextLabel}` : 'No picks left'}</span>}
      </div>
      <div className="rec-context-status">
        <AssistantSyncStatus sync={sync} />
        <LensToggle lens={lens} onChange={onLensChange} />
      </div>
    </div>
  );
}

type AssistantSyncStatusInput = Omit<Parameters<typeof getSyncStatus>[0], 'lastSyncAgeMs'> & {
  readonly lastSuccessfulSyncAt: number | null;
};

function AssistantSyncStatus({ sync }: { readonly sync: AssistantSyncStatusInput }): React.ReactElement | null {
  const now = useNow();
  const { lastSuccessfulSyncAt, ...input } = sync;
  const status = getSyncStatus({
    ...input,
    lastSyncAgeMs: lastSuccessfulSyncAt === null ? null : Math.max(0, now - lastSuccessfulSyncAt),
  });
  // A mock or preview never syncs; the header already says "Local", so the bar stays quiet about it.
  if (status.tone === 'local') return null;
  return (
    <span className="rec-sync" data-sync={status.tone} role="status">
      <span className="rec-sync-dot" aria-hidden="true" />
      {status.label}
    </span>
  );
}

/**
 * The top suggestion, kept in the bar while Position tiers is open: there the four cards are off screen, so the
 * pick the Assistant would make, its odds of lasting and its Draft action stay one glance and one click away.
 * The name opens the same analysis a tier row does.
 */
export function AssistantTopPick({ recommendation, player, draft, onSelect }: {
  readonly recommendation: Recommendation;
  /** Undefined once the player has been drafted. */
  readonly player: Player | undefined;
  readonly draft: { readonly mode: AssistantDraftMode; readonly provider: DraftProvider | null; readonly nextPickLabel: string | null };
  readonly onSelect: (playerId: string, origin: HTMLElement) => void;
}): React.ReactElement {
  const availability = getNextPickAvailability(recommendation.diagnostics);
  return (
    <div className="rec-top-pick" data-top-pick={recommendation.playerId}>
      <span className="rec-top-pick-label">Top pick</span>
      <button type="button" className="rec-top-pick-name" title={recommendation.playerName}
        aria-label={`View analysis for ${recommendation.playerName}, the top pick`}
        onClick={(event) => { onSelect(recommendation.playerId, event.currentTarget); }}>
        {recommendation.playerName}
      </button>
      <PositionTag position={recommendation.position} />
      {/* A bare figure, as on every tier row below it: the sheet's heading says what the % means. */}
      {availability.kind === 'estimate' ? (
        <strong className="rec-top-pick-odds" title={`Chance of being available ${availability.pickLabel ? `at ${availability.pickLabel}` : 'at your next pick'}`}>
          {formatAvailabilityPercent(availability)}
          <span className="sr-only"> available {availability.pickLabel ? `at ${availability.pickLabel}` : 'at your next pick'}</span>
        </strong>
      ) : null}
      <ViewedPlayerAction player={player} playerName={recommendation.playerName} mode={draft.mode} provider={draft.provider} nextPickLabel={draft.nextPickLabel} />
    </div>
  );
}
