// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VisualApp } from '@/visual/VisualApp';
import { DEFAULT_BOARD_HEIGHT } from './draft-workspace-layout';

const boardRenders = vi.hoisted(() => ({ count: 0 }));

// Count renders of the real board so the test can see whether a drag re-renders every pick cell.
vi.mock('./DraftBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./DraftBoard')>();
  return {
    ...actual,
    DraftBoard: (props: NonNullable<Parameters<typeof actual.DraftBoard>[0]>) => {
      boardRenders.count += 1;
      return <actual.DraftBoard {...props} />;
    },
  };
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // No query matches, so the workspace uses the scrolling layout, which sizes the board with `height`.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  vi.stubGlobal('scrollTo', vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  window.localStorage.clear();
  boardRenders.count = 0;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  window.history.replaceState(null, '', '/__visual/mobile/draft');
  act(() => { root.render(createElement(VisualApp)); });
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

function separator(): HTMLElement {
  const element = container.querySelector<HTMLElement>('[role="separator"][aria-label="Resize draft board"]');
  if (!element) throw new Error('No board resizer rendered');
  return element;
}

function scrollers(): HTMLElement[] {
  const elements = [...container.querySelectorAll<HTMLElement>('.board-scroll')];
  expect(elements.length).toBeGreaterThan(0);
  return elements;
}

function pointer(type: string, clientY: number): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY });
  Object.defineProperty(event, 'pointerId', { value: 7 });
  act(() => { separator().dispatchEvent(event); });
}

it('starts and moves a drag without re-rendering the board, then commits once', () => {
  const rendersAtDragStart = boardRenders.count;
  pointer('pointerdown', 100);
  expect(boardRenders.count).toBe(rendersAtDragStart);
  expect(container.querySelector('.draft-workspace-stack')?.hasAttribute('data-resizing')).toBe(true);

  for (const clientY of [120, 150, 190]) pointer('pointermove', clientY);

  expect(boardRenders.count).toBe(rendersAtDragStart);
  for (const scroller of scrollers()) expect(scroller.style.height).toBe(`${String(DEFAULT_BOARD_HEIGHT + 90)}px`);
  expect(separator().getAttribute('aria-valuenow')).toBe(String(DEFAULT_BOARD_HEIGHT + 90));
  expect(window.localStorage.getItem('draft-board-height')).toBeNull();

  pointer('pointerup', 200);

  const committed = DEFAULT_BOARD_HEIGHT + 100;
  expect(boardRenders.count).toBe(rendersAtDragStart + 1);
  expect(container.querySelector('.draft-workspace-stack')?.hasAttribute('data-resizing')).toBe(false);
  for (const scroller of scrollers()) {
    // The inline drag height is gone; the committed variable sizes the scroller again.
    expect(scroller.style.height).toBe('');
    expect(scroller.style.getPropertyValue('--draft-board-height')).toBe(`${String(committed)}px`);
  }
  expect(window.localStorage.getItem('draft-board-height')).toBe(String(committed));
  expect(separator().getAttribute('aria-valuenow')).toBe(String(committed));
  expect(separator().getAttribute('aria-valuetext')).toBe(`Draft board ${String(committed)} pixels tall`);
});

it('keeps the drag within its bounds and commits the last height when the pointer is cancelled', () => {
  pointer('pointerdown', 100);
  pointer('pointermove', 5000);
  // The scrolling layout caps the board at 720px.
  for (const scroller of scrollers()) expect(scroller.style.height).toBe('720px');

  pointer('pointermove', 40);
  pointer('pointercancel', 0);

  // 320 - 60 = 260, kept from the last move rather than the cancelled pointer's position.
  expect(window.localStorage.getItem('draft-board-height')).toBe('260');
  for (const scroller of scrollers()) {
    expect(scroller.style.height).toBe('');
    expect(scroller.style.getPropertyValue('--draft-board-height')).toBe('260px');
  }
});

it('finishes an active drag when the dock collapses, so reopening shows the dragged height', () => {
  const dockToggle = (label: string): HTMLButtonElement => {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!button) throw new Error(`No "${label}" button rendered`);
    return button;
  };
  const stack = (): HTMLElement | null => container.querySelector<HTMLElement>('.draft-workspace-stack');

  pointer('pointerdown', 100);
  pointer('pointermove', 160);
  expect(stack()?.hasAttribute('data-resizing')).toBe(true);

  // The separator unmounts with the dock, so its pointerup never arrives.
  act(() => { dockToggle('Collapse player workspace').click(); });

  const dragged = DEFAULT_BOARD_HEIGHT + 60;
  expect(container.querySelector('[role="separator"][aria-label="Resize draft board"]')).toBeNull();
  expect(stack()?.hasAttribute('data-resizing')).toBe(false);
  expect(window.localStorage.getItem('draft-board-height')).toBe(String(dragged));
  for (const scroller of scrollers()) expect(scroller.style.height).toBe('');

  act(() => { dockToggle('Expand player workspace').click(); });

  expect(separator().getAttribute('aria-valuenow')).toBe(String(dragged));
  for (const scroller of scrollers()) {
    expect(scroller.style.getPropertyValue('--draft-board-height')).toBe(`${String(dragged)}px`);
  }
});
