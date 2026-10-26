import { fixedClock } from '../units/clock.js';
import { Schema } from 'effect';
import { CATALOG, catalogPath } from './manifest.js';
import { POSITIONS } from '../league/positions.js';
import { currentSeason } from '../league/season.js';
import { READINESS_MINIMUMS, formatIdentityCoverage } from './readiness-minimums.js';
import { decodeFantasyProsSnapshot, decodePlayerIdentityFile, decodeKeeperFile, decodePrimaryLeagueSettingsFile, decodePredictionsDataFile, decodeOrNull } from './decoders.js';
import { evaluateDraftReadiness, formatDraftReadinessTimestamp, type DraftReadinessDependencyObservation, type DraftReadinessKey, type DraftReadinessReport, type DraftReadinessSourceObservation, type DraftReadinessWarningInput } from '../draft-readiness.js';


export interface LoadedArtifact {
  readonly path: string;
  readonly value: unknown;
  readonly error: string | null;
  readonly validationError?: string;
}

const decodeRecord = /* @__PURE__ */ Schema.decodeUnknownSync(/* @__PURE__ */ Schema.Record(Schema.String, Schema.Unknown));
const hasPredictionScore = /* @__PURE__ */ Schema.is(/* @__PURE__ */ Schema.Struct({ projectedPoints: Schema.Finite }));
const hasContractContext = /* @__PURE__ */ Schema.is(/* @__PURE__ */ Schema.Struct({
  name: Schema.String, position: Schema.String, isContractYear: Schema.Boolean,
}));
const hasKeeperSupply = /* @__PURE__ */ Schema.is(/* @__PURE__ */ Schema.Struct({
  season: Schema.Finite,
  keepers: /* @__PURE__ */ Schema.Array(/* @__PURE__ */ Schema.Struct({
    playerName: Schema.String, position: /* @__PURE__ */ Schema.Literals(POSITIONS),
    team: /* @__PURE__ */ Schema.Finite.check(/* @__PURE__ */ Schema.makeFilter(value => Number.isInteger(value) && value >= 1 && value <= 10)),
    round: /* @__PURE__ */ Schema.Finite.check(/* @__PURE__ */ Schema.makeFilter(value => Number.isInteger(value) && value >= 1)),
  })),
}));

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nested(value: unknown, ...keys: readonly string[]): unknown {
  let current = value;
  for (const key of keys) {
    current = decodeOrNull(decodeRecord, current)?.[key];
  }
  return current;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function timestamp(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function decodedArtifact(artifact: LoadedArtifact, decode: (value: unknown) => unknown): LoadedArtifact {
  if (artifact.error) return artifact;
  try { return { ...artifact, value: decode(artifact.value) }; }
  catch (error) { return { ...artifact, validationError: `Invalid ${artifact.path}: ${String(error)}` }; }
}

function unavailableObservation(artifact: LoadedArtifact): DraftReadinessSourceObservation {
  return {
    availability: 'missing',
    timestamp: null,
    detail: `${artifact.path} could not be read${artifact.error ? `: ${artifact.error}` : '.'}`,
  };
}

function observation(
  artifact: LoadedArtifact,
  observedAt: string | null,
  valid: boolean,
  invalidDetail: string,
  dependencies: readonly DraftReadinessDependencyObservation[] = []
): DraftReadinessSourceObservation {
  if (artifact.error) return unavailableObservation(artifact);
  if (artifact.validationError) return { availability: 'invalid', timestamp: observedAt, detail: artifact.validationError, dependencies };
  return {
    availability: observedAt === null ? 'missing' : valid ? 'available' : 'invalid',
    timestamp: observedAt,
    detail: observedAt === null
      ? `${artifact.path} has no confirmation or source timestamp.`
      : valid
        ? undefined
        : invalidDetail,
    dependencies,
  };
}

function isPrimaryLeagueSettings(value: unknown, season: number): boolean {
  const settings = decodeOrNull(decodePrimaryLeagueSettingsFile, value);
  if (!settings) return false;
  const { scoring, roster } = settings;
  return settings.season === season && settings.leagueName === 'Ummati Official' &&
    settings.totalTeams === 10 && settings.totalRounds === 14 &&
    scoring.passingTouchdown === 4 && scoring.reception === 1 &&
    scoring.tightEndReceptionPremium === 0.5 && scoring.rushAttemptBonus === 0.2 &&
    roster.QB === 1 && roster.RB === 2 && roster.WR === 2 && roster.TE === 1 &&
    roster.FLEX === 2 && roster.K === 1 && roster.DEF === 0 && roster.BENCH === 5;
}

export function areKeepersValid(value: unknown, season: number, totalRounds: unknown): boolean {
  if (!isFiniteNumber(totalRounds) || !Number.isInteger(totalRounds) || totalRounds < 1) return false;
  if (!hasKeeperSupply(value) || value.season !== season || value.keepers.length !== 10) return false;
  const playerKeys = new Set<string>();
  const pickKeys = new Set<string>();
  for (const keeper of value.keepers) {
    if (keeper.round > totalRounds) return false;
    const playerKey = `${keeper.playerName.trim().toLowerCase()}:${keeper.position}`;
    const pickKey = `${String(keeper.team)}:${String(keeper.round)}`;
    if (playerKeys.has(playerKey) || pickKeys.has(pickKey)) return false;
    playerKeys.add(playerKey);
    pickKeys.add(pickKey);
  }
  return true;
}

function createSupportWarning(
  artifact: LoadedArtifact,
  label: string,
  sourceLabel: string,
  observedAt: string | null,
  maxAgeHours: number,
  now: number,
  correctiveAction: string
): DraftReadinessWarningInput | null {
  if (artifact.error) {
    return {
      key: artifact.path,
      label,
      sourceLabel,
      message: `${label} is unavailable: ${artifact.error}`,
      correctiveAction,
      timestamp: null,
    };
  }
  const observedMs = observedAt ? Date.parse(observedAt) : Number.NaN;
  const ageHours = (now - observedMs) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours > maxAgeHours || ageHours < -1 / 60) {
    return {
      key: artifact.path,
      label,
      sourceLabel,
      message: `${label} needs attention (${formatDraftReadinessTimestamp(observedAt)}).`,
      correctiveAction,
      timestamp: observedAt,
    };
  }
  return null;
}

export async function buildDraftReadinessReport(now: number, loadArtifact: (path: string) => Promise<LoadedArtifact>): Promise<DraftReadinessReport> {
  const [rawRankings, rawIdentities, rawLeagueSettings, rawKeepers, rawPredictions, contracts, sportsbook,
    sleeper, teamEnvironment, recommendationEvaluation, survivalModel] = await Promise.all([
      loadArtifact(catalogPath(CATALOG.snapshot)),
      loadArtifact(catalogPath(CATALOG.identities)),
      loadArtifact(catalogPath(CATALOG.settings)),
      loadArtifact(catalogPath(CATALOG.keepers)),
      loadArtifact(catalogPath(CATALOG.predictions)),
      loadArtifact(catalogPath(CATALOG.contracts)),
      loadArtifact(catalogPath(CATALOG.sportsbook)),
      loadArtifact(catalogPath(CATALOG.sleeper)),
      loadArtifact(catalogPath(CATALOG.environment)),
      loadArtifact(catalogPath(CATALOG.evaluation)),
      loadArtifact(catalogPath(CATALOG.survival)),
    ]);
  const decodeWarnings: DraftReadinessWarningInput[] = [];
  const rankings = decodedArtifact(rawRankings, decodeFantasyProsSnapshot);
  const identities = decodedArtifact(rawIdentities, decodePlayerIdentityFile);
  const leagueSettings = decodedArtifact(rawLeagueSettings, decodePrimaryLeagueSettingsFile);
  const keepers = decodedArtifact(rawKeepers, decodeKeeperFile);
  const predictions = decodedArtifact(rawPredictions, value => decodePredictionsDataFile(value, {
    onWarning: message => decodeWarnings.push({ key: 'prediction-decode', label: 'Experimental predictions',
      sourceLabel: 'Prediction data', message, correctiveAction: 'Regenerate the experimental prediction data.' }),
  }));
  const season = currentSeason(fixedClock(now));
  const rankingsTimestamp = timestamp(nested(rankings.value, 'metadata', 'refreshedAt'));
  const identityTimestamp = timestamp(nested(identities.value, 'generatedAt'));
  const sleeperTimestamp = timestamp(nested(sleeper.value, 'fetchedAt'));
  const teamEnvironmentTimestamp = timestamp(nested(teamEnvironment.value, 'generatedAt'));
  const rankingRows = asArray(nested(rankings.value, 'rankings'));
  const identityRows = asArray(nested(identities.value, 'players'));
  const identityCoverage = nested(identities.value, 'coverage', 'fantasyProsRankingMatchRate');
  const matchedDefenses = nested(identities.value, 'coverage', 'matchedDefenses');
  const predictionRows = asArray(nested(predictions.value, 'players'));
  const contractRows = asArray(nested(contracts.value, 'players'));
  const sportsbookOverUnder = asArray(nested(sportsbook.value, 'overUnder'));
  const sportsbookMilestones = asArray(nested(sportsbook.value, 'milestones'));

  const sources: Partial<Record<DraftReadinessKey, DraftReadinessSourceObservation>> = {
    'trusted-rankings': observation(
      rankings,
      rankingsTimestamp,
      nested(rankings.value, 'metadata', 'season') === season &&
        ['api', 'manual-refresh'].includes(String(nested(rankings.value, 'metadata', 'sourceType'))) &&
        rankingRows.length >= READINESS_MINIMUMS.rankings,
      `Expected at least ${String(READINESS_MINIMUMS.rankings)} trusted ${String(season)} rankings from the FantasyPros API or reviewed manual refresh. Found ${String(rankingRows.length)}.`
    ),
    'canonical-player-identities': observation(
      identities,
      identityTimestamp,
      nested(identities.value, 'season') === season &&
        identityRows.length >= READINESS_MINIMUMS.identities &&
        isFiniteNumber(identityCoverage) &&
        identityCoverage >= READINESS_MINIMUMS.identityRankingMatchRate &&
        matchedDefenses === READINESS_MINIMUMS.defenses,
      `Expected at least ${String(READINESS_MINIMUMS.identities)} identities, ${formatIdentityCoverage()} ranked-player coverage, and all ${String(READINESS_MINIMUMS.defenses)} defenses for ${String(season)}.`,
      [
        { key: 'trusted-rankings', label: 'Trusted rankings', timestamp: rankingsTimestamp },
        { key: 'sleeper-player-directory', label: 'Sleeper player directory', timestamp: sleeperTimestamp },
      ]
    ),
    'primary-league-settings': observation(
      leagueSettings,
      timestamp(nested(leagueSettings.value, 'confirmedAt')),
      isPrimaryLeagueSettings(leagueSettings.value, season),
      'Expected the provider-confirmed 10-team, 14-round Primary League profile with 4-point passing touchdowns, full PPR, +0.5 TE reception premium, +0.2 rush-attempt scoring, and five bench spots.'
    ),
    'confirmed-keeper-supply': observation(
      keepers,
      timestamp(nested(keepers.value, 'updatedAt')),
      areKeepersValid(keepers.value, season, nested(leagueSettings.value, 'totalRounds')),
      'Expected all 10 Primary League keepers with unique players and legal team/round costs.'
    ),
    'experimental-predictions': observation(
      predictions,
      timestamp(nested(predictions.value, 'generatedAt')),
      typeof nested(predictions.value, 'modelVersion') === 'string' &&
        predictionRows.length >= READINESS_MINIMUMS.predictions &&
        predictionRows.every(hasPredictionScore),
      'The experimental prediction rows or model version are invalid.',
      [
        { key: 'trusted-rankings', label: 'Trusted rankings', timestamp: rankingsTimestamp },
        { key: 'canonical-player-identities', label: 'Canonical player identities', timestamp: identityTimestamp },
        { key: 'team-environment', label: 'Team environment', timestamp: teamEnvironmentTimestamp },
      ]
    ),
    'contract-context': observation(
      contracts,
      timestamp(nested(contracts.value, 'generatedAt')) ??
        timestamp(nested(contracts.value, 'scrapedAt')),
      contractRows.length >= READINESS_MINIMUMS.contracts && contractRows.every(hasContractContext),
      `Expected at least ${String(READINESS_MINIMUMS.contracts)} valid contract-context rows.`
    ),
    'sportsbook-context': observation(
      sportsbook,
      timestamp(nested(sportsbook.value, 'metadata', 'capturedAt')),
      nested(sportsbook.value, 'metadata', 'season') === season &&
        sportsbookOverUnder.length > 0 &&
        sportsbookMilestones.length > 0,
      `Expected non-empty ${String(season)} sportsbook markets.`
    ),
  };

  const warnings = [
    ...decodeWarnings,
    createSupportWarning(
      sleeper,
      'Sleeper player directory',
      'Sleeper player directory',
      sleeperTimestamp,
      24,
      now,
      'Run `pnpm refresh:sleeper`.'
    ),
    createSupportWarning(
      teamEnvironment,
      'Team environment',
      'Derived team environment',
      teamEnvironmentTimestamp,
      24 * 14,
      now,
      'Run `pnpm refresh:team-env`.'
    ),
    createSupportWarning(
      recommendationEvaluation,
      'Recommendation evaluation',
      'Historical recommendation backtest',
      timestamp(nested(recommendationEvaluation.value, 'generatedAt')),
      24 * 7,
      now,
      'Run `pnpm model:backtest`.'
    ),
    createSupportWarning(
      survivalModel,
      'League survival model',
      'Primary League draft history',
      timestamp(nested(survivalModel.value, 'generatedAt')),
      24 * 30,
      now,
      'Run `pnpm model:league-survival`.'
    ),
  ].filter((warning): warning is DraftReadinessWarningInput => warning !== null);

  return evaluateDraftReadiness({ sources, warnings }, now);
}
