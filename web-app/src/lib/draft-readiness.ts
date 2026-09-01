import {
  evaluateDraftReadiness,
  type DraftReadinessKey,
  type DraftReadinessReport,
  type DraftReadinessSourceObservation,
  type DraftReadinessWarningInput,
  type LeagueSettings,
} from '@fantasy-draft/shared';
import type { KeeperPreloadStatus } from '@/hooks/useKeeperPreload';

interface WorkspaceDraftReadinessInput {
  readonly sources: Readonly<Partial<Record<DraftReadinessKey, DraftReadinessSourceObservation>>>;
  readonly warnings: readonly DraftReadinessWarningInput[];
  readonly leagueSettings: LeagueSettings;
  readonly totalRounds: number;
  readonly keeperStatus: KeeperPreloadStatus;
}

function hasPrimaryLeagueSettings(
  settings: LeagueSettings,
  totalRounds: number
): boolean {
  const roster = settings.rosterRequirements;
  return (
    settings.source === 'sleeper' &&
    settings.leagueId !== null &&
    settings.totalTeams === 10 &&
    totalRounds === 14 &&
    settings.scoringRules.passing.touchdown === 4 &&
    settings.scoringRules.receiving.reception === 1 &&
    settings.scoringRules.receiving.tePremium === 0.5 &&
    settings.scoringRules.rushing.attemptBonus === 0.2 &&
    roster.QB.starters === 1 &&
    roster.RB.starters === 2 &&
    roster.WR.starters === 2 &&
    roster.TE.starters === 1 &&
    roster.FLEX.starters === 2 &&
    roster.K.starters === 1 &&
    roster.DEF.starters === 0 &&
    roster.BENCH.spots === 5 &&
    settings.unsupportedRosterSlots.length === 0
  );
}

export function evaluateWorkspaceDraftReadiness(
  input: WorkspaceDraftReadinessInput,
  now: number = Date.now()
): DraftReadinessReport {
  const settingsConnected =
    input.leagueSettings.source !== 'default' &&
    input.leagueSettings.leagueId !== null;
  const settingsObservation: DraftReadinessSourceObservation = {
    availability: settingsConnected
      ? hasPrimaryLeagueSettings(input.leagueSettings, input.totalRounds)
        ? 'available'
        : 'invalid'
      : 'missing',
    timestamp: settingsConnected
      ? new Date(input.leagueSettings.updatedAt).toISOString()
      : null,
    detail: settingsConnected
      ? 'Expected the provider-confirmed 10-team, 14-round Sleeper Primary League with 4-point passing touchdowns, full PPR, +0.5 TE reception premium, +0.2 rush-attempt scoring, and five bench spots.'
      : 'Connect the Primary League draft to load provider-confirmed settings.',
  };
  const keeperSupplyIsInvalid =
    input.keeperStatus.configuredCount !== 10 ||
    input.keeperStatus.resolvedCount !== 10 ||
    input.keeperStatus.canonicalCount !== 10 ||
    input.keeperStatus.unresolvedNames.length > 0 ||
    input.keeperStatus.duplicateNames.length > 0 ||
    input.keeperStatus.invalidAssignments.length > 0;
  const keeperObservation: DraftReadinessSourceObservation = {
    availability: input.keeperStatus.isLoading || input.keeperStatus.isError ||
      !input.keeperStatus.isConfirmed
      ? 'missing'
      : keeperSupplyIsInvalid
        ? 'invalid'
        : input.keeperStatus.isInitialized
          ? 'available'
          : 'missing',
    timestamp: input.keeperStatus.confirmedAt,
    detail: input.keeperStatus.error?.message ??
      (input.keeperStatus.duplicateNames.length > 0
        ? `Duplicate keeper entries: ${input.keeperStatus.duplicateNames.join(', ')}. Keep each kept player exactly once in data/league-history/current-keepers.json.`
        : input.keeperStatus.invalidAssignments.length > 0
          ? `Invalid keeper assignments: ${input.keeperStatus.invalidAssignments.join('; ')}. Give every keeper one legal team and round slot.`
        : input.keeperStatus.unresolvedNames.length > 0
          ? `Unresolved keepers: ${input.keeperStatus.unresolvedNames.join(', ')}.`
          : !input.keeperStatus.isInitialized
            ? 'Keeper assignments have not finished loading into the canonical draft state.'
            : 'Expected all 10 confirmed Primary League keepers to resolve to unique legal draft slots.'),
  };

  return evaluateDraftReadiness({
    sources: {
      ...input.sources,
      'primary-league-settings': settingsObservation,
      'confirmed-keeper-supply': keeperObservation,
    },
    warnings: input.warnings,
  }, now);
}

export function blocksLiveRecommendations(
  sessionMode: 'setup' | 'mock' | 'live',
  readiness: DraftReadinessReport | null
): boolean {
  return sessionMode === 'live' && readiness?.status === 'blocked';
}

export function blocksRecommendations(
  sessionMode: 'setup' | 'mock' | 'live',
  readiness: DraftReadinessReport | null
): boolean {
  const keeperSupplyBlocked = readiness?.coreDraftData.some(
    (item) => item.key === 'confirmed-keeper-supply' && item.status === 'blocking'
  ) ?? false;
  return keeperSupplyBlocked || blocksLiveRecommendations(sessionMode, readiness);
}
