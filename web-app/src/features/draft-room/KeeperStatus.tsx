import { CheckCircle2, CircleAlert } from 'lucide-react';
import type { KeeperPreloadStatus } from '@/hooks/useKeeperPreload';
import { cn } from '@/lib/utils';

export function KeeperStatus({ status }: { readonly status: KeeperPreloadStatus }): React.ReactElement {
  const isReady = status.isMockReady;
  const message = status.isLoading
    ? 'Loading keeper assignments…'
    : status.isError
      ? 'Keeper assignments could not be loaded.'
      : status.duplicateNames.length > 0
        ? `${String(status.duplicateNames.length)} duplicate keeper entries need fixing.`
        : status.invalidAssignments.length > 0
          ? `${String(status.invalidAssignments.length)} keeper slots are invalid or duplicated.`
          : status.unresolvedNames.length > 0
            ? `${String(status.unresolvedNames.length)} keeper names still need resolution.`
      : !status.isConfirmed
        ? 'Confirm the keeper file before starting a mock.'
        : !status.isInitialized
          ? 'Waiting for the complete keeper list to load into the draft.'
          : status.canonicalCount === 0 ? 'No keepers are reserved for this mock.' : `${String(status.canonicalCount)} keepers are reserved on the board.`;

  return (
    <div
      className={cn(
        'flex min-w-0 items-start gap-2 rounded-md border px-3 py-3 text-xs',
        isReady
          ? 'border-emerald-500/20 bg-emerald-500/[0.06]'
          : 'border-amber-500/25 bg-amber-500/[0.07]'
      )}
      role="status"
    >
      {isReady ? (
        <CheckCircle2 className="size-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
      ) : (
        <CircleAlert className="size-4 shrink-0 text-amber-700 dark:text-amber-300" />
      )}
      <div className="min-w-0 leading-tight">
        <div
          className={cn(
            'font-semibold',
            isReady
              ? 'text-emerald-800 dark:text-emerald-300'
              : 'text-amber-800 dark:text-amber-300'
          )}
        >
          {isReady ? 'Mock ready' : 'Mock setup'}
        </div>
        <div className="mt-0.5 leading-relaxed text-muted-foreground" title={message}>
          {message}
        </div>
      </div>
    </div>
  );
}
