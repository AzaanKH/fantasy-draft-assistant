import { describe, expect, it } from 'vitest';
import {
  formatRelativeAge,
  getOldestTimestamp,
  marketFreshnessTone,
  parseDraftId,
  validateDraftInput,
} from './draft-connect-parsing';

describe('parseDraftId', () => {
  it.each([
    ['https://sleeper.com/draft/nfl/1123456789012345678', { provider: 'sleeper', draftId: '1123456789012345678' }],
    ['https://football.fantasysports.yahoo.com/f1/12345/draft', { provider: 'yahoo', draftId: '12345' }],
    ['https://football.fantasysports.yahoo.com/draftclient/f1/777', { provider: 'yahoo', draftId: '777' }],
    ['https://fantasy.espn.com/football/draft?leagueId=4242&seasonId=2026', { provider: 'espn', draftId: '4242' }],
  ] as const)('recognizes provider URL %s regardless of the selected provider', (input, expected) => {
    expect(parseDraftId('sleeper', input)).toEqual(expected);
    expect(parseDraftId('yahoo', `  ${input}  `)).toEqual(expected);
  });

  it('accepts a schemeless provider URL', () => {
    expect(parseDraftId('espn', 'sleeper.com/draft/nfl/42?tab=board')).toEqual({ provider: 'sleeper', draftId: '42' });
  });

  it('treats a bare ID as the selected provider', () => {
    expect(parseDraftId('espn', 'abc_123-x')).toEqual({ provider: 'espn', draftId: 'abc_123-x' });
  });

  it.each(['https://sleeper.com/draft/nfl/123oops', 'https://evil.example/draft/nfl/123', 'https://example.com/f1/12345/', '', '   ', 'https://fantasy.espn.com/football/league?leagueId=4242', 'https://fantasy.espn.com/football/draft?leagueId=abc', 'not an id!'])('rejects %j', input => {
    expect(parseDraftId('sleeper', input)).toBeNull();
  });
});

describe('validateDraftInput', () => {
  it('returns the parsed connection when valid', () => {
    expect(validateDraftInput('sleeper', 'https://sleeper.com/draft/nfl/99')).toEqual({ ok: true, connection: { provider: 'sleeper', draftId: '99' } });
  });

  it('asks for input when empty', () => {
    expect(validateDraftInput('espn', ' ')).toEqual({ ok: false, message: 'Enter your ESPN draft URL or ID.' });
  });

  it('explains unsupported URLs separately from malformed IDs', () => {
    const url = validateDraftInput('sleeper', 'https://fantasy.espn.com/football/league?leagueId=4242');
    expect(url.ok).toBe(false);
    if (!url.ok) expect(url.message).toContain('not a supported draft room URL');
    const host = validateDraftInput('sleeper', 'sleeper.com/leagues/1');
    if (!host.ok) expect(host.message).toContain('not a supported draft room URL');
    const id = validateDraftInput('sleeper', 'draft id 12');
    expect(id).toEqual({ ok: false, message: 'Draft IDs can contain only letters, numbers, hyphens, and underscores.' });
  });
});

describe('freshness helpers', () => {
  const now = Date.parse('2026-09-01T12:00:00Z');
  it('formats relative ages', () => {
    expect(formatRelativeAge('2026-09-01T11:59:40Z', now)).toBe('just now');
    expect(formatRelativeAge('2026-09-01T11:15:00Z', now)).toBe('45m ago');
    expect(formatRelativeAge('2026-09-01T02:00:00Z', now)).toBe('10h ago');
    expect(formatRelativeAge('2026-08-29T12:00:00Z', now)).toBe('3d ago');
    expect(formatRelativeAge('garbage', now)).toBeNull();
  });

  it('picks the oldest valid timestamp', () => {
    expect(getOldestTimestamp(['2026-09-01T00:00:00Z', undefined, 'bad', '2026-08-30T00:00:00Z'])).toBe('2026-08-30T00:00:00Z');
    expect(getOldestTimestamp([undefined, 'bad'])).toBeNull();
  });

  it('grades market freshness', () => {
    expect(marketFreshnessTone(null, now)).toBe('bad');
    expect(marketFreshnessTone('2026-09-01T00:00:00Z', now)).toBe('good');
    expect(marketFreshnessTone('2026-08-31T00:00:00Z', now)).toBe('warn');
    expect(marketFreshnessTone('2026-08-28T00:00:00Z', now)).toBe('bad');
  });
});
