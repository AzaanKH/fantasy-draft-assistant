import { createDefaultLeagueSettings, createLeagueSettings, type DraftProvider, type LeagueSettings } from '@fantasy-draft/shared';

/** Practice rules never claim to be provider-confirmed league settings. */
export function resolveSyncedLeagueSettings(
  provider: DraftProvider,
  totalTeams: number,
  providerSettings: LeagueSettings | null | undefined,
  usePrimaryLeagueSettings: boolean,
): LeagueSettings {
  if (!(provider === 'sleeper' && usePrimaryLeagueSettings) && providerSettings) {
    return providerSettings;
  }
  return createLeagueSettings({ ...createDefaultLeagueSettings(), totalTeams });
}
