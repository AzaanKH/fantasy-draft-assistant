import { useEffect, useState, type ReactElement } from 'react';
import type { Root } from 'react-dom/client';
import type { Workspace } from './workspace';
import type { VerifiedStorageSharing } from './storage-sharing';
import { createActivationStorage, ActivationStaleError, type ActivationReview, type ActivationDecision } from './activation-storage';
import { createDurableWorkspace } from './durable-workspace';
import { observeDurableWorkspace } from './ui-dispatch';

type Controller = ReturnType<typeof createActivationStorage>;

function OpeningWorkspace({ database, controller, ready, activated }: {
  readonly database: Awaited<ReturnType<Controller['activate']>>;
  readonly controller: Controller;
  readonly ready: (workspace: Workspace) => void;
  readonly activated: boolean;
}): ReactElement {
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const workspace = createDurableWorkspace({ database, search: window.location.search, resumeConfirmedConnection: true });
    const lifetime = new AbortController();
    let published = false;
    const timer = window.setTimeout(() => { setSlow(true); }, 10_000);
    void (async () => {
      try {
        await workspace.ready;
        window.clearTimeout(timer);
        if (lifetime.signal.aborted) return;
        setSlow(false);
        published = true;
        ready(observeDurableWorkspace(workspace));
      } catch (failure) {
        window.clearTimeout(timer);
        workspace.dispose();
        if (lifetime.signal.aborted) return;
        controller.close();
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    })();
    return () => { lifetime.abort(); window.clearTimeout(timer); if (!published) workspace.dispose(); };
  }, [database, controller, ready]);
  if (error !== null) return activated
    ? <main role="alert" className="mx-auto max-w-4xl space-y-5 p-6 text-foreground" data-storage-blocked="activated">
      <p>Draft storage was activated, but the app couldn't open it. Reload the page to continue.</p><p>{error}</p>
    </main>
    : <main role="alert" data-storage-blocked="activation">Draft storage could not open. Your saved drafts are unchanged. Reload the page to try again. {error}</main>;
  return <main role="status" className="mx-auto max-w-4xl space-y-5 p-6 text-foreground">
    {slow ? <>
      <p>Still opening your draft storage. This usually means another draft tab is busy. Close other draft tabs or reload.</p>
      <button type="button" className="rounded border px-4 py-2" onClick={() => { location.reload(); }}>Reload</button>
    </> : activated ? 'Activating...' : 'Checking draft storage...'}
  </main>;
}

/** How many times startup re-reads saved drafts that changed between the check and the write before giving up. */
const MOVE_ATTEMPTS = 3;

/**
 * Chooses the outcome for every saved record that used to need a person's review. Both actions keep the original
 * bytes in IndexedDB, so nothing is destroyed: the session is kept as imported where that is offered, and the entry
 * is left out of the import otherwise.
 */
export async function settleActivation(controller: Controller): Promise<{ readonly review: ActivationReview; readonly decisions: readonly ActivationDecision[] }> {
  let decisions: readonly ActivationDecision[] = [];
  let review = await controller.preflight();
  // Settling one record can surface another, so decide until none is left or nothing new can be decided.
  while (review.status === 'review' && !review.ready) {
    const decided = new Set(decisions.map(row => row.blockerId));
    const next = review.blockers.filter(blocker => !decided.has(blocker.id) && blocker.actions.length > 0).map((blocker): ActivationDecision => ({
      blockerId: blocker.id, digest: blocker.digest, action: blocker.actions.includes('keep-imported') ? 'keep-imported' : 'discard-entry',
    }));
    if (next.length === 0) break;
    const current = new Set(review.blockers.map(blocker => blocker.id));
    decisions = [...decisions.filter(row => current.has(row.blockerId)), ...next];
    review = await controller.preflight(decisions);
  }
  return { review, decisions };
}

function Blocked({ message }: { readonly message: string }): ReactElement {
  return <main role="alert" className="mx-auto max-w-4xl space-y-5 p-6 text-foreground" data-storage-blocked="activation">
    <p>Draft storage could not open. Your saved drafts are unchanged. Reload the page to try again.</p><p>{message}</p>
    <button type="button" className="rounded border px-4 py-2" onClick={() => { location.reload(); }}>Reload</button>
  </main>;
}

export function showStorageActivation({ root, verified, ready }: { readonly root: Root; readonly verified: VerifiedStorageSharing; readonly ready: (workspace: Workspace) => void }): void {
  if (verified.origin !== window.location.origin) throw new Error('Storage verification belongs to another origin');
  const controller = createActivationStorage({ storage: localStorage, factory: indexedDB, report: () => undefined });
  root.render(<main role="status">Checking draft storage...</main>);
  void (async () => {
    const database = await controller.resume();
    if (database) {
      root.render(<OpeningWorkspace database={database} controller={controller} ready={ready} activated={false} />);
      return;
    }
    for (let attempt = 1; ; attempt += 1) {
      const { review, decisions } = await settleActivation(controller);
      if (review.status !== 'review') { controller.close(); root.render(<Blocked message={review.message} />); return; }
      if (!review.ready) { controller.close(); root.render(<Blocked message="A saved draft could not be read or moved." />); return; }
      try {
        // Drafts saved in the older format move across without a review screen; nothing writes that format any more.
        const activated = await controller.activate(decisions, { otherTabsClosed: true });
        root.render(<OpeningWorkspace database={activated} controller={controller} ready={ready} activated />);
        return;
      } catch (failure) {
        // Something was saved between the check and the write: read what is there now and try again.
        if (!(failure instanceof ActivationStaleError) || attempt === MOVE_ATTEMPTS) throw failure;
      }
    }
  })().catch((error: unknown) => { controller.close(); root.render(<Blocked message={error instanceof Error ? error.message : String(error)} />); });
}
