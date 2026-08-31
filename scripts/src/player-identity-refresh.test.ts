import { describe, expect, it } from 'vitest';
import { playerIdentityInternals } from './build-player-identity.js';
import { sleeperDataInternals } from './fetch-sleeper-adp.js';

describe('player identity refresh normalization', () => {
  it('maps Sleeper fullbacks into the fantasy running-back position', () => {
    expect(sleeperDataInternals.normalizeSleeperPosition('FB')).toBe('RB');
    expect(sleeperDataInternals.normalizeSleeperPosition('WR')).toBe('WR');
    expect(sleeperDataInternals.normalizeSleeperPosition('CB')).toBeNull();
  });

  it('retains offseason inactive players but excludes retired records', () => {
    expect(sleeperDataInternals.isExcludedSleeperStatus('Inactive')).toBe(false);
    expect(sleeperDataInternals.isExcludedSleeperStatus('Active')).toBe(false);
    expect(sleeperDataInternals.isExcludedSleeperStatus('Reserve/Retired')).toBe(true);
  });

  it.each([
    ['Hollywood Brown', 'Marquise Brown'],
    ['Bam Knight', 'Zonovan Knight'],
    ['Juice Wells Jr.', 'Antwane Wells'],
    ['Chris Brazzell II', 'Chris Brazzell'],
    ['David Sills V', 'David Sills'],
  ])('normalizes %s and %s to the same identity', (fantasyProsName, sleeperName) => {
    expect(playerIdentityInternals.normalizeName(fantasyProsName)).toBe(
      playerIdentityInternals.normalizeName(sleeperName)
    );
  });
});
