import { describe, expect, it } from 'vitest';
import { isMarketAdpFormat, isMarketAdpSnapshot, type MarketAdpSnapshot } from './index.js';

const snapshot: MarketAdpSnapshot = {
  source: 'fantasy-football-calculator',
  format: 'half-ppr',
  teams: 10,
  season: 2026,
  refreshedAt: '2026-09-01T12:00:00.000Z',
  draftCount: 1_250,
  players: [
    { externalId: '2749', name: 'Player One', position: 'WR', team: 'CIN', adp: 1.4 },
    { externalId: '3001', name: 'Free Agent', position: 'RB', team: null, adp: 180.2 },
  ],
};

describe('market ADP snapshots', () => {
  it('recognizes only the supported scoring formats', () => {
    expect(['standard', 'half-ppr', 'ppr'].every(isMarketAdpFormat)).toBe(true);
    expect(isMarketAdpFormat('superflex')).toBe(false);
    expect(isMarketAdpFormat('PPR')).toBe(false);
  });

  it('accepts snapshots with free agents and an unknown draft count', () => {
    expect(isMarketAdpSnapshot(snapshot)).toBe(true);
    expect(isMarketAdpSnapshot({ ...snapshot, draftCount: null, players: [] })).toBe(true);
  });

  it.each([
    ['another source', { source: 'sleeper' }],
    ['an unsupported format', { format: '2qb' }],
    ['a non-finite team count', { teams: Number.NaN }],
    ['a missing refresh time', { refreshedAt: undefined }],
    ['a non-array player list', { players: {} }],
  ])('rejects snapshots with %s', (_label, overrides) => {
    expect(isMarketAdpSnapshot({ ...snapshot, ...overrides })).toBe(false);
  });

  it.each([
    ['a zero ADP', { adp: 0 }],
    ['a negative ADP', { adp: -3 }],
    ['an infinite ADP', { adp: Number.POSITIVE_INFINITY }],
    ['an unknown position', { position: 'FB' }],
    ['an unknown team', { team: 'XXX' }],
    ['a numeric ID', { externalId: 2749 }],
  ])('rejects players with %s', (_label, overrides) => {
    const [first] = snapshot.players;
    expect(isMarketAdpSnapshot({ ...snapshot, players: [{ ...first, ...overrides }] })).toBe(false);
  });
});
