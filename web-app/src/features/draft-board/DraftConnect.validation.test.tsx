// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DraftReadinessReport } from '@fantasy-draft/shared/catalog';
import { createDraftStore } from '@/stores/draftStore';
import { createWorkspace, type Workspace } from '@/workspace/workspace';
import { WorkspaceProvider } from '@/workspace/WorkspaceProvider';
import { DraftConnect } from './DraftConnect';

const startConnection = vi.hoisted(() => vi.fn());
vi.mock('@/features/draft-room/LiveDraftSyncProvider', () => ({
  useLiveDraftSync: () => ({
    connection: null,
    sync: { draft: null, totalPicks: 0, myPicksCount: 0, isError: false, lastError: null, connectionState: 'idle',
      isDrafting: false, isPaused: false, isComplete: false, importWarning: null, rejectedPickCount: 0,
      lastSuccessfulSyncAt: null, refresh: vi.fn() },
    synchronizationState: 'disconnected',
    viewState: { connectionState: 'idle' },
    startConnection,
    confirmDraftPosition: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

const readiness = { productBlockingFailures: [], actionableWarnings: [], optionalSignalDegradations: [] } as unknown as DraftReadinessReport;

let root: Root;
let container: HTMLDivElement;
let workspace: Workspace;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  startConnection.mockReset();
  workspace = createWorkspace({ draftStore: createDraftStore() });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  act(() => { root.render(createElement(WorkspaceProvider, { workspace,
    children: createElement(DraftConnect, { dataFreshness: [], readiness, open: true, onOpenChange: vi.fn() }) })); });
});
afterEach(() => { act(() => { root.unmount(); }); workspace.dispose(); container.remove(); vi.unstubAllGlobals(); });

function input(): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>('#provider-draft-id');
  if (!element) throw new Error('Missing draft input');
  return element;
}
function type(value: string): void {
  act(() => {
    // React tracks the value property, so use the native setter to register a change.
    Reflect.set(HTMLInputElement.prototype, 'value', value, input());
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function clickContinue(): void {
  const button = [...document.querySelectorAll('button')].find(candidate => candidate.textContent === 'Continue');
  if (!button) throw new Error('Missing continue button');
  act(() => { button.click(); });
}

it('explains an unsupported URL inline, marks the field invalid, and refocuses it', () => {
  type('https://fantasy.espn.com/football/league?leagueId=4242');
  document.body.focus();
  clickContinue();

  expect(startConnection).not.toHaveBeenCalled();
  expect(input().getAttribute('aria-invalid')).toBe('true');
  const describedBy = input().getAttribute('aria-describedby')?.split(' ') ?? [];
  const error = document.getElementById('provider-draft-id-error');
  expect(describedBy).toContain('provider-draft-id-error');
  expect(error?.textContent).toContain('not a supported draft room URL');
  expect(document.activeElement).toBe(input());

  // Editing clears the error; a valid URL connects.
  type('https://sleeper.com/draft/nfl/123');
  expect(input().hasAttribute('aria-invalid')).toBe(false);
  expect(document.getElementById('provider-draft-id-error')).toBeNull();
  clickContinue();
  expect(startConnection).toHaveBeenCalledWith({ provider: 'sleeper', draftId: '123' });
});
