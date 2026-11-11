import * as React from 'react';
import type { Player } from '@fantasy-draft/shared/league';
import type { DraftProvider } from '@fantasy-draft/shared/sync';
import { Check, ListPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProvisionalPickDialog } from '@/features/draft-room/ProvisionalPickDialog';
import { useDraftPlayerAction } from '@/hooks/useDraftPlayerAction';
import { IS_DEMO } from '@/lib/demo-mode';
import { useInViewport } from '@/lib/use-in-viewport';
import { getProviderName } from '@/lib/provider-name';
import type { AssistantDraftMode } from './assistant-context';

/**
 * The mode-aware action beside the viewed player's analysis, so a decision made while reading never needs a
 * trip back to the cards: Draft on your turn in a mock, Record (the Provisional Pick dialog) during live Manual
 * Continuity, and plain guidance otherwise. Both actions respect the workspace's shared pick lock.
 */
export function ViewedPlayerAction({ player, playerName, mode, provider, nextPickLabel, isQueued = false, quiet = false, onQueue }: {
  /** Undefined when the viewed player has been drafted. */
  readonly player: Player | undefined;
  readonly playerName: string;
  readonly mode: AssistantDraftMode;
  readonly provider: DraftProvider | null;
  readonly nextPickLabel: string | null;
  readonly isQueued?: boolean;
  /** Outlined, beside the suggestion cards, whose leader holds the page's one filled action. */
  readonly quiet?: boolean;
  /** Queue toggle beside Draft; omitted for a drafted subject. */
  readonly onQueue?: (playerId: string) => void;
}): React.ReactElement {
  // Reports its own failure only while the control itself (Draft, which becomes Retry) is wholly on screen. The
  // wrapper is not enough: a failure message grows it into view while the Retry button stays clipped, so a partly
  // visible control hands the failure to the workspace notice and its Retry instead.
  const [controlRef, onScreen] = useInViewport<HTMLSpanElement>({ fully: true, belowStickyHeader: true });
  const reportsFor = React.useMemo(() => (player && onScreen ? [player.id] : []), [onScreen, player]);
  const { canDraft, canDraftPlayer, draftPlayer, draftStatus, isMyTurn, pickInFlight } = useDraftPlayerAction(reportsFor);
  const [recording, setRecording] = React.useState(false);
  const status = player && draftStatus?.playerId === player.id ? draftStatus : null;

  let control: React.ReactNode = null;
  let note: string;
  if (mode === 'mock') {
    if (!player) note = `${playerName} can no longer be drafted.`;
    else if (!canDraft) note = isMyTurn ? 'A keeper occupies this pick.' : `Waiting for your turn${nextPickLabel ? ` at ${nextPickLabel}` : ''}.`;
    else if (!canDraftPlayer(player)) note = `${player.position} limit reached.`;
    else {
      // Beside a Draft button the mode needs no sentence; only a pick saving elsewhere does.
      note = pickInFlight && status?.state !== 'pending' ? 'Another pick is saving.' : '';
      control = (
        <Button size="sm" className="rec-action" variant={status?.state === 'failed' ? 'destructive' : quiet ? 'outline' : 'default'}
          disabled={pickInFlight} aria-busy={status?.state === 'pending' || undefined}
          aria-label={status?.state === 'failed' ? `Retry drafting ${player.name}` : `Draft ${player.name}`}
          title="Quick Mock. Picks are made here."
          onClick={() => { draftPlayer(player); }}>
          {status?.state === 'pending' ? 'Saving…' : status?.state === 'failed' ? 'Retry draft' : 'Draft'}
        </Button>
      );
    }
  } else if (mode === 'manual-continuity') {
    note = player ? '' : 'Record each pick as it happens. It is confirmed when sync returns.';
    if (player) {
      control = (
        <Button size="sm" className="rec-action" variant={quiet ? 'outline' : 'default'} disabled={pickInFlight} aria-label={`Record ${player.name} as a provisional pick`}
          title="Record each pick as it happens. It is confirmed when sync returns."
          onClick={() => { setRecording(true); }}>
          Record pick
        </Button>
      );
    }
  } else if (mode === 'companion') {
    note = `Make the pick in ${provider ? getProviderName(provider) : 'your draft room'}. This assistant does not submit picks.`;
  } else {
    note = IS_DEMO ? 'Preview. Start a mock to make picks.' : 'Preview. Connect a draft or start a mock to make picks.';
  }

  return (
    <div className="rec-viewed-action">
      {control || (player && onQueue) ? (
        <span className="rec-viewed-action-buttons">
          {control ? <span ref={controlRef} className="rec-viewed-action-control">{control}</span> : null}
          {player && onQueue ? (
            <Button variant={isQueued ? 'secondary' : 'outline'} size="icon-sm" aria-pressed={isQueued}
              aria-label={isQueued ? `Remove ${player.name} from queue` : `Add ${player.name} to queue`}
              title={isQueued ? 'Remove from queue' : 'Add to queue'} onClick={() => { onQueue(player.id); }}>
              {isQueued ? <Check className="size-4" aria-hidden="true" /> : <ListPlus className="size-4" aria-hidden="true" />}
            </Button>
          ) : null}
        </span>
      ) : null}
      {note ? <p className="rec-action-note" data-provider-instruction={mode === 'companion' || undefined}>{note}</p> : null}
      {status?.state === 'failed' ? <p role="alert" className="rec-viewed-action-error">{status.message}</p> : null}
      {recording && player ? (
        <ProvisionalPickDialog open initialPlayerId={player.id} onOpenChange={(open) => { if (!open) setRecording(false); }} />
      ) : null}
    </div>
  );
}
