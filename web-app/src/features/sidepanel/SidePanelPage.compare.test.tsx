// @vitest-environment jsdom
import { asProbability, asRank, asVor } from '@fantasy-draft/shared/units';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Player } from '@fantasy-draft/shared/league';
import type { Recommendation } from '@fantasy-draft/shared/draft';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from '@/features/theme/ThemeProvider';
import { createDraftStore, type DraftStoreApi } from '@/stores/draftStore';
import { WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { SidePanelPage } from './SidePanelPage';

function makePlayer(id: string, name: string, rank: number): Player {
  return {
    id, name, position: 'WR', team: 'BUF', byeWeek: 8, ecrRank: asRank(rank), positionalRank: asRank(rank),
    sleeperAdp: rank, valueScore: 0, marketRank: rank, marketAdp: rank, marketAdpTrend: 0, isContractYear: false,
    offensiveEnvironmentScore: 7, projectedPoints: 240 - rank, valueOverReplacement: asVor(50 - rank), tier: 1,
    tierDropoffScore: 0, nextPickSurvivalProbability: asProbability(0.5), ceilingScore: 0, floorScore: 0,
    upsideScore: 0, uncertaintyScore: 0, injuryRiskScore: 0, predictionSource: 'heuristic', newsStatus: 'healthy',
    stackPartnerTeam: 'BUF', highlightLevel: 'neutral',
  };
}
const fixtures = vi.hoisted(() => ({ players: [] as Player[], recommendations: [] as Recommendation[], version: 0 }));
fixtures.players = [makePlayer('top', 'Top Pick', 1), makePlayer('second', 'Second Option', 2), makePlayer('third', 'Third Option', 3)];
fixtures.recommendations = fixtures.players.map((player, index) => ({
  playerId: player.id, playerName: player.name, position: player.position, reason: `${player.name} reason`, score: 3 - index,
}));

vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: fixtures.players, isLoading: false, isError: false }) }));
vi.mock('@/features/recommendations/DraftDecisionContext', () => {
  // Built on first use (after fixtures exist) and kept stable across renders.
  let decision: unknown;
  let builtVersion = -1;
  return { useDraftDecision: () => {
    if (builtVersion !== fixtures.version) { decision = undefined; builtVersion = fixtures.version; }
    decision ??= { isLoading: false, recommendationsBlocked: false, recommendationsBlockedByProviderIdentity: false,
      output: { bestPick: fixtures.recommendations[0] }, byPosition: {}, overall: {
        recommendations: fixtures.recommendations, preferred: fixtures.recommendations[0] ?? null,
        rankByPlayerId: new Map(fixtures.recommendations.map((row, index) => [row.playerId, index + 1])),
        explanationByPlayerId: new Map(fixtures.recommendations.map(row => [row.playerId, `${row.playerName} explanation`])),
        selection: { policy: 'ecr-anchor' },
      } };
    return decision;
  } };
});
vi.mock('@/hooks/useTeamNeeds', () => ({ useTeamNeeds: () => ({ needs: [] }) }));
vi.mock('@/hooks/useQueueActions', () => ({ useQueueActions: () => ({ togglePlayerQueued: vi.fn() }) }));
vi.mock('@/features/draft-room/LiveDraftSyncProvider', () => ({ useLiveDraftSync: () => ({ connection: { provider: 'espn' } }) }));
vi.mock('@/hooks/useDraftSync', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/hooks/useDraftSync')>(),
  useDraftSync: () => ({ draft: null, synchronizationState: 'manual-continuity', lastSyncAgeMs: 1000, lastSuccessfulSyncAt: 1000, lastError: null }),
}));

let container: HTMLDivElement;
let root: Root;
let store: DraftStoreApi;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  store = createDraftStore();
  store.getState().setSessionMode('live');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  act(() => { root.render(createElement(WorkspaceTestProvider, { store,
    children: createElement(ThemeProvider, { initialTheme: 'light', persist: false,
      children: createElement(TooltipProvider, null, createElement(SidePanelPage)) }) })); });
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function button(match: (button: HTMLButtonElement) => boolean): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(match);
  if (!found) throw new Error('Missing button');
  return found;
}
const click = (element: HTMLElement) => { act(() => { element.click(); }); };
const option = (name: string) => button(candidate => candidate.getAttribute('aria-pressed') !== null && candidate.textContent.includes(name));

it('explains the compared winner, not the global top pick, and drops the redundant compare action', () => {
  click(option('Top Pick'));
  click(option('Third Option'));
  click(button(candidate => candidate.textContent === 'Compare 2 players'));

  // The head-to-head already reflects the selection, so its list has no second Compare action.
  expect([...container.querySelectorAll('button')].some(candidate => candidate.textContent.startsWith('Compare '))).toBe(false);
  const edge = /Edge: (.+)/.exec(container.textContent.match(/Edge: [A-Za-z ]+?Option/)?.[0] ?? '')?.[1];
  expect(['Second Option', 'Third Option']).toContain(edge);

  click(button(candidate => candidate.textContent.trim() === 'Ask why'));
  expect(container.querySelector('h2')?.textContent).toBe(`${String(edge)} has the edge in this comparison.`);
  expect(container.textContent).not.toContain('Top Pick is the best current option.');
});

it('says so when the explained player is drafted, then falls back to the top pick', () => {
  click(option('Top Pick'));
  click(option('Third Option'));
  click(button(candidate => candidate.textContent === 'Compare 2 players'));
  click(button(candidate => candidate.textContent.trim() === 'Ask why'));
  const edge = /^(.+) has the edge in this comparison\.$/.exec(container.querySelector('h2')?.textContent ?? '')?.[1];
  const edgePlayer = fixtures.players.find(player => player.name === edge);
  if (!edgePlayer) throw new Error('Missing edge player');

  fixtures.recommendations = fixtures.recommendations.filter(row => row.playerId !== edgePlayer.id);
  fixtures.version += 1;
  act(() => { store.getState().markPlayerDrafted(edgePlayer.id, edgePlayer.name, edgePlayer.position, 1, 'Team 2'); });

  expect([...container.querySelectorAll('[role="status"]')].map(node => node.textContent)).toContain(`${edgePlayer.name} was drafted. Showing the current top pick instead.`);
  expect(container.querySelector('h2')?.textContent).not.toContain('has the edge');
});

it('replaces a drafted head-to-head opponent instead of comparing the winner with themselves', () => {
  fixtures.recommendations = fixtures.players.map((player, index) => ({
    playerId: player.id, playerName: player.name, position: player.position, reason: `${player.name} reason`, score: 3 - index,
  }));
  fixtures.version += 1;
  act(() => { root.render(createElement(WorkspaceTestProvider, { store,
    children: createElement(ThemeProvider, { initialTheme: 'light', persist: false,
      children: createElement(TooltipProvider, null, createElement(SidePanelPage)) }) })); });
  // Compare B and C while A (Top Pick) leads.
  for (const candidate of [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed="true"]')]) click(candidate);
  click(option('Second Option'));
  click(option('Third Option'));
  click(button(candidate => candidate.textContent === 'Compare 2 players'));
  click(button(candidate => candidate.textContent.trim() === 'Ask why'));
  const edge = /^(.+) has the edge in this comparison\.$/.exec(container.querySelector('h2')?.textContent ?? '')?.[1];
  const loser = fixtures.players.find(player => player.name !== edge && player.name !== 'Top Pick');
  if (!edge || !loser) throw new Error('Missing head-to-head players');

  fixtures.recommendations = fixtures.recommendations.filter(row => row.playerId !== loser.id);
  fixtures.version += 1;
  act(() => { store.getState().markPlayerDrafted(loser.id, loser.name, loser.position, 1, 'Team 2'); });

  expect([...container.querySelectorAll('[role="status"]')].map(node => node.textContent))
    .toContain(`${loser.name} was drafted. Comparing ${edge} with Top Pick instead.`);
  click(button(candidate => candidate.textContent.trim() === 'Compare options' || candidate.getAttribute('aria-label') === 'Compare options' || candidate.textContent.trim() === 'Compare'));
  const header = container.querySelector('.grid.grid-cols-3.bg-muted\\/30');
  expect(header?.textContent).toBe(`Signal${edge}Top Pick`);
});
