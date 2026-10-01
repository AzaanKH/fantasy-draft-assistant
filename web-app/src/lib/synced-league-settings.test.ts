import { DEFAULT_QUICK_MOCK } from './quick-mock-settings';
import { describe, expect, it } from 'vitest';
import { createDefaultLeagueSettings, createLeagueSettings } from '@fantasy-draft/shared';
import { createDraftStore } from '@/stores/draftStore';
import { resolveSyncedLeagueSettings } from './synced-league-settings';

const providerSettings = createLeagueSettings({
  ...createDefaultLeagueSettings(), source: 'sleeper', leagueId: 'practice-league',
  scoringRules: {
    ...createDefaultLeagueSettings().scoringRules,
    receiving: { ...createDefaultLeagueSettings().scoringRules.receiving, reception: 0, tePremium: 0 },
  },
});

describe('synced mock scoring and roster overrides', () => {
  it('uses the Primary League profile only with explicit Sleeper opt-in', () => {
    const practice = resolveSyncedLeagueSettings('sleeper', 10, providerSettings, true);
    expect(practice.source).toBe('default');
    expect(practice.leagueId).toBeNull();
    expect(practice.scoringRules.receiving.reception).toBe(1);
    expect(practice.scoringRules.receiving.tePremium).toBe(0.5);
    expect(practice.scoringRules.rushing.attemptBonus).toBe(0.2);
    expect(practice.rosterRequirements.BENCH.spots).toBe(5);
    expect(resolveSyncedLeagueSettings('sleeper', 10, providerSettings, false)).toBe(providerSettings);
    expect(resolveSyncedLeagueSettings('espn', 10, providerSettings, true)).toBe(providerSettings);
  });

  it('never reuses another league profile when the new draft supplies none', () => {
    expect(resolveSyncedLeagueSettings('sleeper', 12, undefined, false)).toMatchObject({ source: 'default', leagueId: null, totalTeams: 12 });
  });

  it('preserves synced picks, snake slot, and mock rounds when changing practice rules', () => {
    const store = createDraftStore();
    store.getState().setConfig({ totalTeams: 10, totalRounds: 15, myPickPosition: 5 });
    store.getState().reconcileSyncedPicks([{
      pickNumber: 5, playerId: 'player-5', playerName: 'My receiver', position: 'WR',
      teamIndex: 4, teamName: 'My Team', isMyPick: true,
    }], 6, []);
    const history = store.getState().draftHistory;
    store.getState().applyLeagueSettings(resolveSyncedLeagueSettings('sleeper', 10, providerSettings, true));
    expect(store.getState().draftHistory).toEqual(history);
    expect(store.getState().myRoster.WR).toContain('player-5');
    expect(store.getState().config).toMatchObject({ totalTeams: 10, totalRounds: 15, myPickPosition: 5 });
    expect(store.getState().currentPick).toBe(6);
    store.getState().applyLeagueSettings(resolveSyncedLeagueSettings('sleeper', 10, providerSettings, false));
    expect(store.getState().draftHistory).toEqual(history);
    expect(store.getState().leagueSettings.scoringRules.receiving.reception).toBe(0);
  });
});


it('uses explicit quick mock scoring with provider size while keeping canonical picks', () => {
  const rules = resolveSyncedLeagueSettings('sleeper', 10, undefined, false, {
    ...DEFAULT_QUICK_MOCK, reception: 0.5, passingTouchdown: 6, totalRounds: 16,
  });
  expect(rules).toMatchObject({ source: 'default', leagueId: null, totalTeams: 10, keepersEnabled: false });
  expect(rules.scoringRules).toMatchObject({ passing: { touchdown: 6 }, receiving: { reception: 0.5, tePremium: 0 }, rushing: { attemptBonus: 0 } });
  expect(rules.rosterRequirements).toMatchObject({ DEF: { starters: 1 }, FLEX: { starters: 1 }, BENCH: { spots: 7 } });
  expect(resolveSyncedLeagueSettings('espn', 10, providerSettings, false, DEFAULT_QUICK_MOCK)).toBe(providerSettings);
  const store = createDraftStore();
  store.getState().setConfig({ totalTeams: 10, totalRounds: 16, myPickPosition: 5 });
  store.getState().reconcileSyncedPicks([{
    pickNumber: 5, playerId: 'player-5', playerName: 'My receiver', position: 'WR',
    teamIndex: 4, teamName: 'My Team', isMyPick: true,
  }], 6, []);
  const history = store.getState().draftHistory;
  store.getState().applyLeagueSettings(rules);
  store.getState().preloadKeepers([]);
  expect(store.getState().draftHistory).toEqual(history);
  expect(store.getState().myRoster.WR).toContain('player-5');
  expect(store.getState().config).toMatchObject({ totalTeams: 10, totalRounds: 16, myPickPosition: 5 });
  expect(store.getState().currentPick).toBe(6);
});
