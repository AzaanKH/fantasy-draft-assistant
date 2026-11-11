// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InjuryTag, RiskChip } from '@/components/InjuryTag';
import { TooltipProvider } from '@/components/ui/tooltip';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import { VerdictChip } from './suggestion-card-parts';
import { VERDICT_RULE } from './suggestion-reasons';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); vi.unstubAllGlobals(); });

it('opens the verdict rule and the card details from keyboard focus, keeping the screen-reader text', () => {
  act(() => {
    root.render(createElement(TooltipProvider, { delayDuration: 0,
      children: createElement(VerdictChip, { verdict: { kind: 'can-wait', label: 'Can wait', reason: 'likely still there at 1.05' }, details: ['Need RB: 2 starter spots open'] }) }));
  });
  const chip = container.querySelector<HTMLButtonElement>('button.suggestion-verdict');
  expect(chip).not.toBeNull();
  expect(chip?.hasAttribute('title')).toBe(false);
  expect(chip?.querySelector('.sr-only')?.textContent).toContain(VERDICT_RULE);
  act(() => { chip?.focus(); });
  const tooltip = document.querySelector('[data-slot="tooltip-content"]');
  expect(tooltip?.textContent).toContain(VERDICT_RULE);
  expect(tooltip?.textContent).toContain('Need RB: 2 starter spots open');
});

it('leaves the rule to the list description inside the suggestion list, keeping the verdict and its reason', () => {
  act(() => {
    root.render(createElement(TooltipProvider, { delayDuration: 0,
      children: createElement(VerdictChip, { verdict: { kind: 'take-now', label: 'Take now', reason: 'likely gone by 2.08' }, withRule: false }) }));
  });
  const spoken = container.querySelector('button.suggestion-verdict .sr-only')?.textContent;
  expect(spoken).toBe('Take now: likely gone by 2.08.');
  expect(spoken).not.toContain(VERDICT_RULE);
});

it('keeps a focusable Details trigger for warnings when there is no verdict (final pick, no estimate)', () => {
  act(() => {
    root.render(createElement(TooltipProvider, { delayDuration: 0,
      children: createElement(VerdictChip, { verdict: null, details: ['Questionable', 'Some risk: injury risk 6.0/10'] }) }));
  });
  const trigger = container.querySelector<HTMLButtonElement>('button.suggestion-details');
  expect(trigger?.textContent).toContain('Details');
  act(() => { trigger?.focus(); });
  expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toContain('Questionable');
});

it('renders nothing without a verdict or details', () => {
  act(() => { root.render(createElement(TooltipProvider, { children: createElement(VerdictChip, { verdict: null }) })); });
  expect(container.querySelector('button')).toBeNull();
});

it('keeps injury and risk chips out of the tab order, so dense rows gain no tab stops', () => {
  const player = { ...VISUAL_PLAYERS[0], newsStatus: 'questionable', injuryRiskScore: 90, uncertaintyScore: 90 } as NonNullable<typeof VISUAL_PLAYERS[0]>;
  act(() => {
    root.render(createElement(TooltipProvider, { children: [createElement(InjuryTag, { key: 'injury', status: player.newsStatus }), createElement(RiskChip, { key: 'risk', player })] }));
  });
  expect(container.querySelectorAll('button, [tabindex]')).toHaveLength(0);
  expect(container.textContent.length).toBeGreaterThan(0);
});
