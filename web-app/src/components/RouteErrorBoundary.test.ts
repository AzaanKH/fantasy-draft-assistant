// @vitest-environment jsdom
import { act, createElement, useEffect, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPageImportFailure, RouteErrorBoundary } from './RouteErrorBoundary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function FailingPage(): ReactElement {
  throw new Error('Failed to fetch dynamically imported module: http://localhost/src/features/assistant/AssistantPage.tsx');
}

function BrokenPage(): ReactElement {
  throw new TypeError('Cannot read properties of undefined');
}

let root: Root;
let container: HTMLDivElement;
// React's development build reports caught render errors through window; keep jsdom from printing them.
const silenceReportedError = (event: ErrorEvent): void => { event.preventDefault(); };

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  window.addEventListener('error', silenceReportedError);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  window.removeEventListener('error', silenceReportedError);
  vi.restoreAllMocks();
});

describe('RouteErrorBoundary', () => {
  it('keeps the surrounding providers mounted and offers a way back to the board', () => {
    const unmountSync = vi.fn();
    function SyncProvider({ children }: { readonly children: ReactElement }): ReactElement {
      useEffect(() => unmountSync, []);
      return children;
    }
    const onReturnToBoard = vi.fn();

    act(() => {
      root.render(createElement(SyncProvider, null,
        createElement(RouteErrorBoundary, { onReturnToBoard, children: createElement(FailingPage) })));
    });

    expect(container.querySelector('[role=alert]')?.textContent).toContain('This page couldn’t load');
    expect(unmountSync).not.toHaveBeenCalled();
    const back = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Back to draft board');
    act(() => { back?.click(); });
    expect(onReturnToBoard).toHaveBeenCalledOnce();
  });

  it('offers a reload for a page that failed to download, since browsers keep the failed module', () => {
    act(() => {
      root.render(createElement(RouteErrorBoundary, { onReturnToBoard: vi.fn(), children: createElement(FailingPage) }));
    });
    const labels = [...container.querySelectorAll('button')].map((button) => button.textContent);
    expect(labels).toEqual(['Back to draft board', 'Reload app']);
  });

  it('retries a render error in place and omits the board action when the board itself failed', () => {
    act(() => {
      root.render(createElement(RouteErrorBoundary, { children: createElement(BrokenPage) }));
    });
    const labels = [...container.querySelectorAll('button')].map((button) => button.textContent);
    expect(labels).toEqual(['Try again']);
  });

  it('recognizes each browser’s wording for a failed module download', () => {
    expect(isPageImportFailure(new TypeError('Failed to fetch dynamically imported module: /a.js'))).toBe(true);
    expect(isPageImportFailure(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isPageImportFailure(new TypeError('error loading dynamically imported module: /a.js'))).toBe(true);
    expect(isPageImportFailure(new TypeError('Cannot read properties of undefined'))).toBe(false);
  });
});
