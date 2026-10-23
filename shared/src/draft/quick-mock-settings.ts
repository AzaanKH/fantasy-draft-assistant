import { isPlainObject } from '../objects.js';
import { isBoundedInteger } from '../limits.js';
import { createDefaultLeagueSettings, createLeagueSettings, type LeagueSettings } from '../league-settings.js';

export interface QuickMockPreferences {
  readonly totalTeams: number;
  readonly totalRounds: number;
  readonly reception: 0 | 0.5 | 1;
  readonly passingTouchdown: 4 | 6;
}

export function isQuickMockPreferences(value: unknown): value is QuickMockPreferences {
  return isPlainObject(value) && isBoundedInteger(value.totalTeams, 2, 20) && isBoundedInteger(value.totalRounds, 10, 30) &&
    (value.reception === 0 || value.reception === 0.5 || value.reception === 1) &&
    (value.passingTouchdown === 4 || value.passingTouchdown === 6);
}

export function isLeagueSetupPreferences(value: unknown): value is {
  readonly profile: 'quick-mock' | 'primary-league';
  readonly quickMock: QuickMockPreferences;
} {
  return isPlainObject(value) && (value.profile === 'quick-mock' || value.profile === 'primary-league') && isQuickMockPreferences(value.quickMock);
}

export const DEFAULT_QUICK_MOCK: QuickMockPreferences = {
  totalTeams: 12, totalRounds: 15, reception: 1, passingTouchdown: 4,
};

export function createQuickMockSettings(preferences: QuickMockPreferences = DEFAULT_QUICK_MOCK, now = Date.now()): LeagueSettings {
  const base = createDefaultLeagueSettings(now);
  return createLeagueSettings({
    ...base,
    totalTeams: preferences.totalTeams,
    keepersEnabled: false,
    scoringRules: {
      ...base.scoringRules,
      passing: { ...base.scoringRules.passing, touchdown: preferences.passingTouchdown },
      rushing: { ...base.scoringRules.rushing, attemptBonus: 0 },
      receiving: { ...base.scoringRules.receiving, reception: preferences.reception, tePremium: 0 },
    },
    rosterRequirements: {
      ...base.rosterRequirements,
      FLEX: { starters: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
      DEF: { starters: 1, max: 2 },
      BENCH: { spots: Math.max(1, preferences.totalRounds - 9) },
    },
  }, now);
}
