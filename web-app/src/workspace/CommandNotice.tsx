import { useEffect, useState, type ReactElement } from 'react';
import { useStore } from 'zustand';
import { useWorkspace } from './WorkspaceProvider';
import type { Workspace } from './workspace';

/** A save still running after this long is worth telling the manager about. */
const SLOW_SAVE_MS = 800;

function Notice({ status, dismissError }: { readonly status: NonNullable<Workspace['status']>; readonly dismissError: Workspace['dismissError'] }) {
  const pending = useStore(status, state => state.pending);
  const error = useStore(status, state => state.error);
  const saving = pending > 0;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!saving) { setSlow(false); return; }
    const timer = window.setTimeout(() => { setSlow(true); }, SLOW_SAVE_MS);
    return () => { window.clearTimeout(timer); };
  }, [saving]);
  // Fixed to the corner, never in the page flow: a live draft saves on every sync, and a bar that appears above the
  // header for each one moves the whole page down and back. A save that finishes quickly is never shown at all.
  if (!error && !pending) return null;
  return <div className="command-notice">
    {error ? <aside role="alert" className="command-notice-error">Draft change was not saved. {error} {dismissError ? <button type="button" onClick={dismissError}>Dismiss save error</button> : null}</aside> : null}
    {pending ? <aside role="status" aria-live="polite" className="command-notice-pending" data-slow={slow || undefined}>Saving {pending} draft {pending === 1 ? 'change' : 'changes'}...</aside> : null}
  </div>;
}

export function CommandNotice(): ReactElement | null {
  const { status, dismissError } = useWorkspace();
  return status ? <Notice status={status} dismissError={dismissError} /> : null;
}
