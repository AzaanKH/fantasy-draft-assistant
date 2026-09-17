import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Player } from '@fantasy-draft/shared';
import { describe, expect, it, vi } from 'vitest';
import { calculateIsMyTurn, useDraftSessionMode } from '@/stores/draftStore';
import { getPicksUntilMyTurn } from './on-the-clock-utils';
import { OnTheClock } from './OnTheClock';

vi.mock('@/stores/draftStore', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/stores/draftStore')>(),
  useDraftSessionMode: vi.fn(() => 'mock'),
  useIsMyTurn: () => true,
}));

vi.mock('@/features/recommendations/DraftDecisionContext', () => ({
  useDraftDecision: () => ({
    isLoading: false,
    overall: {
      recommendations: [],
      preferred: {
        playerId: 'test-player',
        playerName: 'Test Player',
        position: 'WR',
        reason: 'high roster need',
      },
    },
  }),
}));

describe('getPicksUntilMyTurn', () => {
  it('counts forward to the next user pick in a snake draft', () => {
    expect(getPicksUntilMyTurn(7, 1, 10, 15)).toBe(13);
    expect(getPicksUntilMyTurn(20, 1, 10, 15)).toBe(0);
  });

  it('returns null when the user has no picks remaining', () => {
    expect(getPicksUntilMyTurn(150, 1, 10, 15)).toBeNull();
  });
});

describe('calculateIsMyTurn', () => {
  it('tracks the active snake-draft slot as picks advance', () => {
    expect(calculateIsMyTurn(1, 1, 10)).toBe(true);
    expect(calculateIsMyTurn(2, 1, 10)).toBe(false);
    expect(calculateIsMyTurn(20, 1, 10)).toBe(true);
  });
});

describe('OnTheClock draft action', () => {
  it.each([
    { mode: 'live' as const, canDraft: false, disabled: true },
    { mode: 'mock' as const, canDraft: false, disabled: true },
    { mode: 'mock' as const, canDraft: true, disabled: false },
  ])('reflects pick permission in $mode mode with canDraft=$canDraft', ({ mode, canDraft, disabled }) => {
    vi.mocked(useDraftSessionMode).mockReturnValue(mode);
    const markup = renderToStaticMarkup(createElement(OnTheClock, {
      players: [{ id: 'test-player' } as Player],
      onDraft: vi.fn(),
      canDraft,
    }));
    const draftButton = markup.match(/<button\b[^>]*>Draft<\/button>/)?.[0];

    expect(draftButton).toBeDefined();
    expect(draftButton?.includes('disabled=""')).toBe(disabled);
  });
});
