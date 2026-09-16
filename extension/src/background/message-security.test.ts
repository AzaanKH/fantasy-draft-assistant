import { describe, expect, it } from 'vitest';
import { isAuthorizedExtensionMessage } from './message-security';

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
    expect(isAuthorizedExtensionMessage(snapshot, sender, id)).toBe(true);
    for (const invalid of [
      { ...sender, id: 'b'.repeat(32) },
      { ...sender, frameId: 1 },
      { ...sender, url: 'https://fantasy.espn.com/football/draft?leagueId=9999' },
      { ...sender, url: 'https://attacker.invalid/football/draft?leagueId=4242' },
      { ...sender, url: 'http://fantasy.espn.com/football/draft?leagueId=4242' },
      { ...sender, url: 'not a URL' },
    ]) expect(isAuthorizedExtensionMessage(snapshot, invalid, id)).toBe(false);
  });

  it('rejects oversized snapshots and provider-page attempts to read background state', () => {
    const oversized = { ...snapshot, data: { ...snapshot.data, draft: { ...snapshot.data.draft,
      settings: { ...snapshot.data.draft.settings, teams: 2 ** 32 } } } };
    expect(isAuthorizedExtensionMessage(oversized, sender, id)).toBe(false);
    expect(isAuthorizedExtensionMessage({ type: 'GET_DRAFT_STATUS' }, sender, id)).toBe(false);
    expect(isAuthorizedExtensionMessage({ type: 'GET_DRAFT_STATUS' }, {
      id, url: `chrome-extension://${id}/sidepanel.html`,
    }, id)).toBe(true);
  });

  it('validates detector status against the sender URL after navigation', () => {
    const message = { type: 'DRAFT_ROOM_STATUS', data: { isInDraftRoom: true, provider: 'sleeper', draftId: '123' } };
    const sleeper = { ...sender, url: 'https://sleeper.com/draft/nfl/123' };
    expect(isAuthorizedExtensionMessage(message, sleeper, id)).toBe(true);
    expect(isAuthorizedExtensionMessage(message, { ...sleeper, url: 'https://sleeper.com/draft/nfl/456' }, id)).toBe(false);
    expect(isAuthorizedExtensionMessage({ type: 'DRAFT_ROOM_STATUS', data: { isInDraftRoom: false } }, {
      ...sleeper, url: 'https://sleeper.com/leagues',
    }, id)).toBe(true);
  });
});
