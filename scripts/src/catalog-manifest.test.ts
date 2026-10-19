import { describe, expect, it } from 'vitest';
import { CATALOG, catalogPath, browserDataFiles } from '@fantasy-draft/shared/catalog';

const baseFiles = [
  'data/contracts.json', 'data/fantasypros-snapshot.json', 'data/league-history/survival-model.json',
  'data/player-identity.json', 'data/predictions.json', 'data/recommendation-policy.json',
  'data/sleeper-adp.json', 'data/team-environment.json',
];

describe('catalog exposure', () => {
  it('preserves the base local and demo browser file sets and ordering', () => {
    expect(browserDataFiles('local')).toEqual(baseFiles);
    expect(browserDataFiles('demo')).toEqual(baseFiles.filter(path => path !== 'data/contracts.json'));
  });

  it('keeps file metadata out of the public handles', () => {
    for (const handle of Object.values(CATALOG)) expect(typeof handle).toBe('symbol');
    expect(catalogPath(CATALOG.identities)).toBe('data/player-identity.json');
    expect(() => Reflect.apply(catalogPath, undefined, [Symbol('unknown')])).toThrow('Unknown catalog file');
  });
});
