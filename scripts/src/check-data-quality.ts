import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_TRAINING_ROWS } from './model/position-residual-model.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DATA_DIR = join(REPO_ROOT, 'data');
const OUTPUT_FILE = join(DATA_DIR, 'data-quality-report.json');
const strict = process.argv.includes('--strict');
const CURRENT_SEASON = new Date().getFullYear();

type CheckStatus = 'pass' | 'warn' | 'fail';

interface QualityCheck {
  readonly id: string;
  readonly status: CheckStatus;
  readonly message: string;
  readonly actual?: number | string | null;
  readonly expected?: number | string;
}

interface JsonRecord {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function nested(value: unknown, ...keys: readonly string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function timestamp(value: unknown): number {
  return typeof value === 'string' ? Date.parse(value) : Number.NaN;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(DATA_DIR, path), 'utf8')) as unknown;
}

function add(
  checks: QualityCheck[],
  id: string,
  status: CheckStatus,
  message: string,
  actual?: number | string | null,
  expected?: number | string
): void {
  checks.push({ id, status, message, actual, expected });
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

async function main(): Promise<void> {
  const checks: QualityCheck[] = [];
  const files = [
    'fantasypros-snapshot.json',
    'sportsbook-snapshot.json',
    'sleeper-adp.json',
    'player-identity.json',
    'team-environment.json',
    'predictions.json',
    'model-report.json',
    'recommendation-policy.json',
    'league-history/survival-model.json',
    'contracts.json',
    'historical-snapshot-report.json',
    'league-history/current-keepers.json',
  ] as const;
  const loaded = new Map<string, unknown>();

  for (const file of files) {
    try {
      loaded.set(file, await readJson(file));
      add(checks, `json.${file}`, 'pass', `${file} is valid JSON.`);
    } catch (error) {
      add(
        checks,
        `json.${file}`,
        'fail',
        `${file} could not be read: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  const fantasyPros = loaded.get('fantasypros-snapshot.json');
  const rankings = asArray(nested(fantasyPros, 'rankings'));
  const adp = asArray(nested(fantasyPros, 'adp'));
  const projections = asArray(nested(fantasyPros, 'projections'));
  const news = asArray(nested(fantasyPros, 'news'));
  const fpSeason = nested(fantasyPros, 'metadata', 'season');
  add(checks, 'fantasypros.season', fpSeason === CURRENT_SEASON ? 'pass' : 'fail',
    'FantasyPros snapshot season matches the draft season.', String(fpSeason), String(CURRENT_SEASON));
  for (const [id, values, minimum] of [
    ['rankings', rankings, 350],
    ['adp', adp, 300],
    ['projections', projections, 400],
  ] as const) {
    add(checks, `fantasypros.${id}.count`, values.length >= minimum ? 'pass' : 'fail',
      `FantasyPros ${id} meets the minimum usable count.`, values.length, `>= ${String(minimum)}`);
  }
  add(checks, 'fantasypros.news.count', news.length > 0 ? 'pass' : 'warn',
    'FantasyPros news is present.', news.length, '> 0');
  const pprBaselineCount = projections.filter((entry) =>
    isRecord(entry) &&
    finiteNumber(entry['projectedPoints']) &&
    finiteNumber(entry['baseProjectedPoints'])
  ).length;
  const pprBaselineCoverage = pprBaselineCount / Math.max(1, projections.length);
  add(checks, 'fantasypros.projections.ppr-baseline',
    pprBaselineCoverage >= 0.8 ? 'pass' : 'warn',
    pprBaselineCoverage >= 0.8
      ? 'FantasyPros projections retain an unmodified PPR baseline for local league scoring.'
      : 'FantasyPros snapshot predates PPR baseline fields; refresh it before draft day.',
    Number(pprBaselineCoverage.toFixed(4)), '>= 0.8');
  const projectionRefreshedAt = timestamp(
    nested(fantasyPros, 'metadata', 'projectionRefreshedAt') ??
      nested(fantasyPros, 'metadata', 'refreshedAt')
  );
  const projectionAgeDays = (Date.now() - projectionRefreshedAt) / (24 * 60 * 60 * 1000);
  add(checks, 'fantasypros.projections.freshness',
    Number.isFinite(projectionAgeDays) && projectionAgeDays <= 14 ? 'pass' : 'fail',
    'FantasyPros projections are no more than 14 days old.',
    Number.isFinite(projectionAgeDays) ? Number(projectionAgeDays.toFixed(2)) : null,
    '<= 14 days');
  const componentProjectionCount = projections.filter((entry) =>
    isRecord(entry) && (
      finiteNumber(entry['projectedPassingYards']) ||
      finiteNumber(entry['projectedRushingYards']) ||
      finiteNumber(entry['projectedReceivingYards'])
    )
  ).length;
  const componentProjectionCoverage =
    componentProjectionCount / Math.max(1, projections.length);
  add(checks, 'fantasypros.projections.component-stats',
    componentProjectionCoverage >= 0.8 ? 'pass' : 'fail',
    'FantasyPros projections retain component stats used by sportsbook markets.',
    Number(componentProjectionCoverage.toFixed(4)), '>= 0.8');

  const sportsbook = loaded.get('sportsbook-snapshot.json');
  const overUnderLines = asArray(nested(sportsbook, 'overUnder'));
  const milestoneLines = asArray(nested(sportsbook, 'milestones'));
  const sportsbookSeason = nested(sportsbook, 'metadata', 'season');
  const invalidOverUnderLines = overUnderLines.filter((entry) =>
    !isRecord(entry) ||
    typeof entry['playerName'] !== 'string' ||
    typeof entry['market'] !== 'string' ||
    !finiteNumber(entry['line']) ||
    !finiteNumber(entry['overOdds']) ||
    !finiteNumber(entry['underOdds'])
  ).length;
  const invalidMilestoneLines = milestoneLines.filter((entry) =>
    !isRecord(entry) ||
    typeof entry['playerName'] !== 'string' ||
    typeof entry['market'] !== 'string' ||
    !finiteNumber(entry['threshold']) ||
    !finiteNumber(entry['americanOdds'])
  ).length;
  add(checks, 'sportsbook.season',
    sportsbookSeason === CURRENT_SEASON ? 'pass' : 'fail',
    'Sportsbook snapshot season matches the draft season.',
    String(sportsbookSeason), String(CURRENT_SEASON));
  add(checks, 'sportsbook.over-under.count',
    overUnderLines.length >= 400 ? 'pass' : 'fail',
    'Sportsbook snapshot contains a usable over/under market set.',
    overUnderLines.length, '>= 400');
  add(checks, 'sportsbook.milestones.count',
    milestoneLines.length >= 800 ? 'pass' : 'fail',
    'Sportsbook snapshot contains a usable milestone price set.',
    milestoneLines.length, '>= 800');
  add(checks, 'sportsbook.lines.valid',
    invalidOverUnderLines + invalidMilestoneLines === 0 ? 'pass' : 'fail',
    'All sportsbook lines contain finite prices and thresholds.',
    invalidOverUnderLines + invalidMilestoneLines, '0 invalid');

  const sleeper = loaded.get('sleeper-adp.json');
  const sleeperPlayers = asArray(nested(sleeper, 'players'));
  const sleeperIds = sleeperPlayers.flatMap((player) =>
    isRecord(player) && typeof player['playerId'] === 'string' ? [player['playerId']] : []
  );
  const duplicateSleeperIds = sleeperIds.length - new Set(sleeperIds).size;
  add(checks, 'sleeper.count', sleeperPlayers.length >= 800 ? 'pass' : 'fail',
    'Sleeper player map meets the minimum usable count.', sleeperPlayers.length, '>= 800');
  add(checks, 'sleeper.ids.unique', duplicateSleeperIds === 0 ? 'pass' : 'fail',
    'Sleeper player IDs are unique.', duplicateSleeperIds, '0 duplicates');

  const identity = loaded.get('player-identity.json');
  const identities = asArray(nested(identity, 'players'));
  const identityFpIds = new Set(identities.flatMap((entry) =>
    isRecord(entry) && typeof entry['fantasyProsId'] === 'string' && typeof entry['sleeperId'] === 'string'
      ? [entry['fantasyProsId']]
      : []
  ));
  const top250 = rankings.slice(0, 250);
  const top250Matched = top250.filter((entry) =>
    isRecord(entry) && typeof entry['fantasyProsId'] === 'string' && identityFpIds.has(entry['fantasyProsId'])
  ).length;
  const top250MatchRate = top250Matched / Math.max(1, top250.length);
  const matchedDefenses = Number(nested(identity, 'coverage', 'matchedDefenses') ?? 0);
  add(checks, 'identity.top250.match-rate', top250MatchRate >= 0.98 ? 'pass' : 'fail',
    'Top-250 FantasyPros rankings map to a Sleeper identity.', Number(top250MatchRate.toFixed(4)), '>= 0.98');
  add(checks, 'identity.defenses', matchedDefenses === 32 ? 'pass' : 'fail',
    'All team defenses have canonical identities.', matchedDefenses, '32');

  const teamEnvironment = loaded.get('team-environment.json');
  const teams = nested(teamEnvironment, 'teams');
  const teamCount = isRecord(teams) ? Object.keys(teams).length : 0;
  const teamSeason = nested(teamEnvironment, 'season');
  add(checks, 'team-environment.count', teamCount === 32 ? 'pass' : 'fail',
    'Team environment contains all NFL teams.', teamCount, '32');
  add(checks, 'team-environment.season', teamSeason === CURRENT_SEASON - 1 ? 'pass' : 'fail',
    'Team environment uses the latest completed season.', String(teamSeason), String(CURRENT_SEASON - 1));

  const historicalSnapshots = loaded.get('historical-snapshot-report.json');
  const historicalSnapshotSeasons = asArray(nested(historicalSnapshots, 'seasons'));
  const historicalCutoffViolations = historicalSnapshotSeasons.reduce<number>((sum, season) =>
    sum + (isRecord(season) && finiteNumber(season['cutoffViolations'])
      ? season['cutoffViolations']
      : 1), 0);
  add(checks, 'historical-snapshots.seasons',
    historicalSnapshotSeasons.length >= 4 ? 'pass' : 'fail',
    'Historical draft-morning snapshots cover the stored league drafts.',
    historicalSnapshotSeasons.length, '>= 4');
  add(checks, 'historical-snapshots.cutoff',
    historicalCutoffViolations === 0 ? 'pass' : 'fail',
    'No snapshot uses information published after its historical draft cutoff.',
    historicalCutoffViolations, '0 violations');

  const predictions = loaded.get('predictions.json');
  const predictionPlayers = asArray(nested(predictions, 'players'));
  const invalidPredictions = predictionPlayers.filter((entry) =>
    !isRecord(entry) || !finiteNumber(entry['projectedPoints'])
  ).length;
  add(checks, 'predictions.count', predictionPlayers.length >= 800 ? 'pass' : 'fail',
    'Prediction output meets the minimum usable count.', predictionPlayers.length, '>= 800');
  add(checks, 'predictions.finite', invalidPredictions === 0 ? 'pass' : 'fail',
    'All projected point values are finite.', invalidPredictions, '0 invalid');
  const invalidCommonOutputs = predictionPlayers.filter((entry) => {
    if (!isRecord(entry)) return true;
    const projected = entry['projectedPoints'];
    const floor = entry['floorProjectedPoints'];
    const ceiling = entry['ceilingProjectedPoints'];
    const percentile = entry['positionPercentile'];
    return !finiteNumber(projected) || !finiteNumber(floor) || !finiteNumber(ceiling) ||
      !finiteNumber(percentile) || !finiteNumber(entry['uncertaintyScore']) ||
      !finiteNumber(entry['valueOverReplacement']) || floor > projected || projected > ceiling ||
      percentile < 0 || percentile > 100 || typeof entry['modelFamily'] !== 'string';
  }).length;
  add(checks, 'predictions.common-output-contract', invalidCommonOutputs === 0 ? 'pass' : 'fail',
    'Every model emits league points, floor, ceiling, uncertainty, position percentile, and VOR.',
    invalidCommonOutputs, '0 invalid');
  const offensiveModelFamilies = new Set(
    predictionPlayers
      .filter((entry) => isRecord(entry) && ['QB', 'RB', 'WR', 'TE'].includes(String(entry['position'])))
      .map((entry) => isRecord(entry) ? entry['modelFamily'] : undefined)
      .filter((family): family is string => typeof family === 'string')
  );
  const fittedPositionFamilies = [...offensiveModelFamilies].filter((family) => family.includes('ridge'));
  const positionModelReport = nested(loaded.get('model-report.json'), 'positionResidualModels');
  const positionModelTrainingRows = ['QB', 'RB', 'WR', 'TE'].map((position) =>
    nested(positionModelReport, position, 'trainingRows')
  );
  const minimumPositionModelTrainingRows = positionModelTrainingRows.every(finiteNumber)
    ? Math.min(...positionModelTrainingRows)
    : null;
  add(checks, 'predictions.position-models',
    offensiveModelFamilies.size === 4 && fittedPositionFamilies.length === 4 &&
      minimumPositionModelTrainingRows !== null &&
      minimumPositionModelTrainingRows >= MIN_TRAINING_ROWS ? 'pass' : 'fail',
    'QB, RB, WR, and TE predictions come from distinct fitted ridge model families with enough training rows.',
    minimumPositionModelTrainingRows,
    `4 model families; each >= ${String(MIN_TRAINING_ROWS)} training rows`);
  const featureAdjustedPredictions = predictionPlayers.filter((entry) =>
    isRecord(entry) && finiteNumber(entry['usageEfficiencyAdjustment']) &&
      entry['usageEfficiencyAdjustment'] !== 0
  ).length;
  add(checks, 'predictions.snap-ngs.coverage', featureAdjustedPredictions >= 100 ? 'pass' : 'fail',
    'Snap-share and Next Gen Stats adjust a usable set of current predictions.',
    featureAdjustedPredictions, '>= 100');

  const inputTime = Math.max(
    timestamp(nested(fantasyPros, 'metadata', 'refreshedAt')),
    timestamp(nested(sleeper, 'fetchedAt')),
    timestamp(nested(teamEnvironment, 'generatedAt'))
  );
  const identityTime = timestamp(nested(identity, 'generatedAt'));
  const predictionTime = timestamp(nested(predictions, 'generatedAt'));
  const policy = loaded.get('recommendation-policy.json');
  const policyTime = timestamp(nested(policy, 'generatedAt'));
  add(checks, 'dependencies.identity', identityTime >= Math.max(
    timestamp(nested(fantasyPros, 'metadata', 'refreshedAt')),
    timestamp(nested(sleeper, 'fetchedAt'))
  ) ? 'pass' : 'fail', 'Player identity is newer than its source snapshots.');
  add(checks, 'dependencies.predictions', predictionTime >= inputTime ? 'pass' : 'warn',
    'Predictions are newer than all current input snapshots.');
  add(checks, 'dependencies.recommendation-policy', policyTime >= predictionTime ? 'pass' : 'fail',
    'Recommendation policy is newer than the prediction artifact.');
  add(checks, 'recommendation-policy.decision',
    nested(policy, 'modelPredictionsEnabled') === false &&
      nested(policy, 'fallback') === 'fantasypros-ecr-market'
      ? 'pass' : 'fail',
    'The 2026 recommendation policy keeps live ordering ECR-anchored.');
  add(checks, 'recommendation-policy.promotion-gates',
    typeof nested(policy, 'promotionGates', 'feature', 'passed') === 'boolean' &&
      typeof nested(policy, 'promotionGates', 'release', 'passed') === 'boolean' &&
      typeof nested(policy, 'promotionGates', 'passed') === 'boolean' ? 'pass' : 'fail',
    'Recommendation policy records both sequential promotion gates and the combined decision.');
  add(checks, 'recommendation-policy.shadow-logging',
    nested(policy, 'shadowLogging', 'enabled') === true &&
      nested(policy, 'shadowLogging', 'season') === CURRENT_SEASON &&
      nested(policy, 'shadowLogging', 'endpoint') === '/api/shadow-recommendations'
      ? 'pass' : 'fail',
    `The ${String(CURRENT_SEASON)} experimental policy records the model only as Shadow Recommendation.`);
  add(checks, 'recommendation-policy.contract-signal',
    nested(policy, 'contractSignalEnabled') === false ? 'pass' : 'fail',
    'Contract context remains read-only and cannot alter live ordering.');
  add(checks, 'recommendation-policy.architecture',
    nested(policy, 'recommendationArchitecture') === 'pick-ev-v1' ? 'pass' : 'fail',
    'Recommendation policy selects the ECR-anchored PickEV architecture.');
  add(checks, 'recommendation-policy.pick-ev-override',
    typeof nested(policy, 'pickEvOverrideEnabled') === 'boolean' &&
      finiteNumber(nested(policy, 'pickEvOverrideThreshold')) &&
      typeof nested(policy, 'pickEvOverrideValidation', 'passed') === 'boolean' &&
      nested(policy, 'pickEvOverrideEnabled') ===
        nested(policy, 'pickEvOverrideValidation', 'passed')
      ? 'pass' : 'fail',
    'PickEV overrides are enabled only when the recorded hybrid gate passes.');
  add(checks, 'experimental.contract-signal',
    nested(policy, 'contractSignalEnabled') === true ? 'pass' : 'warn',
    nested(policy, 'contractSignalEnabled') === true
      ? 'Contract-year recommendation signal is validated and enabled.'
      : nested(policy, 'contractSignalValidationPassed') === true
        ? 'Contract-year validation passed, but the signal remains read-only pending separate live-policy approval.'
        : 'Contract data is available for context, but its recommendation boost is disabled until backtested.');

  const contracts = loaded.get('contracts.json');
  const contractPlayers = asArray(nested(contracts, 'players'));
  add(checks, 'contracts.current-context', contractPlayers.length >= 50 ? 'pass' : 'fail',
    contractPlayers.length > 0
      ? 'Contract-year context is populated from nflverse.'
      : 'Contract-year context is empty.', contractPlayers.length, '>= 50');
  const contractSourceAgeDays =
    (Date.now() - timestamp(nested(contracts, 'sourceUpdatedAt'))) / (24 * 60 * 60 * 1000);
  add(checks, 'contracts.source-freshness',
    Number.isFinite(contractSourceAgeDays) && contractSourceAgeDays <= 30 ? 'pass' : 'fail',
    'The upstream nflverse contracts release is no more than 30 days old.',
    Number.isFinite(contractSourceAgeDays) ? Number(contractSourceAgeDays.toFixed(2)) : null,
    '<= 30 days');

  const keepers = loaded.get('league-history/current-keepers.json');
  const currentKeepers = asArray(nested(keepers, 'keepers'));
  const currentKeepersUpdatedAt = nested(keepers, 'updatedAt');
  const currentKeepersConfirmed = Number.isFinite(timestamp(currentKeepersUpdatedAt));
  add(checks, 'core.current-keepers', currentKeepersConfirmed ? 'pass' : 'fail',
    currentKeepersConfirmed
      ? `${String(currentKeepers.length)} current keepers are confirmed for preloading.`
      : 'Confirmed keeper supply is missing; live Recommendations and mock simulation remain blocked until the complete keeper list has a valid updatedAt timestamp.',
    typeof currentKeepersUpdatedAt === 'string' ? currentKeepersUpdatedAt : null,
    'valid updatedAt confirmation timestamp');
  const keeperAssignmentsValid = currentKeepers.length > 0 && currentKeepers.every((keeper) =>
    isRecord(keeper) &&
    Number.isInteger(keeper['team']) &&
    finiteNumber(keeper['team']) &&
    keeper['team'] >= 1 &&
    Number.isInteger(keeper['round']) &&
    finiteNumber(keeper['round']) &&
    keeper['round'] >= 1
  );
  const keeperTeams = currentKeepers.flatMap((keeper) =>
    isRecord(keeper) && finiteNumber(keeper['team']) ? [keeper['team']] : []
  );
  add(checks, 'current-keepers.scheduled-picks',
    keeperAssignmentsValid && new Set(keeperTeams).size === keeperTeams.length ? 'pass' : 'fail',
    'Every keeper has one unique team and a round-selection cost.',
    keeperAssignmentsValid ? keeperTeams.length : 0,
    String(currentKeepers.length));
  const javonteKeeper = currentKeepers.find((keeper) =>
    isRecord(keeper) && keeper['playerName'] === 'Javonte Williams'
  );
  add(checks, 'current-keepers.javonte-slot',
    isRecord(javonteKeeper) && javonteKeeper['team'] === 5 && javonteKeeper['round'] === 10
      ? 'pass'
      : 'fail',
    'Javonte Williams is reserved for Team 5 in Round 10 (10.06 in a 10-team snake).');

  const failures = checks.filter((check) => check.status === 'fail').length;
  const warnings = checks.filter((check) => check.status === 'warn').length;
  const report = {
    generatedAt: new Date().toISOString(),
    season: CURRENT_SEASON,
    status: failures > 0 ? 'fail' : warnings > 0 ? 'warn' : 'pass',
    summary: {
      passed: checks.filter((check) => check.status === 'pass').length,
      warnings,
      failures,
    },
    checks,
  };
  await writeFile(OUTPUT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  for (const check of checks) {
    console.log(`${check.status.toUpperCase().padEnd(4)} ${check.id}: ${check.message}`);
  }
  console.log(`\nData quality: ${String(failures)} failure(s), ${String(warnings)} warning(s).`);
  if (strict && failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error('Data quality check failed:', error);
  process.exit(1);
});
