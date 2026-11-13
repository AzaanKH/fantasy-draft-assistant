// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Player } from '@fantasy-draft/shared/league';
import { TooltipProvider } from '@/components/ui/tooltip';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import { PositionTiersView } from './PositionTiersView';
import { createAssistantTestData, withAssistantData } from './assistant-data-test-helpers';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); vi.unstubAllGlobals(); });

it('describes a flagged row\'s injury on its one focusable control and shows it on focus, with no extra tab stop', () => {
  const base = VISUAL_PLAYERS.find((candidate) => candidate.position === 'RB');
  if (!base) throw new Error('Missing RB fixture');
  const injured: Player = { ...base, newsStatus: 'questionable' };
  act(() => {
    root.render(createElement(TooltipProvider, { delayDuration: 0, children: withAssistantData(createAssistantTestData({ players: [injured], draftedPlayerIds: new Set<string>() }), createElement(PositionTiersView, { selectedPlayerId: undefined, onSelect: vi.fn() })) }));
  });
  const row = container.querySelector(`.rec-tier-column[data-key="RB"] [data-tier-player-id="${injured.id}"]`);
  const identity = row?.querySelector<HTMLButtonElement>('.rec-tier-identity');
  const describedBy = identity?.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  const detail = describedBy ? document.getElementById(describedBy)?.textContent : undefined;
  expect(detail).toMatch(/questionable/i);
  // The chip itself never takes focus: the row keeps its identity button and queue toggle only.
  expect(row?.querySelectorAll('button')).toHaveLength(2);
  act(() => { identity?.focus(); });
  expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toMatch(/questionable/i);
});
