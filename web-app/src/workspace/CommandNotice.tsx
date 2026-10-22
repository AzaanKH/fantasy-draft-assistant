import type { ReactElement } from 'react';
import { useStore } from 'zustand';
import { useWorkspace } from './WorkspaceProvider';
import type { Workspace } from './workspace';

function Notice({ status, dismissError }: { readonly status: NonNullable<Workspace['status']>; readonly dismissError: Workspace['dismissError'] }) {
  const pending = useStore(status, state => state.pending);
  const error = useStore(status, state => state.error);
  return <>
    {error ? <aside role="alert" className="border border-destructive p-3">Draft change was not saved. {error} {dismissError ? <button type="button" onClick={dismissError}>Dismiss save error</button> : null}</aside> : null}
    {pending ? <aside role="status" aria-live="polite" className="border p-2">Saving {pending} draft {pending === 1 ? 'change' : 'changes'}...</aside> : null}
  </>;
}

export function CommandNotice(): ReactElement | null {
  const { status, dismissError } = useWorkspace();
  return status ? <Notice status={status} dismissError={dismissError} /> : null;
}
