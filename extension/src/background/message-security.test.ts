import { describe, expect, it, vi } from 'vitest';
import { decodeAuthorizedExtensionMessage, receiveExtensionMessage } from './message-security';

function acceptsAuthorizedMessage(value: unknown, sender: chrome.runtime.MessageSender, extensionId: string): boolean {
  try { decodeAuthorizedExtensionMessage(value, sender, extensionId); return true; } catch { return false; }
}

const id = 'a'.repeat(32);
// A top-level provider frame whose tab currently shows `url`.
function at(url: string, frameUrl = url): chrome.runtime.MessageSender {
  return { id, frameId: 0, url: frameUrl, origin: new URL(url).origin, tab: { id: 7, url } as chrome.tabs.Tab };
}
const sender = at('https://fantasy.espn.com/football/draft?leagueId=4242');
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
      at('https://fantasy.espn.com/football/draft?leagueId=9999'),
      at('https://attacker.invalid/football/draft?leagueId=4242'),
      at('http://fantasy.espn.com/football/draft?leagueId=4242'),
      { ...sender, tab: { id: 7, url: 'not a URL' } as chrome.tabs.Tab },
      { ...sender, origin: 'not a URL' },
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
    expect(acceptsAuthorizedMessage(message, at('https://sleeper.com/draft/nfl/123'), id)).toBe(true);
    expect(acceptsAuthorizedMessage(message, at('https://sleeper.com/draft/nfl/456'), id)).toBe(false);
    expect(acceptsAuthorizedMessage({ type: 'DRAFT_ROOM_STATUS', data: { isInDraftRoom: false } },
      at('https://sleeper.com/leagues'), id)).toBe(true);
  });

  it('accepts every draft-room URL the content script recognizes', () => {
    const message = { type: 'DRAFT_ROOM_STATUS', data: { isInDraftRoom: true, provider: 'sleeper', draftId: '123' } };
    for (const host of ['www.sleeper.app', 'www.sleeper.com']) {
      expect(acceptsAuthorizedMessage(message, at(`https://${host}/draft/nfl/123`), id)).toBe(true);
    }
    expect(acceptsAuthorizedMessage(snapshot, at('https://fantasy.espn.com/football/draft/?leagueId=4242'), id)).toBe(true);
  });

  it('requires the ESPN snapshot document itself to have loaded in the draft room', () => {
    const draftRoom = String(sender.url);
    expect(acceptsAuthorizedMessage(snapshot, at(draftRoom, draftRoom), id)).toBe(true);
    for (const frameUrl of ['https://fantasy.espn.com/football/team?leagueId=4242',
      draftRoom.replace('4242', '9999')]) {
      expect(acceptsAuthorizedMessage(snapshot, at(draftRoom, frameUrl), id)).toBe(false);
    }
    const { url: _url, ...frameless } = at(draftRoom);
    expect(acceptsAuthorizedMessage(snapshot, frameless, id)).toBe(false);
  });
});

describe('single-page navigation in a provider tab', () => {
  // Chromium keeps sender.url at the URL the content script started on; the tab URL is current.
  const leagues = 'https://sleeper.com/leagues/123';
  const draft = 'https://sleeper.com/draft/nfl/456';
  const entry = { type: 'DRAFT_ROOM_STATUS', data: { isInDraftRoom: true, provider: 'sleeper', draftId: '456' } };
  const pick = { type: 'PICK_DETECTED', data: { playerName: 'A Player', teamName: 'Team', timestamp: 1 } };
  const exit = { type: 'DRAFT_ROOM_STATUS', data: { isInDraftRoom: false } };

  it('accepts draft entry and picks after navigating into the draft room', () => {
    expect(acceptsAuthorizedMessage(entry, at(draft, leagues), id)).toBe(true);
    expect(acceptsAuthorizedMessage(pick, at(draft, leagues), id)).toBe(true);
  });

  it('accepts draft exit after navigating out of a directly opened draft room', () => {
    expect(acceptsAuthorizedMessage(exit, at(leagues, draft), id)).toBe(true);
    expect(acceptsAuthorizedMessage(entry, at(leagues, draft), id)).toBe(false);
  });

  it('rejects a tab URL from another origin than the sending frame', () => {
    for (const origin of ['https://www.sleeper.com', 'https://fantasy.espn.com', 'https://attacker.invalid']) {
      expect(acceptsAuthorizedMessage(entry, { ...at(draft, leagues), origin }, id)).toBe(false);
    }
  });

  it('rejects subframes and senders without a tab URL', () => {
    expect(acceptsAuthorizedMessage(entry, { ...at(draft, leagues), frameId: 3 }, id)).toBe(false);
    const { tab: _tab, ...tabless } = at(draft, leagues);
    expect(acceptsAuthorizedMessage(entry, tabless, id)).toBe(false);
    expect(acceptsAuthorizedMessage(entry, { ...tabless, tab: { id: 7 } as chrome.tabs.Tab }, id)).toBe(false);
    const { origin: _origin, ...originless } = at(draft, leagues);
    expect(acceptsAuthorizedMessage(entry, originless, id)).toBe(false);
  });
});


describe('invalid extension message rejection', () => {
  it('rejects invalid optional status fields instead of trusting the sender URL', () => {
    const sleeper = at('https://sleeper.com/leagues');
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
