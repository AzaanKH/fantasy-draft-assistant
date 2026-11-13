import type * as React from 'react';
import { Button } from '@/components/ui/button';
import { usePickLock, useOrphanedPickFailure } from './pick-in-flight';

/**
 * Workspace-level fallback for a failed Draft whose control is gone, e.g. a save started on the Draft page that
 * failed after the user opened the Assistant. It stays until dismissed, or until the draft moves on and the
 * failure is stale. While the originating control is mounted it shows the failure itself, so this stays hidden.
 */
export function PickFailureNotice(): React.ReactElement | null {
  const failure = useOrphanedPickFailure();
  const lock = usePickLock();
  if (!failure) return null;
  return (
    <aside role="alert" className="pick-failure-notice" aria-label="Pick not saved">
      <p><strong>Pick not saved.</strong> {failure.message}</p>
      {failure.retry ? (
        <Button size="sm" onClick={() => { lock.dismissFailure(); failure.retry?.(); }}>Retry</Button>
      ) : null}
      <Button size="sm" variant="outline" onClick={() => { lock.dismissFailure(); }}>Dismiss</Button>
    </aside>
  );
}
