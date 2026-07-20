import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function finiteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

async function main(): Promise<void> {
  const checks: QualityCheck[] = [];
  const files = [
    'fantasypros-snapshot.json',
    'sleeper-adp.json',
    'player-identity.json',
    'team-environment.json',
    'predictions.json',
    'recommendation-policy.json',
    'league-history/survival-model.json',
    'contracts.json',
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

  const predictions = loaded.get('predictions.json');
  const predictionPlayers = asArray(nested(predictions, 'players'));
  const invalidPredictions = predictionPlayers.filter((entry) =>
    !isRecord(entry) || !finiteNumber(entry['projectedPoints'])
  ).length;
  add(checks, 'predictions.count', predictionPlayers.length >= 800 ? 'pass' : 'fail',
    'Prediction output meets the minimum usable count.', predictionPlayers.length, '>= 800');
  add(checks, 'predictions.finite', invalidPredictions === 0 ? 'pass' : 'fail',
    'All projected point values are finite.', invalidPredictions, '0 invalid');
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
  add(checks, 'dependencies.predictions', predictionTime >= inputTime ? 'pass' : 'fail',
    'Predictions are newer than all current input snapshots.');
  add(checks, 'dependencies.recommendation-policy', policyTime >= predictionTime ? 'pass' : 'fail',
    'Recommendation policy is newer than the prediction artifact.');
  add(checks, 'recommendation-policy.decision',
    typeof nested(policy, 'modelPredictionsEnabled') === 'boolean' ? 'pass' : 'fail',
    'Recommendation policy explicitly enables the validated model or its fallback.');
  add(checks, 'recommendation-policy.contract-signal',
    typeof nested(policy, 'contractSignalEnabled') === 'boolean' ? 'pass' : 'fail',
    'Recommendation policy explicitly controls the unvalidated contract-year signal.');
  add(checks, 'experimental.contract-signal',
    nested(policy, 'contractSignalEnabled') === true ? 'pass' : 'warn',
    nested(policy, 'contractSignalEnabled') === true
      ? 'Contract-year recommendation signal is validated and enabled.'
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
  add(checks, 'optional.current-keepers', currentKeepers.length > 0 ? 'pass' : 'warn',
    currentKeepers.length > 0
      ? 'Current keepers are loaded.'
      : 'Current keepers are not confirmed yet; live keeper adjustments remain disabled.', currentKeepers.length);

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
