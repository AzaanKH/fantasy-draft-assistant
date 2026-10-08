import * as React from 'react';
import { CircleAlert, Info, Settings2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import { getRecommendationPolicyLabel } from '@/features/recommendations/draft-decision';
import { formatRoundPick } from '@/lib/mock-draft-engine';
import { useDraftStore } from '@/stores/draftStore';
import { useDraftSyncConnectionStore } from '@/stores/draftSyncStore';
import type { KeeperPreloadStatus } from '@/hooks/useKeeperPreload';
import { KeeperStatus } from '@/features/draft-room/KeeperStatus';
import { IS_DEMO } from '@/lib/demo-mode';

export function DraftSessionStatus({ keeperStatus, onManageLeagueSettings }: {
  readonly keeperStatus?: KeeperPreloadStatus;
  readonly onManageLeagueSettings?: () => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const transferringFocus = React.useRef(false);
  const config = useDraftStore((state) => state.config);
  const sessionMode = useDraftStore((state) => state.sessionMode);
  const connection = useDraftSyncConnectionStore((state) => state.connection);
  const quickMock = useDraftStore((state) => state.leagueSettings.keepersEnabled === false && state.leagueSettings.source === 'default');
  const settingsSource = useDraftStore((state) => state.leagueSettings.source);
  const decision = useDraftDecision();
  const primarySettings = decision.readiness?.coreDraftData.find((item) => item.key === 'primary-league-settings');
  const settingsReady = primarySettings?.status === 'ready';
  const needsAttention = decision.readiness?.status === 'blocked' || keeperStatus?.isMockReady === false;
  const mode = sessionMode === 'setup' ? 'Preview' : sessionMode === 'mock' ? 'Mock draft' : connection?.usePrimaryLeagueSettings || connection?.settingsProfile === 'quick-mock' ? 'Sleeper mock' : 'Live draft';
  const complete = decision.currentPick > config.totalTeams * config.totalRounds;
  const pick = complete ? 'Draft complete' : `Pick ${formatRoundPick(decision.currentPick, config.totalTeams)}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="draft-session-status" aria-label={`Draft status: ${pick}, ${mode}.${needsAttention ? ' Setup needs attention.' : ''} View details`}>
          <span className="draft-session-pick">{pick}</span>
          {!complete ? <span className="text-muted-foreground">#{String(decision.currentPick)}</span> : null}
          <span className="draft-session-mode">{mode}</span>
          {needsAttention
            ? <CircleAlert className="size-3 text-amber-600 dark:text-amber-300" aria-hidden="true" />
            : <Info className="size-3 text-muted-foreground" aria-hidden="true" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Draft session details" className="w-96" onCloseAutoFocus={(event) => {
        if (transferringFocus.current) {
          event.preventDefault();
          transferringFocus.current = false;
        }
      }}>
        <h2 className="pr-8 text-sm font-semibold">Draft session</h2>
        <p className="mt-2 text-sm">{pick} · {mode}</p>
        <p className="mt-2 text-sm text-muted-foreground">{String(config.totalTeams)} teams · {String(config.totalRounds)} rounds · Snake</p>
        <p className="mt-2 text-sm text-muted-foreground">{quickMock ? 'Quick mock scoring and roster rules' : getRecommendationPolicyLabel(decision.overall.selection)}</p>
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
