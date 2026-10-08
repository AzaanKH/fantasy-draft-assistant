import {
  evaluateDraftReadiness,
  createDefaultLeagueSettings,
  isLeagueSettings,
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
  readonly usePrimaryLeagueSettings?: boolean;
  readonly useQuickMockSettings?: boolean;
  readonly keeperStatus: KeeperPreloadStatus;
  /**
   * The static demo: its bundled snapshot does not expire, and its rankings
   * come from the experimental model rather than FantasyPros.
   */
  readonly demo?: boolean;
  readonly demoRankingsSource?: string;
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
  const currentSeason = new Date(now).getUTCFullYear();
  const usingPracticeSettings = input.usePrimaryLeagueSettings === true &&
    input.leagueSettings.source === 'default' && input.leagueSettings.leagueId === null;
  const validPracticeSettings = usingPracticeSettings &&
    input.leagueSettings.fingerprint === createDefaultLeagueSettings(now).fingerprint &&
    input.totalRounds >= 14;
  const settingsConnected =
    input.leagueSettings.source !== 'default' &&
    input.leagueSettings.leagueId !== null;
  const quickMock = input.useQuickMockSettings === true;
  const roster = input.leagueSettings.rosterRequirements;
  const starterCount = roster.QB.starters + roster.RB.starters + roster.WR.starters + roster.TE.starters +
    roster.FLEX.starters + roster.K.starters + roster.DEF.starters;
  const validQuickMock = quickMock && isLeagueSettings(input.leagueSettings) &&
    input.leagueSettings.source === 'default' && input.leagueSettings.leagueId === null &&
    input.leagueSettings.keepersEnabled === false && starterCount > 0 &&
    starterCount + roster.BENCH.spots <= input.totalRounds;
  const settingsObservation: DraftReadinessSourceObservation = {
    availability: quickMock ? validQuickMock ? 'available' : 'invalid'
      : usingPracticeSettings
      ? validPracticeSettings ? 'available' : 'invalid'
      : settingsConnected
      ? hasPrimaryLeagueSettings(input.leagueSettings, input.totalRounds)
        ? 'available'
        : 'invalid'
      : 'missing',
    timestamp: settingsConnected || usingPracticeSettings || quickMock
      ? new Date(input.leagueSettings.updatedAt).toISOString()
      : null,
    detail: quickMock ? 'Locally selected quick mock rules. No Primary League connection is required.' : usingPracticeSettings
      ? 'Primary League practice settings selected locally. Sleeper supplies picks and draft order. Use a 10-team mock with at least 14 rounds.'
      : settingsConnected
      ? 'Expected the provider-confirmed 10-team, 14-round Sleeper Primary League with 4-point passing touchdowns, full PPR, +0.5 TE reception premium, +0.2 rush-attempt scoring, and five bench spots.'
      : 'Connect the Primary League draft to load provider-confirmed settings.',
  };
  const keeperSupplyIsInvalid =
    input.keeperStatus.season !== currentSeason ||
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

  const report = evaluateDraftReadiness({
    sources: {
      ...input.sources,
      'primary-league-settings': settingsObservation,
      'confirmed-keeper-supply': quickMock && input.leagueSettings.keepersEnabled === false ? {
        availability: input.keeperStatus.isInitialized && input.keeperStatus.canonicalCount === 0 ? 'available' : 'missing',
        timestamp: new Date(now).toISOString(),
        detail: 'Quick mocks use no preloaded Primary League keepers.',
      } : keeperObservation,
    },
    warnings: input.warnings,
    enforceMaxAge: input.demo !== true,
  }, now);
  const demoSource = input.demo === true ? input.demoRankingsSource : undefined;
  const relabelDemo = (item: DraftReadinessReport['coreDraftData'][number]) => demoSource && item.key === 'trusted-rankings'
    ? {
      ...item,
      sourceLabel: demoSource,
      message: item.message.replaceAll(item.sourceLabel, demoSource),
      correctiveAction: 'Reload the page. If the demo rankings still fail to load, rebuild the demo with `pnpm build:web:demo`.',
    }
    : item;
  if (!quickMock && !demoSource) return report;
  const relabel = (item: DraftReadinessReport['coreDraftData'][number]) => item.key === 'primary-league-settings'
    ? { ...item, label: 'Quick mock settings', sourceLabel: 'Local mock settings', correctiveAction: 'Open League setup and choose quick mock rules that fit the draft size.', message: validQuickMock ? 'Quick mock settings are ready.' : 'The selected mock rules do not fit this draft. Review its teams, rounds, and roster.' }
    : item.key === 'confirmed-keeper-supply'
      ? { ...item, label: 'Mock keeper rules', sourceLabel: 'No-keeper mock', correctiveAction: 'Select Quick mock in League setup to clear Primary League keeper reservations.', message: item.status === 'ready' ? 'No keepers are reserved for this mock.' : 'Waiting for Primary League keeper reservations to clear.' }
      : item;
  const relabelItem = (item: DraftReadinessReport['coreDraftData'][number]) => relabelDemo(quickMock ? relabel(item) : item);
  return { ...report, coreDraftData: report.coreDraftData.map(relabelItem), productBlockingFailures: report.productBlockingFailures.map(relabelItem) };
}

export function blocksLiveRecommendations(
  sessionMode: 'setup' | 'mock' | 'live',
  readiness: DraftReadinessReport | null
): boolean {
  return sessionMode === 'live' && readiness?.status === 'blocked';
}

export function blocksRecommendations(
  sessionMode: 'setup' | 'mock' | 'live',
  readiness: DraftReadinessReport | null,
  requireAllCoreData = false
): boolean {
  const keeperSupplyBlocked = readiness?.coreDraftData.some(
    (item) => item.key === 'confirmed-keeper-supply' && item.status === 'blocking'
  ) ?? false;
  return keeperSupplyBlocked || (requireAllCoreData && readiness?.status === 'blocked') || blocksLiveRecommendations(sessionMode, readiness);
}
