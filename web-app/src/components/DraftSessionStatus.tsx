import { useDraftState, useConnectionState } from '@/workspace/WorkspaceProvider';
import { DRAFT_DISPLAY, IS_DEMO } from '@/lib/demo-mode';
import { createSlotSequence } from '@fantasy-draft/shared/draft';
import * as React from 'react';
import { CircleAlert, Info, Settings2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { IconTooltip } from '@/components/ui/tooltip';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import { getRecommendationPolicyLabel } from '@fantasy-draft/shared/draft';
import type { KeeperPreloadStatus } from '@/hooks/useKeeperPreload';
import { KeeperStatus } from '@/features/draft-room/KeeperStatus';
import { useOptionalLiveDraftSync } from '@/features/draft-room/LiveDraftSyncProvider';
import type { DraftSynchronizationState } from '@/lib/draft-sync-state';

export type HeaderSyncTone = 'local' | 'ok' | 'pending' | 'warn' | 'lost';

/**
 * The header's plain sync state, in a word or two: a mock or preview never syncs ("Local"); a live draft says whether
 * its provider picks are current. Shown beside the mode at every desktop size, in every mode.
 */
export function getHeaderSyncState(sessionMode: 'setup' | 'mock' | 'live', synchronizationState: DraftSynchronizationState | null): { readonly label: string; readonly tone: HeaderSyncTone } {
  if (sessionMode === 'mock') return { label: 'Local', tone: 'local' };
  if (sessionMode === 'setup') return { label: 'Not connected', tone: 'local' };
  switch (synchronizationState) {
    case 'confirmed': return { label: 'Synced', tone: 'ok' };
    case 'complete': return { label: 'Draft complete', tone: 'ok' };
    case 'reconciling': return { label: 'Syncing', tone: 'pending' };
    case 'delayed': return { label: 'Sync delayed', tone: 'warn' };
    case 'manual-continuity': return { label: 'Sync lost · recording locally', tone: 'lost' };
    case 'disconnected': return { label: 'Disconnected', tone: 'lost' };
    default: return { label: 'Connecting', tone: 'pending' };
  }
}

/**
 * Pick, mode and setup health behind one popover. `compact` (the draft room, where the turn banner already
 * shows the pick) lets it shrink to its status icon at laptop widths so the header stays on one row.
 */
export function DraftSessionStatus({ keeperStatus, onManageLeagueSettings, compact = false }: {
  readonly compact?: boolean;
  readonly keeperStatus?: KeeperPreloadStatus;
  readonly onManageLeagueSettings?: () => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const transferringFocus = React.useRef(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const config = useDraftState((state) => state.config);
  const sessionMode = useDraftState((state) => state.sessionMode);
  const connection = useConnectionState((state) => state.connection);
  const quickMock = useDraftState((state) => state.leagueSettings.keepersEnabled === false && state.leagueSettings.source === 'default');
  const settingsSource = useDraftState((state) => state.leagueSettings.source);
  const decision = useDraftDecision();
  const primarySettings = decision.readiness?.coreDraftData.find((item) => item.key === 'primary-league-settings');
  const settingsReady = primarySettings?.status === 'ready';
  const needsAttention = decision.readiness?.status === 'blocked' || keeperStatus?.isMockReady === false;
  const mode = sessionMode === 'setup' ? 'Preview' : sessionMode === 'mock' ? 'Mock draft' : connection?.usePrimaryLeagueSettings || connection?.settingsProfile === 'quick-mock' ? 'Sleeper mock' : 'Live draft';
  const liveSync = useOptionalLiveDraftSync();
  const sync = getHeaderSyncState(sessionMode, liveSync?.synchronizationState ?? null);
  const complete = decision.currentPick > config.totalTeams * config.totalRounds;
  const pick = complete ? 'Draft complete' : `Pick ${createSlotSequence({ type: config.draftType, teams: config.totalTeams, rounds: config.totalRounds }).label(decision.currentPick)}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <IconTooltip label="Draft session details">
      <PopoverTrigger asChild>
        <Button ref={triggerRef} variant="ghost" size="sm" className="draft-session-status" data-compact={compact ? '' : undefined} aria-label={`Draft status: ${pick}, ${mode}, ${sync.label}.${needsAttention ? ' Setup needs attention.' : ''} View details`}>
          <span className="draft-session-pick">{pick}</span>
          {!complete ? <span className="draft-session-overall text-muted-foreground">#{String(decision.currentPick)}</span> : null}
          <span className="draft-session-mode">{mode}</span>
          <span className="draft-session-sync" data-sync={sync.tone}>{sync.label}</span>
          {needsAttention
            ? <CircleAlert className="size-3 text-warning" aria-hidden="true" />
            : <Info className="size-3 text-muted-foreground" aria-hidden="true" />}
        </Button>
      </PopoverTrigger>
      </IconTooltip>
      <PopoverContent aria-label="Draft session details" className="w-96" onCloseAutoFocus={(event) => {
        if (transferringFocus.current) {
          event.preventDefault();
          transferringFocus.current = false;
        }
      }}>
        <h2 className="pr-8 text-sm font-semibold">Draft session</h2>
        <p className="mt-2 text-sm">{pick} · {mode} · {sync.label}</p>
        <p className="mt-2 text-sm text-muted-foreground">{String(config.totalTeams)} teams · {String(config.totalRounds)} rounds · Snake</p>
        <p className="mt-2 text-sm text-muted-foreground">{quickMock ? 'Quick mock scoring and roster rules' : getRecommendationPolicyLabel(decision.overall.selection, DRAFT_DISPLAY)}</p>
        {keeperStatus ? <div className="mt-4"><KeeperStatus status={keeperStatus} /></div> : null}
        <section className="mt-4 border-t border-border pt-4" aria-label="League settings">
          <h3 className="text-sm font-semibold">{quickMock ? 'Quick mock settings' : 'Primary League settings'}</h3>
          <p className="mt-1 text-xs font-medium text-muted-foreground">
            {quickMock ? 'Local practice rules · No keepers' : settingsReady ? settingsSource === 'default' ? 'Practice settings selected' : 'Provider settings verified' : 'Needs verification'}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {quickMock ? IS_DEMO ? 'This demo mock uses its own scoring and roster rules. Change them in League setup before the first pick.' : 'Your mock uses its own scoring and roster rules. No Primary League connection is required.' : settingsReady
              ? settingsSource === 'default'
                ? 'These local settings are for practice. Connect your Primary League draft to verify its scoring and roster settings.'
                : primarySettings.message
              : primarySettings?.correctiveAction ?? 'Connect the Primary League draft to verify scoring and roster settings.'}
          </p>
          {onManageLeagueSettings ? <Button className="mt-3 w-full" size="sm" onClick={() => {
            transferringFocus.current = true;
            setOpen(false);
            // The status button opens League setup by way of this popover: focus it first, so the dialog takes it
            // as its opener and hands focus back to it when it closes.
            triggerRef.current?.focus({ preventScroll: true });
            onManageLeagueSettings();
          }}>
            <Settings2 className="size-4" aria-hidden="true" />
            League setup
          </Button> : null}
        </section>
        {decision.readiness && decision.readiness.productBlockingFailures.some((item) => item.key !== 'primary-league-settings') ? (
          <section className="mt-4 border-t border-border pt-4" aria-label="Other draft setup issues">
            <h3 className="text-sm font-semibold">Other setup issues</h3>
            {decision.readiness.productBlockingFailures.filter((item) => item.key !== 'primary-league-settings').map((item) => (
              <p key={item.key} className="mt-2 text-xs leading-relaxed text-muted-foreground"><strong>{item.label}:</strong> {item.correctiveAction}</p>
            ))}
          </section>
        ) : null}
        <PopoverClose asChild>
          <Button variant="ghost" size="icon-sm" className="absolute right-2 top-2" aria-label="Close draft details">
            <X className="size-4" aria-hidden="true" />
          </Button>
        </PopoverClose>
      </PopoverContent>
    </Popover>
  );
}
