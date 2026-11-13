// @vitest-environment jsdom
import { act, createElement, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MotionExpandable } from '@/components/motion';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createDraftStore, type DraftStoreApi } from '@/stores/draftStore';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import { getPickLock } from '@/workspace/pick-in-flight';
import { PickFailureNotice } from '@/workspace/PickFailureNotice';
import { workspaceForTestStore, WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { DraftPlayerPool } from './DraftPlayerPool';

// The real pick-action hook and pick lock; only the save itself is held so the test can reject it.
const save = vi.hoisted(() => ({ reject: (_error: Error): void => undefined }));
vi.mock('@/workspace/workspace-command', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/workspace/workspace-command')>(),
  commitWorkspaceCommand: () => new Promise<void>((_, reject) => { save.reject = reject; }),
}));
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: VISUAL_PLAYERS, isLoading: false }) }));
vi.mock('./LiveDraftSyncProvider', () => ({ useLiveDraftSync: () => ({ connection: null, synchronizationState: 'idle' }) }));
vi.mock('@/features/recommendations/DraftDecisionContext', () => ({
  useDraftDecision: () => ({ output: { selectedLens: 'best-pick' }, overall: { recommendations: [], rankByPlayerId: new Map() },
    readiness: null, recommendationsBlocked: false, nextPickAvailabilityById: new Map() }),
}));

let container: HTMLDivElement;
let root: Root;
let store: DraftStoreApi;
let setExpanded: (open: boolean) => void = () => undefined;

/** The split dock's pool: collapsing keeps it mounted inside MotionExpandable, with its footer and rows unseen. */
function Dock(): ReactElement {
  const [open, setOpen] = useState(true);
  setExpanded = setOpen;
  return createElement('div', null,
    createElement(MotionExpandable, { open, children: createElement(DraftPlayerPool) }),
    createElement(PickFailureNotice));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  // jsdom has no layout; give the scroller a size so the virtualizer renders rows.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900);
  store = createDraftStore();
  store.getState().setConfig({ totalTeams: 4, totalRounds: 3, myPickPosition: 1, draftType: 'snake' });
  store.getState().setSessionMode('mock');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  act(() => { root.render(createElement(WorkspaceTestProvider, { store, children: createElement(TooltipProvider, null, createElement(Dock)) })); });
});
afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  getPickLock(workspaceForTestStore(store)).dismissFailure();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const notice = () => document.querySelector('aside[aria-label="Pick not saved"]');
const [first] = VISUAL_PLAYERS;

function startDraft(): void {
  const draft = container.querySelector<HTMLButtonElement>(`button[aria-label="Draft ${first?.name ?? ''}"]`);
  if (!draft) throw new Error('Missing Draft button');
  act(() => { draft.click(); });
  expect(getPickLock(workspaceForTestStore(store)).isLocked()).toBe(true);
}

it('hands a save that fails after the pool collapsed to the workspace notice, with Retry', async () => {
  startDraft();
  act(() => { setExpanded(false); });
  await act(async () => { save.reject(new Error('Storage is full.')); await Promise.resolve(); });
  expect(notice()?.textContent).toContain(`${first?.name ?? ''} was not drafted. Storage is full.`);
  expect([...notice()?.querySelectorAll('button') ?? []].map((button) => button.textContent)).toContain('Retry');
});

it('moves a failure the open pool already shows to the notice once the pool collapses', async () => {
  startDraft();
  await act(async () => { save.reject(new Error('Storage is full.')); await Promise.resolve(); });
  // Expanded, the pool's own row and footer show it: one surface.
  expect(notice()).toBeNull();
  expect(container.querySelector('.draft-pool-footer[data-failed]')).not.toBeNull();
  act(() => { setExpanded(false); });
  expect(notice()?.textContent).toContain('Storage is full.');
  act(() => { setExpanded(true); });
  expect(notice()).toBeNull();
});
