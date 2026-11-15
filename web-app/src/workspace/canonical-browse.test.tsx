// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '@fantasy-draft/shared/league';
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
let players: readonly Player[] = [drafted, alias, other];
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
it('opens a tier or a whole position from the depth chart, toggles the wider views, and queues from the detail', () => {
  players = VISUAL_PLAYERS;
  const chart = (): void => {
    act(() => { root.render(createElement(WorkspaceTestProvider, { store, children: createElement(TooltipProvider, null,
      createElement(PositionalDepthChart, { needs: [{ position: 'K', priority: 'filled', startersNeeded: 1, startersFilled: 1, flexSlotsNeeded: 0, flexSlotsFilled: 0, isFlexEligible: false, scarcityScore: 0 }] })) })); });
  };
  chart();
  const press = (selector: string): HTMLButtonElement => {
    const control = container.querySelector<HTMLButtonElement>(selector);
    if (!control) throw new Error(`Missing ${selector}`);
    act(() => { control.click(); });
    return control;
  };
  expect(press('button[aria-pressed="false"]').getAttribute('aria-pressed')).toBe('true');
  expect(press('.depth-secondary-toggle').getAttribute('aria-expanded')).toBe('true');
  // A tier count opens that tier; pressing it again closes it.
  const tier = press('button[aria-label^="WR Tier 1:"]');
  expect(tier.getAttribute('aria-expanded')).toBe('true');
  press('button[aria-label^="WR Tier 1:"]');
  expect(container.querySelector('.depth-player-detail')).toBeNull();
  // The whole position, and queueing from one of its rows.
  press('button[aria-label="Show available WR players"]');
  const queue = press('.depth-player-detail button[aria-label^="Add "]');
  expect(store.getState().shortlistedPlayerIds).toHaveLength(1);
  expect(queue.getAttribute('aria-pressed')).toBe('true');
});
describe('the depth chart player detail', () => {
  const receivers = Array.from({ length: 12 }, (_, index) => ({ ...drafted, id: `wr-${String(index)}`, name: `Receiver ${String(index)}` }));
  function openWideReceivers(): HTMLButtonElement {
    players = receivers;
    act(() => { root.render(createElement(WorkspaceTestProvider, { store, children: createElement(TooltipProvider, null, createElement(PositionalDepthChart, { needs: [] })) })); });
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Show available WR players"]');
    if (!trigger) throw new Error('Missing WR trigger');
    act(() => { trigger.focus(); trigger.click(); });
    return trigger;
  }
  const names = (): string[] => [...container.querySelectorAll('.depth-player-table tbody .depth-player-name')].map((cell) => cell.textContent);
  const chances = (): string[] => [...container.querySelectorAll('.depth-player-table tbody td:nth-child(3)')].map((cell) => cell.textContent);

  it.each([
    ['a later pick', { totalTeams: 2, totalRounds: 2, myPickPosition: 1 }, /^\d+%$/],
    ['no later pick', { totalTeams: 2, totalRounds: 1, myPickPosition: 1 }, /^—$/],
  ] as const)('estimates the next-pick chance only when the manager has %s', (_, config, chance) => {
    store.getState().setConfig(config);
    openWideReceivers();
    expect(chances().length).toBeGreaterThan(0);
    for (const value of chances()) expect(value).toMatch(chance);
  });

  it('shows eight players, then the next page on request', () => {
    openWideReceivers();
    expect(names()).toHaveLength(8);
    const more = container.querySelector<HTMLButtonElement>('.depth-show-more');
    expect(more?.textContent).toMatch(/4 more/);
    act(() => { more?.click(); });
    expect(names()).toHaveLength(12);
    expect(container.querySelector('.depth-show-more')).toBeNull();
  });

  it('closes the detail and returns focus to the control that opened it', () => {
    const trigger = openWideReceivers();
    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close WR players"]');
    act(() => { close?.focus(); close?.click(); });
    expect(container.querySelector('.depth-player-detail')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

it('preserves ID-only observation choices and the edit-player exception', () => {
  const editingPick = store.getState().draftHistory[0]; if (!editingPick) throw new Error('Missing observation');
  act(() => { root.render(createElement(WorkspaceTestProvider, { store, children: createElement(ProvisionalPickDialog, { open: true, onOpenChange: vi.fn(), editingPick }) })); });
  const values = [...document.querySelectorAll<HTMLOptionElement>('option')].map(option => option.value);
  expect(values).toContain(drafted.id); expect(values).toContain(other.id); expect(values).toContain(alias.id);
  expect(store.getState().recordProvisionalPick({ pickNumber: 2, playerId: alias.id, playerName: alias.name, position: alias.position, teamIndex: 1, teamName: 'Team 2' })).toBe(true);
});
