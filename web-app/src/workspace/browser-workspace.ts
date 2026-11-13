import type { Workspace } from './workspace';

let browserWorkspace: Workspace | undefined;

/** Registers the one workspace the page runs on; storage setup has already opened it. */
export function mountBrowserWorkspace(workspace: Workspace): Workspace {
  if (browserWorkspace) throw new Error('The browser composition root already has a workspace');
  browserWorkspace = workspace;
  return workspace;
}

export function getBrowserWorkspace(): Workspace {
  if (!browserWorkspace) throw new Error('The browser composition root has not created its workspace');
  return browserWorkspace;
}
