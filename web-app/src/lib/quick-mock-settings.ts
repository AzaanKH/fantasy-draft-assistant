import { createDefaultLeagueSettings, createLeagueSettings, type LeagueSettings } from '@fantasy-draft/shared';

export interface QuickMockPreferences {
  readonly totalTeams: number;
  readonly totalRounds: number;
  readonly reception: 0 | 0.5 | 1;
  readonly passingTouchdown: 4 | 6;
}

export const DEFAULT_QUICK_MOCK: QuickMockPreferences = {
  totalTeams: 12, totalRounds: 15, reception: 1, passingTouchdown: 4,
};

export function isQuickMockPreferences(value: unknown): value is QuickMockPreferences {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return Number.isInteger(p.totalTeams) && Number(p.totalTeams) >= 2 && Number(p.totalTeams) <= 20 &&
    Number.isInteger(p.totalRounds) && Number(p.totalRounds) >= 10 && Number(p.totalRounds) <= 30 &&
    [0, 0.5, 1].includes(Number(p.reception)) && typeof p.reception === 'number' &&
    (p.passingTouchdown === 4 || p.passingTouchdown === 6);
}

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
