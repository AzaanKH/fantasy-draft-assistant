// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_QUICK_MOCK, createQuickMockSettings } from '@fantasy-draft/shared/draft';
import { App } from '@/App';
import { useLeagueSetupStore } from '@/stores/leagueSetupStore';
import type { PersistedDraftSession } from '@/stores/draftSessionStorage';
import { showStorageActivation } from './activation-entry';
import * as activationStorage from './activation-storage';
import { initialDraftState, sessionFromState } from './draft-reducer';
import { decodeIndexedSession } from './idb-session';
import { canonicalJson } from './indexed-workspace';
import { openDraftDatabase, type DraftDatabase } from './indexed-db';
import { verifyStorageSharing } from './storage-sharing';
import type { Workspace } from './workspace';
import { WorkspaceProvider } from './WorkspaceProvider';

vi.mock('@fantasy-draft/shared/sync', async original => ({ ...await original<object>(), STORAGE_ACTIVATION_ENABLED: true }));
vi.mock('@/hooks/usePlayerData', () => {
  const data = { players: [], isLoading: false, dataInfo: { readinessSources: [], readinessWarnings: [] } };
  return { usePlayerDataQuery: () => data };
});
vi.mock('@/lib/http', () => ({ requestJson: () => new Promise(() => {}) }));
vi.mock('@/features/draft-room/LiveDraftSyncProvider', () => ({ LiveDraftSyncProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/features/recommendations/DraftDecisionContext', () => ({ DraftDecisionProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/DraftHeader', () => ({ DraftHeader: () => null }));
vi.mock('@/features/draft-room/DraftRoom', () => ({ DraftRoom: () => <div data-app-mounted /> }));
vi.mock('@/features/draft-room/ShadowRecommendationObserver', () => ({ ShadowRecommendationObserver: () => null }));
vi.mock('@/features/draft-board/mock-auto-advance', () => ({ MockDraftAutoAdvance: () => null }));

const identity = { provider: 'sleeper', draftId: 'startup' } as const;
const queue = ['9221', '9509', '4034', '9493'];
const mounted: Array<{ root: Root; container: HTMLElement; workspace?: Workspace; client: QueryClient }> = [];
const databases: DraftDatabase[] = [];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('indexedDB', new IDBFactory());
  localStorage.clear();
  useLeagueSetupStore.getState().save('quick-mock', { ...DEFAULT_QUICK_MOCK, totalTeams: 12, totalRounds: 15 });
  history.replaceState(null, '', '/draft?provider=sleeper&draftId=startup&settings=quick-mock&position=1');
});
afterEach(() => {
  for (const view of mounted.splice(0)) {
    act(() => { view.root.unmount(); });
    view.workspace?.dispose(); view.client.clear(); view.container.remove();
  }
  for (const database of databases.splice(0)) database.close();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear();
  history.replaceState(null, '', '/');
});

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(predicate()).toBe(true);
}
async function database(factory = new IDBFactory()) {
  const value = await openDraftDatabase({ factory, decode: decodeIndexedSession, report: error => { throw new Error('Unexpected database error', { cause: error }); } });
  databases.push(value); return value;
}
function savedSession(): PersistedDraftSession {
  const leagueSettings = createQuickMockSettings({ ...DEFAULT_QUICK_MOCK, totalTeams: 20, totalRounds: 20 });
  const state = initialDraftState(identity);
  return sessionFromState({ ...state, leagueSettings,
    config: { ...state.config, totalTeams: 20, totalRounds: 20, myPickPosition: 1, draftType: 'linear', rosterRequirements: leagueSettings.rosterRequirements },
    shortlistedPlayerIds: queue, keepersInitialized: true,
    draftProgress: { historyLength: 0, anchor: { kind: 'past-keepers', fromPick: 1, keeperSlots: [], totalPicks: 400 } },
  }, identity, 20);
}
async function seed(value: DraftDatabase) {
  const session = savedSession();
  await value.update(identity, () => ({ session, result: undefined })); return session;
}
function holdRead(value: DraftDatabase) {
  const read = value.read.bind(value);
  let release = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  const spy = vi.spyOn(value, 'read').mockImplementation(async id => { await pending; return read(id); });
  return { release, spy };
}
function recordChanges(value: DraftDatabase) {
  const changes: PersistedDraftSession[] = [];
  const update = value.update.bind(value);
  vi.spyOn(value, 'update').mockImplementation((id, apply) => update(id, previous => {
    const next = apply(previous);
    if (canonicalJson(next.session) !== canonicalJson(previous)) changes.push(structuredClone(next.session));
    return next;
  }));
  return changes;
}
async function start(value: DraftDatabase, firstRun = false) {
  vi.spyOn(activationStorage, 'createActivationStorage').mockReturnValue({
    resume: async () => firstRun ? null : value,
    preflight: async () => ({ status: 'review', phase: 'fresh', ready: true, sessions: [], source: [], blockers: [],
      sourceDigest: '', unchanged: [], rejected: [], unresolved: [], pending: [], stale: [], tombstone: 'absent', digest: '',
      indexed: { sessions: [], invalid: [], refusals: [], activation: null } }),
    activate: async () => value, cancel: vi.fn(), close: vi.fn(),
  });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view: typeof mounted[number] = { root, container, client };
  mounted.push(view);
  const published: Array<{ mode: string; connection: unknown; teams: number }> = [];
  const verified = await verifyStorageSharing({ canonicalOrigin: location.origin, location });
  act(() => { showStorageActivation({ root, verified, ready: workspace => {
    view.workspace = workspace;
    published.push({ mode: workspace.draft.getState().sessionMode, connection: workspace.connection.getState().connection, teams: workspace.draft.getState().config.totalTeams });
    root.render(<QueryClientProvider client={client}><WorkspaceProvider workspace={workspace}><App /></WorkspaceProvider></QueryClientProvider>);
  } }); });
  return { view, published };
}
async function settle(view: typeof mounted[number]) {
  await until(() => Boolean(view.workspace));
  for (let attempt = 0; attempt < 4; attempt++) await act(async () => {
    await view.workspace?.sendDurable?.(['setSearchQuery', '']);
    await new Promise(resolve => setTimeout(resolve, 5));
  });
}

it('publishes the resumed draft and connection together before real App and keeper effects run', async () => {
  const value = await database(); const saved = await seed(value);
  const changes = recordChanges(value); const read = holdRead(value);
  const { view, published } = await start(value);
  await until(() => read.spy.mock.calls.length > 0);
  expect(published).toEqual([]);
  expect(view.container.querySelector('[data-app-mounted]')).toBeNull();
  await act(async () => { read.release(); }); await settle(view);
  expect(await value.read(identity)).toEqual(saved);
  expect(changes).toEqual([]);
  expect(published).toHaveLength(1);
  expect(published[0]).toMatchObject({ mode: 'live', connection: identity, teams: 20 });
});

it('preserves shared configuration and keeper progress when two workspaces reload the saved session', async () => {
  const factory = new IDBFactory();
  const first = await database(factory); const saved = await seed(first);
  const second = await database(factory);
  const firstChanges = recordChanges(first); const secondChanges = recordChanges(second);
  const firstRead = holdRead(first); const secondRead = holdRead(second);
  const a = await start(first); const b = await start(second);
  await until(() => firstRead.spy.mock.calls.length > 0 && secondRead.spy.mock.calls.length > 0);
  expect(a.published).toEqual([]);
  expect(b.published).toEqual([]);
  await act(async () => { firstRead.release(); secondRead.release(); });
  await settle(a.view); await settle(b.view);
  expect(await first.read(identity)).toEqual(saved);
  expect([...firstChanges, ...secondChanges]).toEqual([]);
  expect(a.view.workspace?.draft.getState().shortlistedPlayerIds).toEqual(queue);
  expect(b.view.workspace?.draft.getState().config.totalTeams).toBe(20);
});

it('still applies local defaults after first activation with no saved session or connection', async () => {
  history.replaceState(null, '', '/draft');
  const value = await database();
  const { view, published } = await start(value, true);
  await until(() => Boolean(view.container.querySelector('input')));
  act(() => { view.container.querySelector('input')?.click(); });
  act(() => { [...view.container.querySelectorAll('button')].find(button => button.textContent === 'Activate IndexedDB')?.click(); });
  await settle(view);
  expect(published).toEqual([{ mode: 'setup', connection: null, teams: 10 }]);
  expect(view.workspace?.draft.getState().config).toMatchObject({ totalTeams: 12, totalRounds: 15 });
  expect(view.workspace?.draft.getState().leagueSettings.rosterRequirements.BENCH.spots).toBe(6);
  expect(await value.read(identity)).toBeNull();
});

it('accepts later provider settings without replaying local setup defaults', async () => {
  const value = await database(); await seed(value);
  const { view } = await start(value); await settle(view);
  await act(async () => {
    await view.workspace?.sendDurable?.(['connection.applyProviderSettings', { ...identity,
      config: { totalTeams: 16, totalRounds: 18, draftType: 'linear' },
      leagueSettings: createQuickMockSettings({ ...DEFAULT_QUICK_MOCK, totalTeams: 16, totalRounds: 18 }),
    }]);
  });
  await settle(view);
  expect((await value.read(identity))?.config).toMatchObject({ totalTeams: 16, totalRounds: 18, myPickPosition: 1 });
  expect((await value.read(identity))?.shortlistedPlayerIds).toEqual(queue);
  expect((await value.read(identity))?.draftProgress.anchor).toMatchObject({ totalPicks: 288 });
});

it('closes a failed initial binding without publishing App or its effects', async () => {
  const value = await database();
  vi.spyOn(value, 'read').mockRejectedValue(new Error('Initial draft read failed'));
  const close = vi.spyOn(value, 'close');
  const { view, published } = await start(value);
  await until(() => Boolean(view.container.querySelector('[data-storage-blocked="activation"]')));
  expect(view.container.textContent).toContain('Initial draft read failed');
  expect(view.container.textContent).toContain('Reload the page');
  expect(published).toEqual([]);
  expect(view.container.querySelector('[data-app-mounted]')).toBeNull();
  expect(close).toHaveBeenCalled();
});
