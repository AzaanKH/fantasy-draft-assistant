// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DecisionSwap, MotionFade, MotionProvider } from './motion';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) {
    await act(async () => { await new Promise<void>((resolve) => { setTimeout(resolve, 5); }); });
  }
  expect(predicate()).toBe(true);
}

function renderSwap(player: string): void {
  act(() => {
    root.render(
      <MotionProvider>
        <DecisionSwap motionKey={player}>
          <button type="button">Draft {player}</button>
        </DecisionSwap>
      </MotionProvider>
    );
  });
}

function swapContentFor(player: string): HTMLElement | null {
  const button = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent === `Draft ${player}`);
  return button?.closest<HTMLElement>('[data-motion="content-swap"]') ?? null;
}

it('hides and disables outgoing decision content until the incoming player replaces it', async () => {
  renderSwap('Bijan');
  // Let the lazily loaded motion features arrive so the swap runs its exit animation.
  await act(async () => { await new Promise<void>((resolve) => { setTimeout(resolve, 20); }); });

  const current = swapContentFor('Bijan');
  expect(current?.inert).toBeFalsy();
  expect(current?.getAttribute('aria-hidden')).toBeNull();

  renderSwap('Chase');

  const outgoing = swapContentFor('Bijan');
  expect(outgoing).not.toBeNull();
  expect(outgoing?.inert).toBe(true);
  expect(outgoing?.getAttribute('aria-hidden')).toBe('true');

  await until(() => swapContentFor('Bijan') === null && swapContentFor('Chase') !== null);
  const incoming = swapContentFor('Chase');
  expect(incoming?.inert).toBeFalsy();
  expect(incoming?.getAttribute('aria-hidden')).toBeNull();
});

function renderFade(player: string): void {
  act(() => {
    root.render(<MotionFade motionKey={player}><span>{player}</span></MotionFade>);
  });
}

/** jsdom has no Web Animations API, so record calls instead. */
function stubAnimate(): ReturnType<typeof vi.fn> {
  const animate = vi.fn(() => ({ cancel: () => undefined }));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  return animate;
}

function removeAnimate(): void {
  Reflect.deleteProperty(HTMLElement.prototype, 'animate');
}

function stubReducedMotion(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

it('keeps the opacity fade when the user prefers reduced motion', () => {
  stubReducedMotion();
  const animate = stubAnimate();
  try {
    renderFade('Bijan');
    renderFade('Chase');
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0]?.[0]).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  } finally {
    removeAnimate();
  }
});

it('runs no fade in visual fixtures', () => {
  stubReducedMotion();
  document.documentElement.setAttribute('data-visual-test', '');
  const animate = stubAnimate();
  try {
    renderFade('Bijan');
    renderFade('Chase');
    expect(animate).not.toHaveBeenCalled();
  } finally {
    document.documentElement.removeAttribute('data-visual-test');
    removeAnimate();
  }
});
