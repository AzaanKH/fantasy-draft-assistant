import { createDraftStore } from '@/stores/draftStore';
import { WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ManualContinuityControl } from './ManualContinuityControl';

const sync = vi.hoisted(() => ({
  provider: 'espn',
  synchronizationState: 'disconnected',
  connectionState: 'error',
}));
vi.mock('./LiveDraftSyncProvider', () => ({
  useLiveDraftSync: () => ({
    canEnterManualContinuity: true,
    connection: sync.provider ? { provider: sync.provider } : null,
    enterManualContinuity: vi.fn(),
    lastConfirmedPickNumber: 12,
    provisionalPickCount: 1,
    synchronizationState: sync.synchronizationState,
    viewState: { connectionState: sync.connectionState },
  }),
}));

function render(): string {
  return renderToStaticMarkup(createElement(ManualContinuityControl));
}

describe('ManualContinuityControl', () => {
  it.each([
    // A lost connection and a slow one are different states, each naming the provider.
    ['espn', 'disconnected', 'error', /ESPN is disconnected/],
    ['yahoo', 'disconnected', 'connected', /Yahoo updates are delayed/],
    // Provisional Picks stay on this device: never sent to the provider, named or not.
    ['sleeper', 'manual-continuity', 'connected', /local only and will never be submitted or queued with Sleeper/],
    [null, 'manual-continuity', 'connected', /local only and will never be submitted or queued with the provider/],
  ] as const)('with %s %s (%s), states %s in its status', (provider, synchronizationState, connectionState, meaning) => {
    Object.assign(sync, { provider, synchronizationState, connectionState });
    const markup = render();
    expect(markup).toContain('role="status"');
    expect(markup).toMatch(meaning);
  });
});

function renderToStaticMarkup(element: ReactElement): string {
  return renderMarkup(createElement(WorkspaceTestProvider, {store: createDraftStore(), children: element}));
}
