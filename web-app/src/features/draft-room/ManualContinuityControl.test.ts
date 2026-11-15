import { createDraftStore } from '@/stores/draftStore';
import { WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DraftProvider } from '@fantasy-draft/shared/sync';
import { ManualContinuityControl } from './ManualContinuityControl';

const sync = vi.hoisted(() => ({
  provider: 'espn' as DraftProvider | null,
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
    ['espn', 'disconnected', 'error', 'ESPN'],
    ['yahoo', 'disconnected', 'connected', 'Yahoo'],
    ['sleeper', 'manual-continuity', 'connected', 'Sleeper'],
    [null, 'manual-continuity', 'connected', 'the provider'],
  ] as const)('names the connected provider (%s) in its %s guidance', (provider, synchronizationState, connectionState, name) => {
    Object.assign(sync, { provider, synchronizationState, connectionState });
    expect(render()).toContain(name);
  });
});

function renderToStaticMarkup(element: ReactElement): string {
  return renderMarkup(createElement(WorkspaceTestProvider, {store: createDraftStore(), children: element}));
}
