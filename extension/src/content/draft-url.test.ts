import { describe, expect, it } from 'vitest';
import { parseDraftRoomUrl } from './draft-url';

describe('parseDraftRoomUrl', () => {
  it.each([
    [
      'https://sleeper.com/draft/nfl/123456789/board',
      { isInDraftRoom: true, provider: 'sleeper', draftId: '123456789' },
    ],
    [
      'https://sleeper.app/draft/nfl/abc_123',
      { isInDraftRoom: true, provider: 'sleeper', draftId: 'abc_123' },
    ],
    [
      'https://football.fantasysports.yahoo.com/f1/7428778',
      { isInDraftRoom: true, provider: 'yahoo', draftId: '7428778' },
    ],
    [
      'https://football.fantasysports.yahoo.com/draftclient/f1/7428778/3',
      { isInDraftRoom: true, provider: 'yahoo', draftId: '7428778' },
    ],
    [
      'https://sports-fantasy.media.yahoo.com/draft/f1/7428778/3',
      { isInDraftRoom: true, provider: 'yahoo', draftId: '7428778' },
    ],
    [
      'https://fantasy.espn.com/football/draft?leagueId=123456789&seasonId=2026&teamId=7',
      { isInDraftRoom: true, provider: 'espn', draftId: '123456789' },
    ],
    [
      'https://fantasy.espn.com/football/draft/?leagueId=123456789',
      { isInDraftRoom: true, provider: 'espn', draftId: '123456789' },
    ],
  ])('parses %s', (url, expected) => {
    expect(parseDraftRoomUrl(url)).toEqual(expected);
  });

  it.each([
    'not a URL',
    'https://example.com/draft/nfl/123',
    'https://sleeper.com/leagues/123',
    'https://football.fantasysports.yahoo.com/f1/',
    'https://fantasy.espn.com/football/draft?teamId=7',
    'https://fantasy.espn.com/football/waitingroom?leagueId=123456789',
  ])('rejects unsupported URL %s', (url) => {
    expect(parseDraftRoomUrl(url)).toEqual({ isInDraftRoom: false });
  });
});
