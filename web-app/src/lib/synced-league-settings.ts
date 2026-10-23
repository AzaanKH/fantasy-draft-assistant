import { createQuickMockSettings, type QuickMockPreferences } from '@fantasy-draft/shared/draft';
import { createDefaultLeagueSettings, createLeagueSettings, type LeagueSettings } from '@fantasy-draft/shared/league';
import { type DraftProvider } from '@fantasy-draft/shared/sync';

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
