import { describe, expect, it, vi } from 'vitest';
import { startEspnContentBridge } from './espn-content-bridge';
import { receiveExtensionMessage } from '../background/message-security';

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
  it('relays untrusted snapshots to the background decoder', () => {
    const sendMessage = vi.fn();
    const stop = startEspnContentBridge(sendMessage, window);

    try {
      dispatchSnapshot({ ...validSnapshot, picks: [null] });
      expect(sendMessage).toHaveBeenCalledWith({ ...validSnapshot, picks: [null] });
      sendMessage.mockClear();

      dispatchSnapshot(validSnapshot);
      expect(sendMessage).toHaveBeenCalledWith(validSnapshot);
    } finally {
      stop();
    }
  });
});


describe('ESPN relay envelope', () => {
  it('keeps origin checks and sends malformed matching snapshots to the logged background boundary', () => {
    const relay = vi.fn();
    const stop = startEspnContentBridge(relay, window);
    const envelope = { source: 'fantasy-draft-assistant:espn', version: 1, type: 'ESPN_DRAFT_SNAPSHOT' };
    try {
      window.dispatchEvent(new MessageEvent('message', { source: window, origin: 'https://attacker.invalid', data: envelope }));
      window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { ...envelope, source: 'unrelated' } }));
      expect(relay).not.toHaveBeenCalled();
      window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: envelope }));
      expect(relay).toHaveBeenCalledWith(undefined);
    } finally { stop(); }
  });
});


describe('ESPN relay through the runtime boundary', () => {
  it('dispatches valid payloads and logs atomic rejection of malformed snapshots', () => {
    const handler = vi.fn(() => true);
    const logger = { warn: vi.fn() };
    const respond = vi.fn();
    const id = 'a'.repeat(32);
    const sender: chrome.runtime.MessageSender = {
      id, frameId: 0, url: 'https://fantasy.espn.com/football/draft?leagueId=4242',
      tab: { id: 7, index: 0, pinned: false, highlighted: false, windowId: 1, active: true, incognito: false, selected: true, discarded: false, autoDiscardable: true, groupId: -1 },
    };
    const stop = startEspnContentBridge((data) => {
      receiveExtensionMessage({ type: 'ESPN_DRAFT_SNAPSHOT', data }, sender, id, handler, respond, logger);
    }, window);
    try {
      dispatchSnapshot({ ...validSnapshot, picks: [validSnapshot.picks[0], null] });
      expect(handler).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(respond).toHaveBeenCalledWith({ success: false, error: 'Invalid message sender or payload' });
      dispatchSnapshot(validSnapshot);
      expect(handler).toHaveBeenCalledWith({ type: 'ESPN_DRAFT_SNAPSHOT', data: validSnapshot }, respond);
    } finally { stop(); }
  });
});
