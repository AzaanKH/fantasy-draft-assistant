// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDraftStore, type DraftStoreApi } from '@/stores/draftStore';
import { WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import { TooltipProvider } from '@/components/ui/tooltip';
import PositionalDepthChart from '@/features/assistant/PositionalDepthChart';
import { ProvisionalPickDialog } from '@/features/draft-room/ProvisionalPickDialog';

const fixture = VISUAL_PLAYERS[0];
if (!fixture) throw new Error('Missing player');
const drafted = { ...fixture, position: 'WR' as const, tier: 1 };
const alias = { ...drafted, id: 'same-name-alias', name: drafted.name.toUpperCase() };
const other = { ...drafted, id: 'other', name: 'Another Receiver' };
let players = [drafted, alias, other];
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players, isLoading: false }) }));
vi.mock('@/hooks/useLeagueTimingEvidence', () => ({ useLeagueTimingEvidence: () => ({ model: null, isLoading: false }) }));
vi.mock('@/features/draft-room/LiveDraftSyncProvider', () => ({ useLiveDraftSync: () => ({ connection: { provider: 'sleeper' } }) }));
let root: Root;
let store: DraftStoreApi;
let container: HTMLDivElement;
beforeEach(() => {
  players = [drafted, alias, other];
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  store = createDraftStore(); store.getState().setSessionMode('live');
  store.getState().recordProvisionalPick({ pickNumber: 1, playerId: drafted.id, playerName: drafted.name, position: drafted.position, teamIndex: 0, teamName: 'Team 1' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); });
it('uses canonical name identity availability for the depth chart and counts repeated IDs once', () => {
  players = [...players, other];
  act(() => { root.render(createElement(WorkspaceTestProvider, { store, children: createElement(TooltipProvider, null, createElement(PositionalDepthChart, { needs: [] })) })); });
  expect(container.querySelector('button[aria-label="WR Tier 1: 1 available players"]')).not.toBeNull();
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="Show available WR players"]');
  act(() => { button?.click(); });
  expect(container.querySelector('.depth-player-table')?.textContent).toContain(other.name);
  expect(container.querySelector('.depth-player-table')?.textContent).not.toContain(alias.name);
});
it('preserves ID-only observation choices and the edit-player exception', () => {
  const editingPick = store.getState().draftHistory[0]; if (!editingPick) throw new Error('Missing observation');
  act(() => { root.render(createElement(WorkspaceTestProvider, { store, children: createElement(ProvisionalPickDialog, { open: true, onOpenChange: vi.fn(), editingPick }) })); });
  const values = [...document.querySelectorAll<HTMLOptionElement>('option')].map(option => option.value);
  expect(values).toContain(drafted.id); expect(values).toContain(other.id); expect(values).toContain(alias.id);
  expect(store.getState().recordProvisionalPick({ pickNumber: 2, playerId: alias.id, playerName: alias.name, position: alias.position, teamIndex: 1, teamName: 'Team 2' })).toBe(true);
});
