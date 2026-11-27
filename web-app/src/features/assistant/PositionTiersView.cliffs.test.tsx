// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Player } from '@fantasy-draft/shared/league';
import { asProbability, asRank } from '@fantasy-draft/shared/units';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { NextPickAvailability } from '@/lib/next-pick-availability';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import { PositionTiersView, tierColor } from './PositionTiersView';
import { createAssistantTestData, withAssistantData } from './assistant-data-test-helpers';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); vi.unstubAllGlobals(); });

const base = VISUAL_PLAYERS.find((player) => player.position === 'RB');
if (!base) throw new Error('Missing RB fixture');
const back = (id: string, tier: number, ecrRank: number, projectedPoints: number): Player =>
  ({ ...base, id, name: `Back ${id}`, tier, ecrRank: asRank(ecrRank), projectedPoints, newsStatus: 'healthy' });
const players = [back('a', 1, 1, 300), back('b', 1, 2, 290), back('c', 1, 3, 285), back('d', 2, 4, 250), back('e', 2, 5, 245)];
const estimate = (probability: number): NextPickAvailability => ({ kind: 'estimate', probability: asProbability(probability), pickLabel: '2.08' });

function render(odds: Readonly<Record<string, number>>, nextPickLabel: string | null = '2.08'): void {
  act(() => {
    root.render(createElement(TooltipProvider, { children: withAssistantData(createAssistantTestData({
      players,
      nextPickLabel,
      availabilityById: new Map(Object.entries(odds).map(([id, probability]) => [id, estimate(probability)])),
    }), createElement(PositionTiersView, { selectedPlayerId: undefined, onSelect: vi.fn() })) }));
  });
}
const column = (): Element | null => container.querySelector('.rec-tier-column[data-key="RB"]');

it('marks the first player likely there on its own row, so each tier keeps one list of rows', () => {
  render({ a: 0.1, b: 0.3, c: 0.8, d: 0.9, e: 0.95 });
  const tierOne = column()?.querySelector('section[aria-label="RB Tier 1"]');
  expect(tierOne?.querySelectorAll('ol')).toHaveLength(1);
  expect(tierOne?.querySelector('[data-next-pick]')?.getAttribute('data-tier-player-id')).toBe('c');
  expect(tierOne?.querySelector('[data-next-pick]')?.getAttribute('data-next-pick')).toContain('First likely at 2.08');
  expect([...container.querySelectorAll('.rec-tiers ol > *')].every((child) => child.matches('li.rec-tier-row'))).toBe(true);
  expect(column()?.querySelector('.rec-tier-status')?.textContent).toBe('Tier 1 should last to 2.08');
  // Tier 1's weakest (285) against Tier 2's best (250).
  expect(column()?.querySelector('.rec-tier-drop')?.textContent).toContain('−35 pts');
  expect(container.querySelector('[data-tier-cliff="RB"]')?.textContent).toContain('Biggest cliff: RB after Tier 1');
});

it('keeps the opener row and its focus when a live pick moves the mark', () => {
  render({ a: 0.1, b: 0.3, c: 0.8, d: 0.9, e: 0.95 });
  const opener = column()?.querySelector<HTMLButtonElement>('[data-tier-player-id="c"] .rec-tier-identity');
  act(() => { opener?.focus(); });
  render({ a: 0.1, b: 0.7, c: 0.8, d: 0.9, e: 0.95 });
  expect(column()?.querySelector('[data-next-pick]')?.getAttribute('data-tier-player-id')).toBe('b');
  expect(column()?.querySelector('[data-tier-player-id="c"] .rec-tier-identity')).toBe(opener);
  expect(document.activeElement).toBe(opener);
});

it('says no tier player is likely there, and leaves the marker out on the final pick', () => {
  render({ a: 0.1, b: 0.3, c: 0.2, d: 0.9, e: 0.95 });
  expect(column()?.querySelector('.rec-tier-status')?.textContent).toBe('No Tier 1 player likely at 2.08');
  expect(column()?.querySelector('.rec-tier-nextpick')?.textContent).toContain('First likely at 2.08');

  render({}, null);
  expect(container.querySelector('.rec-tier-nextpick, [data-next-pick]')).toBeNull();
  expect(column()?.querySelector('.rec-tier-status')?.textContent).toBe('3 left in Tier 1');
});

it('colors Tiers 1 to 5 apart and gives Tier 6 and later the shared neutral', () => {
  expect([1, 2, 3, 4, 5].map((tier) => tierColor({ tier }))).toEqual(['var(--tier-1)', 'var(--tier-2)', 'var(--tier-3)', 'var(--tier-4)', 'var(--tier-5)']);
  expect([6, 7, 12].map((tier) => tierColor({ tier }))).toEqual(['var(--tier-rest)', 'var(--tier-rest)', 'var(--tier-rest)']);
});
