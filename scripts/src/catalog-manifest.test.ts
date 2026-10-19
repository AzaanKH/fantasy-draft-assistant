import { describe, expect, it } from 'vitest';
import { CATALOG, catalogPath, browserDataFiles, catalogDataClassification } from '@fantasy-draft/shared/catalog';

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


describe('catalog retention policy', () => {
  it('classifies generated reports, private modeling artifacts and demo fixtures', () => {
    expect(catalogDataClassification('data/web-bundle-report.json')).toBe('tracked');
    expect(catalogDataClassification('data/primary-league-deterministic-rehearsal-report.json')).toBe('tracked');
    expect(catalogDataClassification('data/primary-league-rehearsal.json')).toBe('private');
    expect(catalogDataClassification('data/model/raw/contracts.parquet')).toBe('private');
    expect(catalogDataClassification('data/model/.gitkeep')).toBe('tracked');
    expect(catalogDataClassification('data/league-history/raw/2025-draft.json')).toBe('private');
    expect(catalogDataClassification('demo-data/fantasypros-snapshot.json')).toBe('tracked');
    expect(catalogDataClassification('data/unregistered.json')).toBeNull();
    expect(catalogDataClassification('data/model/../secret.json')).toBeNull();
  });
});
