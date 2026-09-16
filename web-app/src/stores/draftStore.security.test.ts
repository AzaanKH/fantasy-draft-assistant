import { describe, expect, it } from 'vitest';
import { createDefaultLeagueSettings } from '@fantasy-draft/shared';
import { createDraftStore } from './draftStore';

describe('draft store resource bounds', () => {
  it('ignores invalid sizes without allocating or losing the current configuration', () => {
    const store = createDraftStore();
    const original = store.getState().config;
    for (const totalTeams of [NaN, Infinity, 2 ** 32, 33, 2.5, -1]) {
      expect(() => { store.getState().setConfig({ totalTeams }); }).not.toThrow();
      expect(store.getState().config).toBe(original);
    }
    store.getState().setConfig({ totalRounds: 2 ** 32 });
    expect(store.getState().config).toBe(original);
    store.getState().setConfig({ totalTeams: 12, totalRounds: 20 });
    expect(store.getState().teamRosters).toHaveLength(12);
  });

  it('rejects oversized nested league settings before applying them', () => {
    const store = createDraftStore();
    const original = store.getState();
    store.getState().applyLeagueSettings({ ...createDefaultLeagueSettings(), totalTeams: 2 ** 32 });
    expect(store.getState()).toBe(original);
    const settings = createDefaultLeagueSettings();
    store.getState().applyLeagueSettings({ ...settings, rosterRequirements: {
      ...settings.rosterRequirements, BENCH: { spots: 2 ** 32 },
    } });
    expect(store.getState()).toBe(original);
  });
});
