import { describe, expect, it, vi } from 'vitest';
import { startEspnContentBridge } from './espn-content-bridge';

const validSnapshot = {
  draft: {
    provider: 'espn',
    draftId: '4242',
    providerKey: '2026:4242',
    status: 'drafting',
    type: 'snake',
    settings: { teams: 10, rounds: 16, pickTimer: 30 },
    draftOrder: null,
  },
  picks: [
    {
      draftId: '4242',
      pickNumber: 1,
      round: 1,
      rosterId: 2,
      draftSlot: 2,
      teamIndex: 1,
      playerId: 'player-1',
      playerName: 'Example Player',
      position: 'RB',
      nflTeam: 'ATL',
      isKeeper: false,
      source: 'espn-extension',
      confidence: 'confirmed',
      observedAt: 1000,
    },
  ],
  observedAt: 1000,
} as const;

function dispatchSnapshot(snapshot: unknown): void {
  window.dispatchEvent(new MessageEvent('message', {
    source: window,
    origin: window.location.origin,
    data: {
      source: 'fantasy-draft-assistant:espn',
      version: 1,
      type: 'ESPN_DRAFT_SNAPSHOT',
      snapshot,
    },
  }));
}

describe('ESPN content bridge', () => {
  it('forwards complete snapshots and rejects invalid picks', () => {
    const sendMessage = vi.fn();
    const stop = startEspnContentBridge(sendMessage, window);

    try {
      dispatchSnapshot({ ...validSnapshot, picks: [null] });
      expect(sendMessage).not.toHaveBeenCalled();

      dispatchSnapshot(validSnapshot);
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'ESPN_DRAFT_SNAPSHOT',
        data: validSnapshot,
      });
    } finally {
      stop();
    }
  });
});
