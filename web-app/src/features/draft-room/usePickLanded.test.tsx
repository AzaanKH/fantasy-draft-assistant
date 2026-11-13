// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Player } from '@fantasy-draft/shared/league';
import { useMemo } from 'react';
import { getLandedPick, PICK_LANDED_MS, SLOT_FILLED_MS, useJustAdded, useLandedPick, useLeavingPoolRow } from './usePickLanded';

let container: HTMLDivElement;
let root: Root;
let reduce = false;
const seen: { added: string | null; leaving: string | null; landed?: number | null } = { added: null, leaving: null };

function Probe({ ids, rows, drafted, session }: { readonly ids: readonly string[]; readonly rows: readonly string[]; readonly drafted: readonly string[]; readonly session: string }) {
  seen.added = useJustAdded(ids, session);
  // The draft history the drafted players came from, one pick each, in order.
  const draftedKey = drafted.join('|');
  const history = useMemo(() => (draftedKey ? draftedKey.split('|') : []).map((playerId, index) => ({ pickNumber: index + 1, playerId })), [draftedKey]);
  const landed = useLandedPick(history, session);
  seen.landed = landed?.pickNumber ?? null;
  seen.leaving = useLeavingPoolRow({
    rows: rows.map((id) => ({ player: { id } as Player })),
    starts: new Map([['a', 0], ['b', 44], ['c', 88]]),
    draftedPlayerIds: new Set(drafted),
    landedPlayerId: landed?.playerId ?? null,
  })?.player.id ?? null;
  return null;
}

function render(ids: readonly string[], rows: readonly string[], drafted: readonly string[] = [], session = 'mock:local'): void {
  act(() => { root.render(createElement(Probe, { ids, rows, drafted, session })); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  reduce = false;
});

it('marks the slot that just filled and the pool row that was drafted, then clears both', () => {
  render([], ['a', 'b', 'c']);
  expect(seen).toEqual({ added: null, leaving: null, landed: null });
  render(['b'], ['a', 'c'], ['b']);
  expect(seen).toEqual({ added: 'b', leaving: 'b', landed: 1 });
  act(() => { vi.advanceTimersByTime(PICK_LANDED_MS); });
  expect(seen.leaving).toBeNull();
  act(() => { vi.advanceTimersByTime(SLOT_FILLED_MS); });
  expect(seen.added).toBeNull();
});

it('does not animate a row that left because of a filter, or anything under reduced motion', () => {
  render([], ['a', 'b', 'c']);
  render([], ['a', 'c']);
  expect(seen.leaving).toBeNull();
  reduce = true;
  render(['b'], ['a'], ['c']);
  expect(seen).toMatchObject({ added: null, leaving: null });
});

it('flashes only a single pick landing in the same draft session, never a switch to another saved draft', () => {
  render(['a'], []);
  // Another saved draft: a different session, even though its roster adds exactly one player.
  render(['a', 'b'], [], [], 'live:sleeper/other');
  expect(seen.added).toBeNull();
  // Same session, a replaced roster (two new players, one removed): not a pick landing.
  render(['c', 'd'], [], [], 'live:sleeper/other');
  expect(seen.added).toBeNull();
  // Same session, one pick lands.
  render(['c', 'd', 'e'], [], [], 'live:sleeper/other');
  expect(seen.added).toBe('e');
});

it('keeps the figure a drafted row showed, though the pick that drafted the player also drops them from the estimates', () => {
  let availability: unknown = null;
  const before = new Map([['b', { kind: 'estimate', probability: 0.42, pickLabel: '2.08' }]]) as never;
  const after = new Map() as never;
  function Leaving({ rows, drafted, estimates }: { readonly rows: readonly string[]; readonly drafted: readonly string[]; readonly estimates: never }) {
    availability = useLeavingPoolRow({
      rows: rows.map((id) => ({ player: { id } as Player })),
      starts: new Map([['a', 0], ['b', 44]]),
      draftedPlayerIds: new Set(drafted),
      landedPlayerId: drafted.at(-1) ?? null,
      availabilityById: estimates,
    })?.availability ?? null;
    return null;
  }
  act(() => { root.render(createElement(Leaving, { rows: ['a', 'b'], drafted: [], estimates: before })); });
  act(() => { root.render(createElement(Leaving, { rows: ['a'], drafted: ['b'], estimates: after })); });
  expect(availability).toEqual({ kind: 'estimate', probability: 0.42, pickLabel: '2.08' });
});

it('animates nothing when a saved history loads from storage, however many picks it holds', () => {
  render([], ['a', 'b', 'c']);
  // IndexedDB restore: two picks arrive at once.
  render(['a', 'b'], ['c'], ['a', 'b']);
  expect(seen).toEqual({ added: null, leaving: null, landed: null });
  // The next real pick in that draft still animates.
  render(['a', 'b', 'c'], [], ['a', 'b', 'c']);
  expect(seen.landed).toBe(3);
});

it('animates nothing on a switch to another session, even when it has exactly one more pick', () => {
  render([], ['a', 'b', 'c'], [], 'mock:local');
  render(['b'], ['a', 'c'], ['b'], 'live:sleeper/123');
  expect(seen).toEqual({ added: null, leaving: null, landed: null });
});

it('getLandedPick: exactly one appended pick in the same session, never an undo, rewrite or load', () => {
  const pick = (pickNumber: number, playerId: string) => ({ pickNumber, playerId });
  const before = { sessionKey: 's', history: [pick(1, 'a')] };
  expect(getLandedPick(before, { sessionKey: 's', history: [pick(1, 'a'), pick(2, 'b')] })).toEqual(pick(2, 'b'));
  expect(getLandedPick(before, { sessionKey: 's', history: [] })).toBeNull();
  expect(getLandedPick(before, { sessionKey: 's', history: [pick(1, 'x'), pick(2, 'b')] })).toBeNull();
  expect(getLandedPick(before, { sessionKey: 's', history: [pick(1, 'a'), pick(2, 'b'), pick(3, 'c')] })).toBeNull();
  expect(getLandedPick(before, { sessionKey: 't', history: [pick(1, 'a'), pick(2, 'b')] })).toBeNull();
});
