import { describe, expect, it } from 'vitest';
import { browserDataCandidates, resolveDataSource } from './browser-data-source';

describe('resolveDataSource', () => {
  it.each([
    [{}, 'local'],
    [{ BROWSER_DATA_SOURCE: 'local' }, 'local'],
    [{ BROWSER_DATA_SOURCE: 'demo' }, 'demo'],
    [{ BROWSER_DATA_SOURCE: 'demo', VITE_DEMO_MODE: 'true' }, 'demo'],
    [{ VITE_DEMO_MODE: 'false' }, 'local'],
  ])('resolves %o to %s', (env, source) => {
    expect(resolveDataSource(env)).toBe(source);
  });

  it('rejects an unknown data source', () => {
    expect(() => resolveDataSource({ BROWSER_DATA_SOURCE: 'live' }))
      .toThrow('BROWSER_DATA_SOURCE must be "local" or "demo"; got "live".');
  });

  it.each([{ VITE_DEMO_MODE: 'true' }, { BROWSER_DATA_SOURCE: 'local', VITE_DEMO_MODE: 'true' }])(
    'requires demo data for the static demo runtime: %o', env => {
      expect(() => resolveDataSource(env)).toThrow('VITE_DEMO_MODE=true requires BROWSER_DATA_SOURCE=demo.');
    });
});

describe('browserDataCandidates', () => {
  const file = 'data/league-history/current-keepers.json';

  it('reads local data only from data/', () => {
    expect(browserDataCandidates('local', 'serve', file)).toEqual([file]);
    expect(browserDataCandidates('local', 'build', file)).toEqual([file]);
  });

  it('lets the demo dev server fall back to data/ for files the demo does not ship', () => {
    expect(browserDataCandidates('demo', 'serve', file)).toEqual(['demo-data/league-history/current-keepers.json', file]);
  });

  it('never bundles local data into a demo build', () => {
    expect(browserDataCandidates('demo', 'build', file)).toEqual(['demo-data/league-history/current-keepers.json']);
  });
});
