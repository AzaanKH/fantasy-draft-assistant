// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RecordedDraftPick } from '@/stores/draft/types';
import { createDraftStore, type DraftStoreApi } from '@/stores/draftStore';
import { WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { DraftRosterPanel } from './DraftRosterPanel';

vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: [], isLoading: false }) }));

let store: DraftStoreApi;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  store = createDraftStore();
  act(() => { store.setState({ sessionMode: 'mock' }); });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => { root.render(createElement(WorkspaceTestProvider, { store, children: createElement(DraftRosterPanel) })); });
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); vi.unstubAllGlobals(); });

const myTeam = () => store.getState().config.myPickPosition - 1;
const pick = (pickNumber: number, playerId: string, teamIndex: number): RecordedDraftPick =>
  ({ pickNumber, playerId, playerName: playerId, teamIndex, teamName: `Team ${String(teamIndex + 1)}`, position: 'RB', timestamp: pickNumber, source: 'sync' });
const flashing = () => container.querySelectorAll('[data-just-filled]').length;

it('flashes the slot when exactly one pick, yours, lands', () => {
  act(() => { store.setState({ draftHistory: [pick(1, 'mine', myTeam())] }); });
  expect(flashing()).toBe(1);
});

it('flashes nothing when a sync adds several picks at once, even with exactly one for your roster', () => {
  const other = myTeam() === 0 ? 1 : 0;
  act(() => { store.setState({ draftHistory: [pick(1, 'theirs', other), pick(2, 'mine', myTeam()), pick(3, 'also-theirs', other)] }); });
  expect(container.querySelector('.draft-roster-slot')).not.toBeNull();
  expect(flashing()).toBe(0);
});
