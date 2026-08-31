import { describe, expect, it } from 'vitest';
import { resolveSeasonHistoryColumn } from './contract-source-schema.js';

describe('contract refresh source schema', () => {
  it('uses the current nflverse season-history column', () => {
    expect(
      resolveSeasonHistoryColumn([
        'player',
        'cols',
        'season_history',
      ])
    ).toBe('season_history');
  });

  it('supports the legacy nflverse column', () => {
    expect(
      resolveSeasonHistoryColumn(['player', 'cols'])
    ).toBe('cols');
  });

  it('rejects an unknown contract schema', () => {
    expect(() =>
      resolveSeasonHistoryColumn(['player', 'contract_history'])
    ).toThrow(/season_history nor legacy cols/);
  });
});
