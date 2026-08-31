/**
 * Walk-forward validation of the contract-year feature.
 *
 * The baseline and treatment models use the same ridge regression, training
 * window, and player pool. The treatment model adds exactly one feature:
 * is_contract_year. A contract is eligible only when year_signed < season.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';
import { BACKTESTS_MODEL_DIR, DATA_DIR, REPO_ROOT, sqlString } from './model/duckdb.js';
import {
  ageBucket,
  evaluateContractReleaseGate,
  evaluatePredictions,
  experienceBucket,
  fitRidgeModel,
  predictionBreakdown,
  type ExpectedRole,
  type ModelPrediction,
  type OffensivePosition,
  type PlayerSeasonRow,
  type SeasonComparison,
} from './contract-year-backtest-core.js';
import {
  isContractSourceColumn,
  resolveSeasonHistoryColumn,
} from './contract-source-schema.js';

const CONTRACTS_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/contracts/historical_contracts.parquet';
const JSON_OUTPUT = join(BACKTESTS_MODEL_DIR, 'contract-year-backtest.json');
const MARKDOWN_OUTPUT = join(REPO_ROOT, 'docs', 'contract-year-backtest.md');
const POLICY_OUTPUT = join(DATA_DIR, 'recommendation-policy.json');
const HISTORY_START = Number(process.env['CONTRACT_BACKTEST_START_SEASON'] ?? 2012);
const HISTORY_END = Number(process.env['CONTRACT_BACKTEST_END_SEASON'] ?? 2025);
const FIRST_TEST_SEASON = Number(process.env['CONTRACT_BACKTEST_FIRST_TEST_SEASON'] ?? 2015);
const RIDGE_LAMBDA = Number(process.env['CONTRACT_BACKTEST_RIDGE_LAMBDA'] ?? 10);
const MODEL_VERSION = 'contract-year-walk-forward-ridge-v1';
const PROVENANCE_COMMAND = 'pnpm model:backtest:contracts';
const CONTRACT_INPUT_IDENTIFIER = 'nflverse/contracts/historical_contracts.parquet';

interface QueryRow {
  readonly season: number | bigint;
  readonly gsis_id: string;
  readonly player_name: string;
  readonly position: string;
  readonly actual_points: number | bigint | null;
  readonly age: number | bigint | null;
  readonly experience: number | bigint | null;
  readonly prior_points: number | bigint | null;
  readonly prior_points_per_game_3yr: number | bigint | null;
  readonly prior_games: number | bigint | null;
  readonly prior_opportunity_per_game: number | bigint | null;
  readonly prior_target_share: number | bigint | null;
  readonly is_rookie: boolean | null;
  readonly expected_role: string;
  readonly contract_known: boolean | null;
  readonly is_contract_year: boolean | null;
}

interface RecommendationPolicy {
  readonly generatedAt?: string;
  readonly modelVersion?: string;
  readonly modelPredictionsEnabled?: boolean;
  readonly contractSignalEnabled?: boolean;
  readonly fallback?: string;
  readonly reason?: string;
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRecommendationPolicy(value: unknown): value is RecommendationPolicy {
  if (!isRecord(value)) return false;
  return (
    (value['generatedAt'] === undefined || typeof value['generatedAt'] === 'string') &&
    (value['modelVersion'] === undefined || typeof value['modelVersion'] === 'string') &&
    (value['modelPredictionsEnabled'] === undefined ||
      typeof value['modelPredictionsEnabled'] === 'boolean') &&
    (value['contractSignalEnabled'] === undefined ||
      typeof value['contractSignalEnabled'] === 'boolean') &&
    (value['fallback'] === undefined || typeof value['fallback'] === 'string') &&
    (value['reason'] === undefined || typeof value['reason'] === 'string')
  );
}

function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
}

function sqlList(values: readonly string[]): string {
  return `[${values.map(sqlString).join(', ')}]`;
}

function statsUrls(seasons: readonly number[]): string[] {
  return seasons.map(
    (season) =>
      `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${String(season)}.parquet`
  );
}

function rosterUrls(seasons: readonly number[]): string[] {
  return seasons.map(
    (season) =>
      `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${String(season)}.parquet`
  );
}

function asNumber(value: number | bigint | null): number {
  return Number(value ?? 0);
}

function isPosition(value: string): value is OffensivePosition {
  return value === 'QB' || value === 'RB' || value === 'WR' || value === 'TE';
}

function isExpectedRole(value: string): value is ExpectedRole {
  return value === 'high' || value === 'medium' || value === 'low' || value === 'rookie-unknown';
}

function mapRow(row: QueryRow): PlayerSeasonRow | null {
  if (!isPosition(row.position) || !isExpectedRole(row.expected_role)) return null;
  return {
    season: asNumber(row.season),
    gsisId: row.gsis_id,
    playerName: row.player_name,
    position: row.position,
    actualPoints: asNumber(row.actual_points),
    age: row.age === null ? null : asNumber(row.age),
    experience: asNumber(row.experience),
    priorPoints: asNumber(row.prior_points),
    priorPointsPerGame3yr: asNumber(row.prior_points_per_game_3yr),
    priorGames: asNumber(row.prior_games),
    priorOpportunityPerGame: asNumber(row.prior_opportunity_per_game),
    priorTargetShare: asNumber(row.prior_target_share),
    isRookie: row.is_rookie ?? false,
    expectedRole: row.expected_role,
    contractKnown: row.contract_known ?? false,
    isContractYear: row.is_contract_year ?? false,
  };
}

async function loadPlayerSeasons(): Promise<PlayerSeasonRow[]> {
  const statsSeasons = range(HISTORY_START - 3, HISTORY_END);
  const rosterSeasons = range(HISTORY_START, HISTORY_END);
  const database = await DuckDBInstance.create(':memory:');
  const connection = await database.connect();
  try {
    const schemaReader = await connection.runAndReadAll(`
      describe select * from read_parquet(${sqlString(CONTRACTS_URL)})
    `);
    const sourceColumns = schemaReader.getRowObjects().map((column) => {
      if (!isContractSourceColumn(column)) {
        throw new Error('DuckDB returned an invalid contract source schema row.');
      }
      return column.column_name;
    });
    const seasonHistoryColumn = resolveSeasonHistoryColumn(sourceColumns);

    const reader = await connection.runAndReadAll(`
      with stats as (
        select
          season::integer as season,
          player_id::varchar as gsis_id,
          any_value(player_display_name)::varchar as player_name,
          any_value(position)::varchar as position,
          max(games)::double as games,
          max(fantasy_points_ppr)::double
            + coalesce(max(carries), 0)::double * 0.20
            + case when any_value(position) = 'TE'
                then coalesce(max(receptions), 0)::double * 0.50 else 0 end
            as league_points,
          coalesce(max(attempts), 0)::double
            + coalesce(max(carries), 0)::double
            + coalesce(max(targets), 0)::double as opportunities,
          max(target_share)::double as target_share
        from read_parquet(${sqlList(statsUrls(statsSeasons))}, union_by_name = true)
        where season_type = 'REG'
          and position in ('QB', 'RB', 'WR', 'TE')
          and player_id is not null
        group by season, player_id
      ),
      roster_candidates as (
        select
          season::integer as season,
          gsis_id::varchar as gsis_id,
          arg_max(full_name, week)::varchar as player_name,
          arg_max(position, week)::varchar as position,
          max(years_exp)::integer as years_exp,
          any_value(entry_year)::integer as entry_year,
          any_value(draft_number)::integer as draft_number,
          any_value(birth_date)::date as birth_date
        from read_parquet(${sqlList(rosterUrls(rosterSeasons))}, union_by_name = true)
        where game_type = 'REG'
          and position in ('QB', 'RB', 'WR', 'TE')
          and gsis_id is not null
        group by season, gsis_id
      ),
      history as (
        select
          roster.season,
          roster.gsis_id,
          max_by(prior.league_points, prior.season) as prior_points,
          max_by(prior.games, prior.season) as prior_games,
          max_by(prior.opportunities / nullif(prior.games, 0), prior.season)
            as prior_opportunity_per_game,
          max_by(prior.target_share, prior.season) as prior_target_share,
          sum(prior.league_points) / nullif(sum(prior.games), 0)
            as prior_points_per_game_3yr
        from roster_candidates roster
        left join stats prior
          on roster.gsis_id = prior.gsis_id
          and prior.season between roster.season - 3 and roster.season - 1
        group by roster.season, roster.gsis_id
      ),
      contract_periods as (
        select
          gsis_id::varchar as gsis_id,
          year_signed::integer as year_signed,
          list_max(list_transform(${seasonHistoryColumn}, item -> try_cast(item.year as integer)))::integer
            as contract_end_year
        from read_parquet(${sqlString(CONTRACTS_URL)})
        where gsis_id is not null
          and year_signed > 0
      ),
      eligible_contracts as (
        select
          roster.season,
          roster.gsis_id,
          contracts.year_signed,
          contracts.contract_end_year,
          count(distinct contracts.contract_end_year) over (
            partition by roster.season, roster.gsis_id, contracts.year_signed
          ) as end_year_variants,
          row_number() over (
            partition by roster.season, roster.gsis_id
            order by contracts.year_signed desc, contracts.contract_end_year desc
          ) as recency_rank
        from roster_candidates roster
        join contract_periods contracts
          on roster.gsis_id = contracts.gsis_id
          and contracts.year_signed < roster.season
          and contracts.contract_end_year is not null
      ),
      known_contract as (
        select
          season,
          gsis_id,
          end_year_variants = 1 as contract_known,
          end_year_variants = 1 and contract_end_year = season as is_contract_year
        from eligible_contracts
        where recency_rank = 1
      ),
      joined as (
        select
          roster.season,
          roster.gsis_id,
          coalesce(current.player_name, roster.player_name) as player_name,
          roster.position,
          coalesce(current.league_points, 0) as actual_points,
          case when roster.birth_date is null then null
            else roster.season - year(roster.birth_date) - case
              when month(roster.birth_date) > 9
                or (month(roster.birth_date) = 9 and day(roster.birth_date) > 1)
                then 1
              else 0
            end
          end as age,
          coalesce(roster.years_exp, roster.season - roster.entry_year, 0) as experience,
          coalesce(history.prior_points, 0) as prior_points,
          coalesce(history.prior_points_per_game_3yr, 0) as prior_points_per_game_3yr,
          coalesce(history.prior_games, 0) as prior_games,
          coalesce(history.prior_opportunity_per_game, 0) as prior_opportunity_per_game,
          coalesce(history.prior_target_share, 0) as prior_target_share,
          coalesce(roster.years_exp, roster.season - roster.entry_year, 0) = 0 as is_rookie,
          case
            when coalesce(roster.years_exp, roster.season - roster.entry_year, 0) = 0
              then 'rookie-unknown'
            when roster.position = 'QB' and coalesce(history.prior_opportunity_per_game, 0) >= 25
              then 'high'
            when roster.position = 'QB' and coalesce(history.prior_opportunity_per_game, 0) >= 10
              then 'medium'
            when roster.position <> 'QB' and coalesce(history.prior_opportunity_per_game, 0) >= 10
              then 'high'
            when roster.position <> 'QB' and coalesce(history.prior_opportunity_per_game, 0) >= 4
              then 'medium'
            else 'low'
          end as expected_role,
          coalesce(contract.contract_known, false) as contract_known,
          coalesce(contract.is_contract_year, false) as is_contract_year,
          roster.draft_number
        from roster_candidates roster
        left join stats current
          on roster.gsis_id = current.gsis_id and roster.season = current.season
        left join history
          on roster.gsis_id = history.gsis_id and roster.season = history.season
        left join known_contract contract
          on roster.gsis_id = contract.gsis_id and roster.season = contract.season
      )
      select * exclude (draft_number)
      from joined
      where prior_points >= 20
        or prior_opportunity_per_game >= 3
        or (is_rookie and coalesce(draft_number, 999) <= 250)
      order by season, position, player_name
    `);
    return (reader.getRowObjects() as unknown as QueryRow[])
      .map(mapRow)
      .filter((row): row is PlayerSeasonRow => row !== null);
  } finally {
    connection.closeSync();
  }
}

function metricDelta(baseline: number, contract: number): number {
  return Number((contract - baseline).toFixed(4));
}

function formatMetric(value: number): string {
  return Number(value.toFixed(4)).toString();
}

async function main(): Promise<void> {
  if (!Number.isInteger(HISTORY_START) || !Number.isInteger(HISTORY_END) ||
      !Number.isInteger(FIRST_TEST_SEASON) || HISTORY_START >= FIRST_TEST_SEASON ||
      FIRST_TEST_SEASON > HISTORY_END) {
    throw new Error('Invalid contract backtest season window.');
  }

  const rows = await loadPlayerSeasons();
  const testSeasons = range(FIRST_TEST_SEASON, HISTORY_END);
  const baselinePredictions: ModelPrediction[] = [];
  const contractPredictions: ModelPrediction[] = [];
  const seasons: SeasonComparison[] = [];

  for (const season of testSeasons) {
    const trainingRows = rows.filter((row) => row.season < season);
    const testRows = rows.filter((row) => row.season === season);
    const baselineModel = fitRidgeModel(trainingRows, false, RIDGE_LAMBDA);
    const contractModel = fitRidgeModel(trainingRows, true, RIDGE_LAMBDA);
    const baselineSeason = testRows.map((row) => ({
      ...row,
      predictedPoints: baselineModel(row),
    }));
    const contractSeason = testRows.map((row) => ({
      ...row,
      predictedPoints: contractModel(row),
    }));
    baselinePredictions.push(...baselineSeason);
    contractPredictions.push(...contractSeason);
    seasons.push({
      season,
      baseline: evaluatePredictions(baselineSeason),
      contract: evaluatePredictions(contractSeason),
    });
  }

  const aggregateBaseline = evaluatePredictions(baselinePredictions);
  const aggregateContract = evaluatePredictions(contractPredictions);
  const contractYearObservations = baselinePredictions.filter((row) => row.isContractYear).length;
  const releaseGate = evaluateContractReleaseGate(
    aggregateBaseline,
    aggregateContract,
    seasons,
    contractYearObservations
  );
  const decision = releaseGate.passed
    ? 'The contract-year feature clears the multi-season promotion gate. It remains read-only until a separate live-policy approval.'
    : 'The contract-year feature does not clear the multi-season promotion gate; keep it disabled.';
  const historicalInputIdentifier =
    `nflverse-player-stats-and-season-rosters-${String(HISTORY_START)}-${String(HISTORY_END)}`;
  const report = {
    generatedAt: new Date().toISOString(),
    modelVersion: MODEL_VERSION,
    provenance: {
      command: PROVENANCE_COMMAND,
      contractIdentifier: CONTRACT_INPUT_IDENTIFIER,
      predictionIdentifier: MODEL_VERSION,
      historicalInputIdentifier,
    },
    evaluationDesign: {
      historicalSeasons: [HISTORY_START, HISTORY_END],
      testSeasons,
      method: 'Expanding-window, season-by-season out-of-sample ridge regression.',
      comparison:
        'Both models use the same rows, folds, features, scaling, and regularization; the treatment adds only is_contract_year.',
      contractCutoff:
        'Only contracts with year_signed strictly before the evaluated season are eligible. Same-year signings and extensions are excluded because the source has no exact signing date.',
      latestDealRule:
        'The latest eligible deal is used. Conflicting end years among deals signed in the same latest year are treated as unknown and never marked as contract years.',
      scoring:
        'Historical nflverse PPR points plus this league’s +0.20 per rush attempt and +0.50 per TE reception.',
      playerPool:
        'Rostered QB/RB/WR/TE players with prior production/opportunity, plus drafted rookies through pick 250.',
      expectedRole:
        'Point-in-time bucket from prior-season pass attempts, carries, and targets per game; rookies are kept separate.',
      ridgeLambda: RIDGE_LAMBDA,
    },
    coverage: {
      playerSeasons: rows.length,
      evaluatedPlayerSeasons: baselinePredictions.length,
      evaluatedContractYears: contractYearObservations,
      knownContractPlayerSeasons: baselinePredictions.filter((row) => row.contractKnown).length,
    },
    releaseGate: {
      ...releaseGate,
      decision,
    },
    aggregate: {
      baseline: aggregateBaseline,
      contract: aggregateContract,
      deltas: {
        mae: metricDelta(aggregateBaseline.mae, aggregateContract.mae),
        rmse: metricDelta(aggregateBaseline.rmse, aggregateContract.rmse),
        vorMae: metricDelta(aggregateBaseline.vorMae, aggregateContract.vorMae),
        top24Accuracy: metricDelta(
          aggregateBaseline.top24Accuracy,
          aggregateContract.top24Accuracy
        ),
        starterPoints: metricDelta(
          aggregateBaseline.starterPoints,
          aggregateContract.starterPoints
        ),
        draftRegret: metricDelta(aggregateBaseline.draftRegret, aggregateContract.draftRegret),
        vorCaptured: metricDelta(aggregateBaseline.vorCaptured, aggregateContract.vorCaptured),
      },
    },
    seasons: seasons.map((season) => ({
      ...season,
      maeDelta: metricDelta(season.baseline.mae, season.contract.mae),
      winner: season.contract.mae < season.baseline.mae
        ? 'contract' : season.contract.mae > season.baseline.mae ? 'baseline' : 'tie',
    })),
    breakdowns: {
      position: predictionBreakdown(
        baselinePredictions, contractPredictions, (row) => row.position
      ),
      age: predictionBreakdown(baselinePredictions, contractPredictions, ageBucket),
      experience: predictionBreakdown(
        baselinePredictions, contractPredictions, experienceBucket
      ),
      expectedRole: predictionBreakdown(
        baselinePredictions, contractPredictions, (row) => row.expectedRole
      ),
    },
    interpretation:
      'This test estimates predictive value. It does not identify motivation or any other causal mechanism.',
    limitations: [
      'The nflverse contract source provides signing year, not an exact transaction date, so all same-year contracts are conservatively excluded.',
      'Historical contract corrections made after the fact may still exist in the current source snapshot.',
      'nflverse does not expose consistent historical fantasy draft-date roster snapshots. Season roster records define the evaluation population, while every model feature remains limited to information from prior seasons.',
      'Starter points and regret use a 10-team league-wide starter pool (1 QB, 2 RB, 2 WR, 1 TE, 2 FLEX per team), not a pick-by-pick room simulation.',
      'The backtest does not prove a motivational contract-year effect; it only tests incremental out-of-sample prediction.',
    ],
  };

  await mkdir(dirname(JSON_OUTPUT), { recursive: true });
  await mkdir(dirname(MARKDOWN_OUTPUT), { recursive: true });
  await writeFile(JSON_OUTPUT, `${JSON.stringify(report, null, 2)}\n`);

  const currentPolicyJson: unknown = JSON.parse(await readFile(POLICY_OUTPUT, 'utf8'));
  if (!isRecommendationPolicy(currentPolicyJson)) {
    throw new Error(`Recommendation policy is malformed: ${POLICY_OUTPUT}`);
  }
  const currentPolicy = currentPolicyJson;
  await writeFile(POLICY_OUTPUT, `${JSON.stringify({
    ...currentPolicy,
    generatedAt: report.generatedAt,
    contractSignalEnabled: false,
    contractSignalValidationPassed: releaseGate.passed,
    contractSignalModelVersion: report.modelVersion,
    contractSignalReason: decision,
  }, null, 2)}\n`);

  const seasonRows = report.seasons.map((season) =>
    `| ${String(season.season)} | ${String(season.baseline.observations)} | ` +
      `${formatMetric(season.baseline.mae)} | ${formatMetric(season.contract.mae)} | ` +
      `${formatMetric(season.maeDelta)} | ${season.winner} |`
  ).join('\n');
  const gateRows = Object.entries(report.releaseGate.checks).map(([check, passed]) =>
    `| ${check} | ${passed ? 'pass' : 'fail'} |`
  ).join('\n');
  const breakdownSections = Object.entries(report.breakdowns).map(([name, buckets]) => {
    const lines = Object.entries(buckets).map(([bucket, values]) =>
      `| ${bucket} | ${String(values.observations)} | ${String(values.contractYearObservations)} | ` +
        `${formatMetric(values.baselineMae)} | ${formatMetric(values.contractMae)} | ` +
        `${formatMetric(values.maeDelta)} |`
    ).join('\n');
    return `### ${name[0]?.toUpperCase() ?? ''}${name.slice(1)}\n\n` +
      '| Bucket | N | Contract years | Baseline MAE | Contract MAE | Delta |\n' +
      '| --- | ---: | ---: | ---: | ---: | ---: |\n' + lines;
  }).join('\n\n');

  await writeFile(MARKDOWN_OUTPUT, `# Contract-Year Backtest

Generated: ${report.generatedAt}

Provenance: command \`${report.provenance.command}\`; contract identifier \`${report.provenance.contractIdentifier}\`; prediction identifier \`${report.provenance.predictionIdentifier}\`; historical-input identifier \`${report.provenance.historicalInputIdentifier}\`.

This walk-forward ablation tests incremental predictive value. It does not
establish that motivation causes player performance.

## Promotion Gate

- Passed: **${String(report.releaseGate.passed)}**
- Decision: ${report.releaseGate.decision}
- Seasons with lower MAE: ${String(report.releaseGate.seasonsWithLowerMae)} / ${String(testSeasons.length)} (required ${String(report.releaseGate.seasonsRequired)})
- Contract-year player-seasons: ${String(report.coverage.evaluatedContractYears)}

| Gate check | Result |
| --- | --- |
${gateRows}

## Leakage Control

${report.evaluationDesign.contractCutoff}
${report.evaluationDesign.latestDealRule}

## Aggregate Comparison

| Metric | Baseline | Plus contract year | Delta |
| --- | ---: | ---: | ---: |
| MAE | ${formatMetric(aggregateBaseline.mae)} | ${formatMetric(aggregateContract.mae)} | ${formatMetric(report.aggregate.deltas.mae)} |
| RMSE | ${formatMetric(aggregateBaseline.rmse)} | ${formatMetric(aggregateContract.rmse)} | ${formatMetric(report.aggregate.deltas.rmse)} |
| VOR MAE | ${formatMetric(aggregateBaseline.vorMae)} | ${formatMetric(aggregateContract.vorMae)} | ${formatMetric(report.aggregate.deltas.vorMae)} |
| Top-24 accuracy | ${formatMetric(aggregateBaseline.top24Accuracy)} | ${formatMetric(aggregateContract.top24Accuracy)} | ${formatMetric(report.aggregate.deltas.top24Accuracy)} |
| Starter points | ${formatMetric(aggregateBaseline.starterPoints)} | ${formatMetric(aggregateContract.starterPoints)} | ${formatMetric(report.aggregate.deltas.starterPoints)} |
| Draft regret | ${formatMetric(aggregateBaseline.draftRegret)} | ${formatMetric(aggregateContract.draftRegret)} | ${formatMetric(report.aggregate.deltas.draftRegret)} |
| VOR captured | ${formatMetric(aggregateBaseline.vorCaptured)} | ${formatMetric(aggregateContract.vorCaptured)} | ${formatMetric(report.aggregate.deltas.vorCaptured)} |

Negative error/regret deltas are improvements; positive accuracy/points/VOR deltas are improvements.

## Walk-Forward Seasons

| Test season | N | Baseline MAE | Contract MAE | Delta | Winner |
| --- | ---: | ---: | ---: | ---: | --- |
${seasonRows}

## Breakdowns

${breakdownSections}

## Limitations

${report.limitations.map((limitation) => `- ${limitation}`).join('\n')}
`);

  console.log(`Contract-year backtest JSON written to ${JSON_OUTPUT}`);
  console.log(`Contract-year backtest Markdown written to ${MARKDOWN_OUTPUT}`);
  console.log(`Contract signal promotion gate: ${releaseGate.passed ? 'PASS' : 'FAIL'}`);
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    console.error('Contract-year backtest failed:', error);
    process.exit(1);
  });
}
