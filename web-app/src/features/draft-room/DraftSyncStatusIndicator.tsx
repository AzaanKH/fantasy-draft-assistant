import * as React from 'react';
import {
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Radio,
  RefreshCw,
  Unplug,
} from 'lucide-react';
import {
  formatDraftSyncAge,
  type DraftSynchronizationState,
  type DraftSyncViewState,
} from '@/hooks/useDraftSync';
import { cn } from '@/lib/utils';

interface StatusPresentation {
  readonly label: string;
  readonly icon: typeof Radio;
  readonly className: string;
  readonly animate: boolean;
}

const STATUS_PRESENTATION: Record<DraftSynchronizationState, StatusPresentation> = {
  disconnected: {
    label: 'Disconnected',
    icon: Unplug,
    className: 'text-muted-foreground',
    animate: false,
  },
  reconciling: {
    label: 'Reconciling',
    icon: LoaderCircle,
    className: 'text-sky-700 dark:text-sky-300',
    animate: true,
  },
  confirmed: {
    label: 'Provider Truth confirmed',
    icon: Radio,
    className: 'text-emerald-700 dark:text-emerald-300',
    animate: false,
  },
  delayed: {
    label: 'Provider delayed',
    icon: RefreshCw,
    className: 'text-amber-700 dark:text-amber-300',
    animate: false,
  },
  'manual-continuity': {
    label: 'Manual Continuity',
    icon: Clock3,
    className: 'text-amber-700 dark:text-amber-300',
    animate: false,
  },
  complete: {
    label: 'Complete',
    icon: CheckCircle2,
    className: 'text-emerald-700 dark:text-emerald-300',
    animate: false,
  },
};

export function DraftSyncStatusIndicator({
  sync,
  announce = false,
  compact = false,
  className,
}: {
  readonly sync: DraftSyncViewState;
  readonly announce?: boolean;
  readonly compact?: boolean;
  readonly className?: string;
}): React.ReactElement {
  const presentation = STATUS_PRESENTATION[sync.synchronizationState];
  const Icon = presentation.icon;
  const age = formatDraftSyncAge(sync.lastSyncAgeMs);
  const ageLabel = sync.lastSuccessfulSyncAt === null
    ? compact ? 'No sync yet' : 'Waiting for first sync'
    : compact ? age : `Last sync ${age}`;
  const fullAgeLabel = sync.lastSuccessfulSyncAt === null
    ? 'Waiting for first sync'
    : `Last sync ${age}`;
  const title = sync.lastError
    ? `${presentation.label}: ${sync.lastError}. ${fullAgeLabel}.`
    : `${presentation.label}. ${fullAgeLabel}.`;

  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold',
        presentation.className,
        className
      )}
      role={announce ? 'status' : undefined}
      aria-live={announce ? 'polite' : undefined}
      title={title}
    >
      <Icon
        className={cn('size-3.5 shrink-0', presentation.animate && 'animate-spin')}
        aria-hidden="true"
      />
      <span className="shrink-0 whitespace-nowrap">{presentation.label}</span>
      <span className="truncate font-normal text-muted-foreground">
        · {ageLabel}
      </span>
    </span>
  );
}
