import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DraftProvider } from '@fantasy-draft/shared';
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

describe('ManualContinuityControl provider copy', () => {
  it('names the connected provider when sync is lost or delayed', () => {
    sync.provider = 'espn';
    sync.synchronizationState = 'disconnected';
    sync.connectionState = 'error';
    expect(render()).toContain('ESPN is disconnected');

    sync.provider = 'yahoo';
    sync.connectionState = 'connected';
    expect(render()).toContain('Yahoo updates are delayed');
  });

  it('names the provider that Provisional Picks are never sent to', () => {
    sync.provider = 'sleeper';
    sync.synchronizationState = 'manual-continuity';
    expect(render()).toContain('never be submitted or queued with Sleeper.');

    sync.provider = null;
    expect(render()).toContain('never be submitted or queued with the provider.');
  });
});
