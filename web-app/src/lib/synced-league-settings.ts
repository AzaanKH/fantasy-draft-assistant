import { createQuickMockSettings, type QuickMockPreferences } from './quick-mock-settings';
import { createDefaultLeagueSettings, createLeagueSettings, type DraftProvider, type LeagueSettings } from '@fantasy-draft/shared';

/** Practice rules never claim to be provider-confirmed league settings. */
export function resolveSyncedLeagueSettings(
  provider: DraftProvider,
  totalTeams: number,
  providerSettings: LeagueSettings | null | undefined,
  usePrimaryLeagueSettings: boolean,
  quickMock?: QuickMockPreferences,
): LeagueSettings {
  if (provider === 'sleeper' && quickMock) return createQuickMockSettings({ ...quickMock, totalTeams });
  if (!(provider === 'sleeper' && usePrimaryLeagueSettings) && providerSettings) {
    return providerSettings;
  }
  return createLeagueSettings({ ...createDefaultLeagueSettings(), totalTeams });
}
