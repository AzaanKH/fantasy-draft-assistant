import { useEffect, useState, type ReactElement } from 'react';
import type { Root } from 'react-dom/client';
import type { Workspace } from './workspace';
import type { VerifiedStorageSharing } from './storage-sharing';
import { createActivationStorage, ActivationStaleError, type ActivationReview, type ActivationDecision } from './activation-storage';
import { createDurableWorkspace } from './durable-workspace';
import { observeDurableWorkspace } from './ui-dispatch';

type Controller = ReturnType<typeof createActivationStorage>;
type Review = Extract<ActivationReview, { status: 'review' }>;

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
        if (import.meta.env.DEV) void import('./operator-rollback').then(({ installRollbackOperator }) => { installRollbackOperator(workspace); });
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
    : <main role="alert" data-storage-blocked="activation">Draft storage setup failed. Your v1 records remain retained. Reload the page to try again. {error}</main>;
  return <main role="status" className="mx-auto max-w-4xl space-y-5 p-6 text-foreground">
    {slow ? <>
      <p>Still opening your draft storage. This usually means another draft tab is busy. Close other draft tabs or reload.</p>
      <button type="button" className="rounded border px-4 py-2" onClick={() => { location.reload(); }}>Reload</button>
    </> : activated ? 'Activating...' : 'Checking draft storage...'}
  </main>;
}

function ReadOnlyDrafts({ review }: { readonly review: Review }): ReactElement {
  return <section aria-label="Saved drafts, read only" className="space-y-3">
    <h2 className="text-lg font-semibold">Saved drafts, read only</h2>
    <p>Review your picks and queue before continuing. Original records stay retained for recovery.</p>
    {review.sessions.map(session => <details key={`${session.identity.provider}:${session.identity.draftId}`} className="rounded border p-3">
      <summary>{session.identity.provider} {session.identity.draftId}: {session.draftHistory.length} picks, {session.shortlistedPlayerIds.length} queued, next pick {session.currentPick}</summary>
      <pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(session, null, 2)}</pre>
    </details>)}
    <details className="rounded border p-3"><summary>Original v1 records ({review.source.length})</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(review.source, null, 2)}</pre></details>
  </section>;
}

function ActivationSetup({ controller, initial, ready }: { readonly controller: Controller; readonly initial: ActivationReview; readonly ready: (workspace: Workspace) => void }): ReactElement {
  const [review, setReview] = useState(initial);
  const [decisions, setDecisions] = useState<readonly ActivationDecision[]>([]);
  const [closed, setClosed] = useState(false);
  const [pending, setPending] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [database, setDatabase] = useState<Awaited<ReturnType<Controller['activate']>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const choose = async (decision: ActivationDecision): Promise<void> => {
    setPending(true); setError(null);
    const next = [...decisions.filter(row => row.blockerId !== decision.blockerId), decision];
    try { setReview(await controller.preflight(next)); setDecisions(next); }
    catch (failure) { setError(String(failure)); }
    finally { setPending(false); }
  };
  const activate = async (): Promise<void> => {
    if (!closed || pending || cancelled || database !== null) return;
    setPending(true); setError(null);
    try {
      setDatabase(await controller.activate(decisions, { otherTabsClosed: true }));
    }
    catch (failure) {
      if (failure instanceof ActivationStaleError) {
        setDecisions([]); setClosed(false);
        try { setReview(await controller.preflight()); }
        catch (reviewFailure) { setError(reviewFailure instanceof Error ? reviewFailure.message : String(reviewFailure)); return; }
      }
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setPending(false); }
  };
  if (database) return <OpeningWorkspace database={database} controller={controller} ready={ready} activated />;
  return <main className="mx-auto max-w-4xl space-y-5 p-6 text-foreground" data-storage-activation="review">
    <h1 className="text-2xl font-semibold">Draft storage setup</h1>
    <p>Your v1 draft data is read only while storage setup is open.</p>
    {error ? <p role="alert">{error}</p> : null}
    {cancelled ? <p role="status">Activation cancelled. Your v1 records are unchanged. Reload to review storage setup again.</p> : null}
    {review.status !== 'review' ? <section role="alert" data-storage-blocked={review.status}>
      <p>{review.message}</p><p>Your draft remains on v1. No migration marker was written by this attempt.</p>
    </section> : <>
      <ReadOnlyDrafts review={review} />
      {review.blockers.map(blocker => <section key={blocker.id} className="space-y-2 rounded border p-3" aria-label={`Reconcile ${blocker.id}`}>
        <h2 className="font-semibold">Review {blocker.identity ? `${blocker.identity.provider} ${blocker.identity.draftId}` : 'saved record'}</h2>
        <p>{blocker.reasons.join(' ')}</p>
        <details><summary>Compare saved facts and retained entries</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ committed: blocker.indexed, incoming: blocker.incoming, comparison: blocker.comparison, entries: blocker.entries }, null, 2)}</pre></details>
        <label className="block">Choose how to resolve this entry
          <select aria-label={`Resolve ${blocker.id}`} className="m-2 rounded border bg-background p-2" disabled={pending || cancelled}
            value={decisions.find(row => row.blockerId === blocker.id)?.action ?? ''}
            onChange={event => { const action = event.target.value; if (action === 'keep-imported' || action === 'discard-entry') void choose({ blockerId: blocker.id, digest: blocker.digest, action }); }}>
            <option value="" disabled>Choose an action</option>
            {blocker.actions.includes('keep-imported') ? <option value="keep-imported">Keep the session as imported; retain unresolved bytes</option> : null}
            {blocker.actions.includes('discard-entry') ? <option value="discard-entry">Discard this entry from import; retain its original bytes</option> : null}
          </select>
        </label>
      </section>)}
      <section className="space-y-3 rounded border p-4" aria-label="Close other draft windows">
        <h2 className="text-lg font-semibold">Close other draft tabs and side panels</h2>
        <p>Close every other draft tab and extension side panel before continuing. An older cached tab can still race once before the migration marker reaches it.</p>
        <label className="flex gap-2"><input type="checkbox" checked={closed} disabled={pending || cancelled} onChange={event => { setClosed(event.target.checked); }} />I have closed other draft tabs and side panels</label>
        <button type="button" className="rounded border bg-primary px-4 py-2 text-primary-foreground" disabled={!closed || !review.ready || pending || cancelled} onClick={() => { void activate(); }}>{pending ? 'Activating...' : 'Activate IndexedDB'}</button>
      </section>
    </>}
    <button type="button" className="rounded border px-4 py-2" disabled={pending || cancelled} onClick={() => { controller.cancel(); controller.close(); setCancelled(true); }}>Cancel activation</button>
  </main>;
}

export function showStorageActivation({ root, verified, ready }: { readonly root: Root; readonly verified: VerifiedStorageSharing; readonly ready: (workspace: Workspace) => void }): void {
  if (verified.origin !== window.location.origin) throw new Error('Storage verification belongs to another origin');
  const controller = createActivationStorage({ storage: localStorage, factory: indexedDB, report: () => undefined });
  root.render(<main role="status">Checking draft storage...</main>);
  void (async () => {
    if (import.meta.env.DEV) {
      const { installRollbackOperator } = await import('./operator-rollback');
      installRollbackOperator();
    }
    const database = await controller.resume();
    if (database) {
      root.render(<OpeningWorkspace database={database} controller={controller} ready={ready} activated={false} />);
      return;
    }
    const review = await controller.preflight();
    root.render(<ActivationSetup controller={controller} initial={review} ready={ready} />);
  })().catch((error: unknown) => { controller.close(); root.render(<main role="alert" data-storage-blocked="activation">Draft storage setup failed. Your v1 records remain retained. Reload the page to try again. {String(error)}</main>); });
}
