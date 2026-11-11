/**
 * The card and strip summary row for the live draft connection: status icon,
 * headline, detail line, freshness dots, and the dialog triggers.
 * Must render inside the connection <Dialog> because it owns the DialogTrigger.
 */
import type * as React from 'react';
import { CheckCircle2, CircleAlert, Link2, LoaderCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DialogTrigger } from '@/components/ui/dialog';
import type { DraftReadinessReport } from '@fantasy-draft/shared/catalog';
import type { DraftProvider } from '@fantasy-draft/shared/sync';
import { cn } from '@/lib/utils';
import { getConnectPresentation, type ConnectPresentation } from './connect-presentation';
import type { useLiveDraftSync } from '@/features/draft-room/LiveDraftSyncProvider';

export interface DraftConnectSummaryRowProps {
  readonly isStrip: boolean;
  readonly liveDraftBlocked: boolean;
  readonly blockerCount: number;
  readonly primaryLiveDraftBlocker: DraftReadinessReport['productBlockingFailures'][number] | undefined;
  readonly connectedDraftId: string | null;
  readonly isError: boolean;
  readonly isConnecting: boolean;
  readonly hasImportWarning: boolean;
  readonly isDraftPositionConfirmed: boolean;
  readonly providerLabel: string;
  readonly provider: DraftProvider;
  readonly rejectedPickCount: number;
  readonly isComplete: boolean;
  readonly isDrafting: boolean;
  readonly isPaused: boolean;
  readonly synchronizationState: ReturnType<typeof useLiveDraftSync>['synchronizationState'];
  readonly totalPicks: number;
  readonly myPicksCount: number;
  readonly myPickPosition: number;
  readonly draftSlotsCount: number;
  readonly lastError: string | null;
  readonly importWarning: string | null;
  readonly confidenceItems: React.ReactNode;
  readonly hasReadinessDetails: boolean;
  readonly onViewDetails: () => void;
}

const TONE_CLASSES: Readonly<Record<ConnectPresentation['tone'], { readonly card: string; readonly strip: string; readonly icon: string; readonly badge: string }>> = {
  bad: { card: 'border-danger/40 bg-danger/[0.06]', strip: 'bg-danger/[0.04]', icon: 'border-danger/50 bg-danger/10 text-danger', badge: '' },
  warn: { card: 'border-warning/40 bg-warning/[0.07]', strip: 'bg-warning/[0.04]', icon: 'border-warning/50 bg-warning/10 text-warning', badge: 'border-warning/50 bg-warning/10 text-warning' },
  ok: { card: 'border-success/35 bg-success/[0.07]', strip: 'bg-success/[0.035]', icon: 'border-success/40 bg-success/10 text-success', badge: 'border-success/40 bg-success/10 text-success' },
  neutral: { card: 'border-dashed bg-muted/20', strip: 'bg-muted/10', icon: 'bg-background text-muted-foreground', badge: '' },
};

export function DraftConnectSummaryRow(props: DraftConnectSummaryRowProps): React.ReactElement {
  const { isStrip, blockerCount, provider, providerLabel, rejectedPickCount, totalPicks, myPicksCount, myPickPosition,
    draftSlotsCount, lastError, importWarning, primaryLiveDraftBlocker, liveDraftBlocked, confidenceItems,
    hasReadinessDetails, onViewDetails, synchronizationState } = props;
  const presentation = getConnectPresentation(props);
  const tone = TONE_CLASSES[presentation.tone];
  const { kind } = presentation;
  const headline = kind === 'blocked' ? primaryLiveDraftBlocker?.label ?? 'Live draft blocked'
    : kind === 'disconnected' ? 'Connect your live draft'
      : kind === 'error' ? `${providerLabel} sync needs attention`
        : kind === 'connecting' ? `Connecting to ${providerLabel}...`
          : kind === 'choose-slot' ? 'Choose your draft slot'
            : kind === 'import-warning' ? `${String(rejectedPickCount)} ${rejectedPickCount === 1 ? 'pick was' : 'picks were'} not imported`
              : `${providerLabel} draft connected`;
  const detail = kind === 'blocked' ? `Action: ${primaryLiveDraftBlocker?.correctiveAction ?? 'Open details.'}`
    : synchronizationState === 'manual-continuity' ? `${String(totalPicks)} provider picks retained · Manual Continuity is recording Provisional Picks locally`
      : kind === 'disconnected' ? 'Import picks automatically, track your roster, and keep recommendations current during the draft.'
        : kind === 'error' ? lastError ?? 'Open sync settings to check the draft URL or ID.'
          : kind === 'connecting' ? 'Fetching the draft room and importing picks.'
            : kind === 'choose-slot' ? `${String(draftSlotsCount)}-team draft found · choose your slot to start importing picks.`
              : kind === 'import-warning' ? importWarning ?? ''
                : `${String(totalPicks)} picks synced · ${String(myPicksCount)} yours · slot ${String(myPickPosition)} · ${provider === 'espn' ? 'live extension feed' : 'updates every second'}`;
  const action = kind === 'disconnected' ? liveDraftBlocked ? 'Connect to verify' : 'Connect draft'
    : kind === 'blocked' ? props.connectedDraftId ? 'Manage sync' : 'Connect to verify'
      : kind === 'error' ? 'Fix connection'
        : kind === 'connecting' ? 'View progress'
          : kind === 'choose-slot' ? 'Choose slot'
            : 'Manage sync';
  const Icon = kind === 'connecting' ? LoaderCircle
    : kind === 'connected' ? CheckCircle2
      : kind === 'disconnected' || kind === 'choose-slot' ? Link2
        : CircleAlert;

  return (
    <div
      data-state={kind}
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
        isStrip ? 'min-h-14 px-3 py-2' : 'rounded-lg border p-4',
        isStrip ? tone.strip : tone.card
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className={cn('flex shrink-0 items-center justify-center rounded-full border', isStrip ? 'size-8' : 'size-9', tone.icon)}>
          <Icon className={cn('size-4', kind === 'connecting' && 'animate-spin')} />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{headline}</span>
            {kind === 'blocked' && blockerCount > 1 ? (
              <span className="text-2xs font-medium text-danger">+{String(blockerCount - 1)} more</span>
            ) : null}
            {presentation.badge ? (
              <Badge variant="outline" className={tone.badge}>{presentation.badge}</Badge>
            ) : null}
          </div>
          <p className={cn('mt-1 text-xs leading-relaxed text-muted-foreground', isStrip && 'truncate')}>{detail}</p>
          {!isStrip && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground">
              {confidenceItems}
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {isStrip && hasReadinessDetails ? (
          <Button variant="ghost" size="sm" aria-haspopup="dialog" onClick={onViewDetails}>
            View details
          </Button>
        ) : null}
        <DialogTrigger asChild>
          <Button variant={presentation.tone === 'ok' || presentation.tone === 'warn' ? 'outline' : 'default'} size="sm" className="shrink-0">
            {action}
          </Button>
        </DialogTrigger>
      </div>
    </div>
  );
}
