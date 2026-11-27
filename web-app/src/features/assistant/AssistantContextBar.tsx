import type { Recommendation } from '@fantasy-draft/shared/draft';
import type { Player } from '@fantasy-draft/shared/league';
import type { DraftProvider } from '@fantasy-draft/shared/sync';
import * as React from 'react';
import { PositionTag } from '@/components/PositionTag';
import { formatAvailabilityPercent, getNextPickAvailability } from '@/lib/next-pick-availability';
import { getSyncStatus, type AssistantDraftMode } from './assistant-context';
import { ViewedPlayerAction } from './ViewedPlayerAction';
import { useNow } from '@/workspace/useNow';

/**
 * The Assistant's bar under the decision hero: the view tabs, the top pick while Position tiers is open, and sync
 * freshness for a live draft. The hero above it owns the turn and the lens, so each fact is said once on the page.
 */
export function AssistantContextBar({
  tabs,
  topPick,
  sync,
}: {
  /** The Suggestions / Position tiers tabs, at the bar's start. */
  readonly tabs: React.ReactNode;
  /** The top suggestion, on views where its card is not on screen. */
  readonly topPick?: React.ReactNode;
  readonly sync: AssistantSyncStatusInput;
}): React.ReactElement {
  return (
    <div className="rec-context">
      {tabs}
      {topPick}
      <div className="rec-context-status">
        <AssistantSyncStatus sync={sync} />
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
