import { describe, expect, it } from 'vitest';
import { invocationMode, parseArguments } from './arguments';

describe('draft command arguments', () => {
  it('accepts provider sessions, defaults, and options before the command', () => {
    expect(parseArguments(['--json', 'status', '--session', 'espn:123', '--slot', '4'], {})).toMatchObject({
      command: 'status', session: { id: 'espn:123', provider: 'espn', draftId: '123' }, slot: 4, json: true,
    });
    expect(parseArguments(['recommend', '--limit=5'], { DRAFT_SESSION: '123', DRAFT_SLOT: '5' })).toMatchObject({
      session: { id: 'sleeper:123' }, slot: 5, limit: 5, lens: 'best-pick',
    });
    expect(parseArguments(['watch', '--session', 'yahoo:456', '--format=ndjson'], {})).toMatchObject({
      session: { provider: 'yahoo', draftId: '456' },
    });
  });

  it('uses saved connection settings with command and environment overrides', () => {
    const defaults = { session: 'sleeper:123', connections: [
      { session: 'sleeper:123', slot: 5, serverUrl: 'http://localhost:3101' },
      { session: 'yahoo:456', slot: 2, serverUrl: 'http://localhost:3102' },
    ] };
    expect(parseArguments(['roster'], {}, defaults)).toMatchObject({
      session: { id: 'sleeper:123' }, slot: 5, serverUrl: 'http://localhost:3101',
    });
    expect(parseArguments(['status'], { DRAFT_SESSION: 'yahoo:456' }, defaults)).toMatchObject({
      session: { id: 'yahoo:456' }, slot: 2, serverUrl: 'http://localhost:3102',
    });
    expect(parseArguments(['status', '--session', '123', '--slot', '3', '--server-url', 'http://localhost:3201'],
      { DRAFT_SLOT: '4', DRAFT_SERVER_URL: 'http://localhost:3301' }, defaults)).toMatchObject({
      session: { id: 'sleeper:123' }, slot: 3, serverUrl: 'http://localhost:3201',
    });
    expect(parseArguments(['sessions'], { DRAFT_SESSION: '123' }, defaults)).toMatchObject({
      session: undefined, serverUrl: 'http://localhost:3101',
    });
  });

  it.each([
    ['https://sleeper.com/draft/nfl/123', 'sleeper:123'],
    ['https://football.fantasysports.yahoo.com/draftclient/f1/456', 'yahoo:456'],
    ['https://fantasy.espn.com/football/draft?leagueId=789', 'espn:789'],
    ['123', 'sleeper:123'],
  ])('connects supported provider targets: %s', (target, session) => {
    expect(parseArguments(['connect', target, '--slot', '5', '--json'], {})).toMatchObject({
      command: 'connect', session: { id: session }, slot: 5,
    });
  });

  it('parses export and replay without inheriting live connection settings', () => {
    expect(parseArguments(['export', '--session', '123', '--out', 'session.json', '--force'], {})).toMatchObject({
      command: 'export', outputFile: 'session.json', force: true,
    });
    const env = { DRAFT_SESSION: 'invalid:live', DRAFT_SERVER_URL: 'https://external.invalid' };
    expect(parseArguments(['replay', 'session.json', '--pick', '24', '--format', 'ndjson'], env)).toMatchObject({
      command: 'replay', replayFile: 'session.json', pick: 24, format: 'ndjson', session: undefined,
    });
    for (const argv of [
      ['readiness'], ['status'], ['players', '--position', 'WR', '--available'],
      ['recommend', '--lens', 'best-player'], ['compare', 'p1', 'p2'], ['wait', 'p1'], ['roster'],
    ]) {
      expect(parseArguments([...argv, '--replay', 'session.json', '--pick', '2', '--json'], env)).toMatchObject({
        replayFile: 'session.json', pick: 2, session: undefined,
      });
    }
  });

  it('distinguishes replay commands from search text and file names', () => {
    expect(invocationMode(['--json', 'replay', 'session.json'])).toBe('replay');
    expect(invocationMode(['status', '--replay=session.json'])).toBe('replay');
    expect(invocationMode(['players', '--search', 'replay'])).toBe('live');
    expect(invocationMode(['export', '--out', 'replay'])).toBe('live');
    expect(invocationMode(['replay', '--help'])).toBe('help');
  });

  it.each([
    ['status'], ['status', '--session', 'espn:not-numeric'],
    ['compare', 'p1', '--session', '1'], ['compare', 'p1', 'p1', '--session', '1'],
    ['players', '--session', '1', '--position', 'FLEX'],
    ['recommend', '--session', '1', '--lens', 'value'],
    ['recommend', '--session', '1', '--limit', '0'],
    ['recommend', '--session', '1', '--limit', '5.2'],
    ['status', '--session', '1', '--slot', '33'],
    ['status', '--session', '1', '--available'],
    ['watch', '--session', '1', '--json'],
    ['watch', '--session', '1', '--format', 'json'],
    ['status', '--session', '1', '--server-url', 'https://example.com'],
    ['status', '--session', '1', '--server-url', 'http://localhost:3001/redirect'],
    ['status', '--session', '1', '--server-url', 'http://user:pass@localhost:3001'],
    ['sessions', '--session', '1'], ['sessions', '--slot', '1'],
    ['connect', '123', '--session', '456'], ['connect', '123', '456'],
    ['connect', 'https://example.com/draft/nfl/123'],
    ['connect', 'https://user:pass@sleeper.com/draft/nfl/123'],
    ['connect', 'https://sleeper.com/draftroom/123'],
    ['export', '--session', '123'], ['status', '--session', '123', '--force'],
    ['replay'], ['replay', ''], ['status', '--replay', ''], ['replay', 'session.json', '--session', '123'],
    ['replay', 'session.json', '--server-url', 'http://localhost:3001'],
    ['replay', 'session.json', '--format', 'ndjson', '--json'],
    ['replay', 'session.json', '--pick', '0'], ['replay', 'session.json', '--pick', '1282'],
    ['status', '--session', '123', '--pick', '2'],
    ['recommend', '--replay', 'session.json', '--session', '123'],
    ['watch', '--replay', 'session.json'], ['export', '--replay', 'session.json', '--out', 'copy.json'],
  ])('rejects invalid or unrelated options: %j', (...argv) => {
    expect(() => parseArguments(argv, {})).toThrow();
  });
});
