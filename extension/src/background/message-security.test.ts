import { describe, expect, it, vi } from 'vitest';
import { decodeAuthorizedExtensionMessage, receiveExtensionMessage } from './message-security';

function acceptsAuthorizedMessage(value: unknown, sender: chrome.runtime.MessageSender, extensionId: string): boolean {
  try { decodeAuthorizedExtensionMessage(value, sender, extensionId); return true; } catch { return false; }
}

const id = 'a'.repeat(32);
const sender = {
  id, frameId: 0, url: 'https://fantasy.espn.com/football/draft?leagueId=4242',
  tab: { id: 7 } as chrome.tabs.Tab,
};
const snapshot = {
  type: 'ESPN_DRAFT_SNAPSHOT', data: {
    draft: { provider: 'espn', draftId: '4242', providerKey: '2026:4242', status: 'drafting', type: 'snake',
      settings: { teams: 10, rounds: 16, pickTimer: 30 }, draftOrder: null },
    picks: [], observedAt: Date.now(),
  },
};

describe('extension sender boundary', () => {
  it('binds ESPN publications to this extension and the actual top-level draft URL', () => {
    expect(acceptsAuthorizedMessage(snapshot, sender, id)).toBe(true);
    for (const invalid of [
      { ...sender, id: 'b'.repeat(32) },
      { ...sender, frameId: 1 },
      { ...sender, url: 'https://fantasy.espn.com/football/draft?leagueId=9999' },
      { ...sender, url: 'https://attacker.invalid/football/draft?leagueId=4242' },
      { ...sender, url: 'http://fantasy.espn.com/football/draft?leagueId=4242' },
      { ...sender, url: 'not a URL' },
    ]) expect(acceptsAuthorizedMessage(snapshot, invalid, id)).toBe(false);
  });

  it('rejects oversized snapshots and provider-page attempts to read background state', () => {
    const oversized = { ...snapshot, data: { ...snapshot.data, draft: { ...snapshot.data.draft,
      settings: { ...snapshot.data.draft.settings, teams: 2 ** 32 } } } };
    expect(acceptsAuthorizedMessage(oversized, sender, id)).toBe(false);
    expect(acceptsAuthorizedMessage({ type: 'GET_DRAFT_STATUS' }, sender, id)).toBe(false);
    expect(acceptsAuthorizedMessage({ type: 'GET_DRAFT_STATUS' }, {
      id, url: `chrome-extension://${id}/sidepanel.html`,
    }, id)).toBe(true);
  });

  it('validates detector status against the sender URL after navigation', () => {
    const message = { type: 'DRAFT_ROOM_STATUS', data: { isInDraftRoom: true, provider: 'sleeper', draftId: '123' } };
    const sleeper = { ...sender, url: 'https://sleeper.com/draft/nfl/123' };
    expect(acceptsAuthorizedMessage(message, sleeper, id)).toBe(true);
    expect(acceptsAuthorizedMessage(message, { ...sleeper, url: 'https://sleeper.com/draft/nfl/456' }, id)).toBe(false);
    expect(acceptsAuthorizedMessage({ type: 'DRAFT_ROOM_STATUS', data: { isInDraftRoom: false } }, {
      ...sleeper, url: 'https://sleeper.com/leagues',
    }, id)).toBe(true);
  });

  it('accepts every draft-room URL the content script recognizes', () => {
    const message = { type: 'DRAFT_ROOM_STATUS', data: { isInDraftRoom: true, provider: 'sleeper', draftId: '123' } };
    for (const host of ['www.sleeper.app', 'www.sleeper.com']) {
      expect(acceptsAuthorizedMessage(message, { ...sender, url: `https://${host}/draft/nfl/123` }, id)).toBe(true);
    }
    expect(acceptsAuthorizedMessage(snapshot, { ...sender, url: sender.url.replace('/draft?', '/draft/?') }, id)).toBe(true);
  });
});


describe('invalid extension message rejection', () => {
  it('rejects invalid optional status fields instead of trusting the sender URL', () => {
    const sleeper = { ...sender, url: 'https://sleeper.com/leagues' };
    for (const data of [
      { isInDraftRoom: false, provider: 'invalid' },
      { isInDraftRoom: false, status: 'unexpected' },
      { isInDraftRoom: false, myDraftSlot: 0 },
      { isInDraftRoom: false, draftId: 42 },
    ]) expect(acceptsAuthorizedMessage({ type: 'DRAFT_ROOM_STATUS', data }, sleeper, id)).toBe(false);
  });

  it('logs malformed payload rejection at the runtime boundary', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(receiveExtensionMessage({ type: 'PICK_DETECTED', data: null }, sender, id, vi.fn(), vi.fn())).toBe(false);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('Rejected extension message'), expect.anything());
    } finally { warning.mockRestore(); }
  });
});


describe('runtime rejection response', () => {
  it('does not dispatch a malformed page snapshot and logs its rejection', () => {
    const handler = vi.fn();
    const response = vi.fn();
    const logger = { warn: vi.fn() };
    for (const value of [undefined, {}, { type: 'ESPN_DRAFT_SNAPSHOT' }, { ...snapshot, data: { ...snapshot.data, picks: [null] } }]) {
      expect(receiveExtensionMessage(value, sender, id, handler, response, logger)).toBe(false);
    }
    expect(handler).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(4);
    expect(response).toHaveBeenCalledWith({ success: false, error: 'Invalid message sender or payload' });
  });
});
