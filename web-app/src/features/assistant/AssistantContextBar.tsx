import * as React from 'react';
import { getSyncStatus } from './assistant-context';
import { useNow } from '@/workspace/useNow';

/**
 * The Assistant's bar under the decision hero: the view tabs and sync freshness for a live draft. The hero above it
 * owns the turn, the lens and the top pick, so each fact is said once on the page.
 */
export function AssistantContextBar({
  tabs,
  sync,
}: {
  /** The Suggestions / Position tiers tabs, at the bar's start. */
  readonly tabs: React.ReactNode;
  readonly sync: AssistantSyncStatusInput;
}): React.ReactElement {
  return (
    <div className="rec-context">
      {tabs}
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
