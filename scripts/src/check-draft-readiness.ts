import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  evaluateDraftReadiness,
  formatDraftReadinessTimestamp,
  type DraftReadinessDependencyObservation,
  type DraftReadinessKey,
  type DraftReadinessReport,
  type DraftReadinessSourceObservation,
  type DraftReadinessWarningInput,
} from '@fantasy-draft/shared';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const REPORT_PATH = join(REPO_ROOT, 'data', 'draft-readiness-report.json');

interface LoadedArtifact {
  readonly path: string;
  readonly value: unknown;
  readonly error: string | null;
}

type JsonRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nested(value: unknown, ...keys: readonly string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function timestamp(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

async function loadArtifact(path: string): Promise<LoadedArtifact> {
  try {
    const value = JSON.parse(await readFile(join(REPO_ROOT, path), 'utf8')) as unknown;
    return { path, value, error: null };
  } catch (error) {
    return {
      path,
      value: null,
      error: error instanceof Error ? error.message : 'unknown read error',
    };
  }
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
  if (!isRecord(value) || !isRecord(value['scoring'])) return false;
  const scoring = value['scoring'];
  return (
    value['season'] === season &&
    value['leagueName'] === 'Ummati Official' &&
    value['totalTeams'] === 10 &&
    value['totalRounds'] === 14 &&
    (value['source'] === 'sleeper' || value['source'] === 'manual-confirmation') &&
    scoring['passingTouchdown'] === 4 &&
    scoring['reception'] === 1 &&
    scoring['tightEndReceptionPremium'] === 0.5 &&
    scoring['rushAttemptBonus'] === 0.2 &&
    isRecord(value['roster']) &&
    value['roster']['QB'] === 1 &&
    value['roster']['RB'] === 2 &&
    value['roster']['WR'] === 2 &&
    value['roster']['TE'] === 1 &&
    value['roster']['FLEX'] === 2 &&
    value['roster']['K'] === 1 &&
    value['roster']['DEF'] === 0 &&
    value['roster']['BENCH'] === 5
  );
}

function areKeepersValid(value: unknown, season: number): boolean {
  if (!isRecord(value) || value['season'] !== season) return false;
  const keepers = asArray(value['keepers']);
  if (keepers.length !== 10) return false;

  const playerKeys = new Set<string>();
  const pickKeys = new Set<string>();
  for (const keeper of keepers) {
    if (
      !isRecord(keeper) ||
      typeof keeper['playerName'] !== 'string' ||
      !['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(String(keeper['position'])) ||
      !Number.isInteger(keeper['team']) ||
      !isFiniteNumber(keeper['team']) ||
      keeper['team'] < 1 ||
      keeper['team'] > 10 ||
      !Number.isInteger(keeper['round']) ||
      !isFiniteNumber(keeper['round']) ||
      keeper['round'] < 1 ||
      keeper['round'] > 14
    ) {
      return false;
    }
    const playerKey = `${keeper['playerName'].trim().toLowerCase()}:${String(keeper['position'])}`;
    const pickKey = `${String(keeper['team'])}:${String(keeper['round'])}`;
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

function renderSection(
  heading: string,
  items: readonly { readonly label: string; readonly message: string; readonly correctiveAction?: string }[]
): void {
  console.log(`\n${heading} (${String(items.length)})`);
  if (items.length === 0) {
    console.log('  None.');
    return;
  }
  for (const item of items) {
    console.log(`  ${item.label}: ${item.message}`);
    if (item.correctiveAction) console.log(`  Action: ${item.correctiveAction}`);
  }
}

export async function buildDraftReadinessReport(now: number): Promise<DraftReadinessReport> {
  const [rankings, identities, leagueSettings, keepers, predictions, contracts, sportsbook,
    sleeper, teamEnvironment, recommendationPolicy, survivalModel] = await Promise.all([
      loadArtifact('data/fantasypros-snapshot.json'),
      loadArtifact('data/player-identity.json'),
      loadArtifact('data/primary-league-settings.json'),
      loadArtifact('data/league-history/current-keepers.json'),
      loadArtifact('data/predictions.json'),
      loadArtifact('data/contracts.json'),
      loadArtifact('data/sportsbook-snapshot.json'),
      loadArtifact('data/sleeper-adp.json'),
      loadArtifact('data/team-environment.json'),
      loadArtifact('data/recommendation-policy.json'),
      loadArtifact('data/league-history/survival-model.json'),
    ]);
  const season = new Date(now).getUTCFullYear();
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
        rankingRows.length >= 350,
      `Expected at least 350 trusted ${String(season)} rankings from the FantasyPros API or reviewed manual refresh. Found ${String(rankingRows.length)}.`
    ),
    'canonical-player-identities': observation(
      identities,
      identityTimestamp,
      nested(identities.value, 'season') === season &&
        identityRows.length >= 800 &&
        isFiniteNumber(identityCoverage) &&
        identityCoverage >= 0.98 &&
        matchedDefenses === 32,
      `Expected at least 800 identities, 98% ranked-player coverage, and all 32 defenses for ${String(season)}.`,
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
      areKeepersValid(keepers.value, season),
      'Expected all 10 Primary League keepers with unique players and legal team/round costs.'
    ),
    'experimental-predictions': observation(
      predictions,
      timestamp(nested(predictions.value, 'generatedAt')),
      typeof nested(predictions.value, 'modelVersion') === 'string' &&
        predictionRows.length >= 800 &&
        predictionRows.every((player) =>
          isRecord(player) && isFiniteNumber(player['projectedPoints'])
        ),
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
      contractRows.length >= 50 && contractRows.every((player) =>
        isRecord(player) &&
        typeof player['name'] === 'string' &&
        typeof player['position'] === 'string' &&
        typeof player['isContractYear'] === 'boolean'
      ),
      'Expected at least 50 valid contract-context rows.'
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
      recommendationPolicy,
      'Recommendation policy',
      'ECR-anchored recommendation policy',
      timestamp(nested(recommendationPolicy.value, 'generatedAt')),
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

async function main(): Promise<void> {
  const nowOverride = process.env['DRAFT_READINESS_NOW'];
  const now = nowOverride ? Date.parse(nowOverride) : Date.now();
  if (!Number.isFinite(now)) {
    throw new Error('DRAFT_READINESS_NOW must be a valid ISO-8601 timestamp.');
  }

  const report = await buildDraftReadinessReport(now);
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Draft Readiness: ${report.status === 'ready' ? 'READY' : 'BLOCKED'}`);
  renderSection('PRODUCT-BLOCKING FAILURES', report.productBlockingFailures);
  renderSection('ACTIONABLE WARNINGS', report.actionableWarnings);
  renderSection('OPTIONAL SIGNAL DEGRADATION', report.optionalSignalDegradations);
  console.log('\nENGINEERING CHECKS (SEPARATE; NOT RUN)');
  console.log(`  ${report.engineeringChecks.message}`);
  console.log(`\nGenerated report: ${REPORT_PATH}`);

  if (report.status === 'blocked') process.exitCode = 1;
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    console.error('Draft Readiness check failed:', error);
    process.exit(1);
  });
}
