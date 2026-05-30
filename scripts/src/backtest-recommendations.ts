import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Position } from '@fantasy-draft/shared';
import {
  BACKTESTS_MODEL_DIR,
  DATA_DIR,
  REPO_ROOT,
  connectModelDb,
} from './model/duckdb.js';
import {
  calculateLeagueScoringAdjustment,
  getHistoricalLeagueScoringAdjustments,
} from './model/league-scoring.js';

const JSON_OUTPUT = join(BACKTESTS_MODEL_DIR, 'recommendation-backtest.json');
const MARKDOWN_OUTPUT = join(REPO_ROOT, 'docs', 'recommendation-backtest.md');
const OFFENSIVE_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const satisfies readonly Position[];
const REPLACEMENT_POSITION_RANKS: Record<(typeof OFFENSIVE_POSITIONS)[number], number> = {
  QB: 12,
  RB: 30,
  WR: 30,
  TE: 14,
};

interface LeaguePick {
  readonly pickNo: number;
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly isUserPick: boolean;
  readonly isKeeper: boolean;
}

interface LeagueSeason {
  readonly season: number;
  readonly picks: readonly LeaguePick[];
}

interface LeagueHistory {
  readonly seasons: readonly LeagueSeason[];
}

interface TrainingRow {
  readonly season: number;
  readonly sleeper_player_id: string | null;
  readonly gsis_id: string | null;
  readonly player_name: string;
  readonly position: Position;
  readonly games: number;
  readonly actual_points: number;
  readonly rush_attempts: number;
  readonly receptions: number;
  readonly predraft_ecr: number | null;
  readonly trailing_points_per_game_3yr: number | null;
  readonly trailing_expected_points_per_game_3yr: number | null;
}

interface PlayerSeason extends TrainingRow {
  readonly sleeper_player_id: string;
  readonly leagueActualPoints: number;
  readonly leagueActualVor: number;
  readonly customPositionRank: number;
  readonly transparentModelScore: number;
}

interface StrategyMetrics {
  readonly evaluatedPicks: number;
  readonly vorCaptured: number;
  readonly averageRegret: number;
  readonly top24PositionHitRate: number;
}

interface PickEvaluation {
  readonly season: number;
  readonly pickNo: number;
  readonly actualPick: string;
  readonly actualPosition: Position;
  readonly ecrPick: string | null;
  readonly modelPick: string | null;
  readonly bestActualPick: string | null;
}

function isOffensivePosition(position: Position): position is keyof typeof REPLACEMENT_POSITION_RANKS {
  return OFFENSIVE_POSITIONS.includes(position as (typeof OFFENSIVE_POSITIONS)[number]);
}

function round(value: number, digits: number = 2): number {
  return Number(value.toFixed(digits));
}

function asNumber(value: number | bigint | null | undefined): number {
  return Number(value ?? 0);
}

function getPriorUsage(
  row: TrainingRow,
  rows: readonly TrainingRow[]
): { rushAttemptsPerGame: number; receptionsPerGame: number } {
  const priorRows = rows
    .filter(
      (candidate) =>
        candidate.season < row.season &&
        candidate.season >= row.season - 3 &&
        candidate.gsis_id &&
        candidate.gsis_id === row.gsis_id &&
        candidate.games > 0
    );
  if (priorRows.length === 0) {
    return { rushAttemptsPerGame: 0, receptionsPerGame: 0 };
  }

  return {
    rushAttemptsPerGame:
      priorRows.reduce((sum, candidate) => sum + candidate.rush_attempts / candidate.games, 0) /
      priorRows.length,
    receptionsPerGame:
      priorRows.reduce((sum, candidate) => sum + candidate.receptions / candidate.games, 0) /
      priorRows.length,
  };
}

function addDerivedValues(rows: readonly TrainingRow[]): PlayerSeason[] {
  const eligible = rows.filter(
    (row): row is TrainingRow & { sleeper_player_id: string } =>
      Boolean(row.sleeper_player_id) &&
      isOffensivePosition(row.position) &&
      Number.isFinite(row.predraft_ecr) &&
      asNumber(row.predraft_ecr) <= 250
  );
  const baseRows = eligible.map((row) => {
    const scoringRules = getHistoricalLeagueScoringAdjustments(row.season);
    const leagueActualPoints =
      row.actual_points +
      calculateLeagueScoringAdjustment({
        position: row.position,
        rushAttempts: row.rush_attempts,
        receptions: row.receptions,
      }, scoringRules);
    const usage = getPriorUsage(row, rows);
    const estimatedCustomBonus = calculateLeagueScoringAdjustment({
      position: row.position,
      rushAttempts: usage.rushAttemptsPerGame * 17,
      receptions: usage.receptionsPerGame * 17,
    }, scoringRules);
    const transparentModelScore =
      300 - asNumber(row.predraft_ecr) +
      asNumber(row.trailing_expected_points_per_game_3yr) * 0.8 +
      asNumber(row.trailing_points_per_game_3yr) * 0.4 +
      estimatedCustomBonus * 0.2;

    return {
      ...row,
      sleeper_player_id: row.sleeper_player_id,
      leagueActualPoints,
      leagueActualVor: 0,
      customPositionRank: 0,
      transparentModelScore,
    };
  });

  return baseRows.map((row) => {
    const positionRows = baseRows
      .filter((candidate) => candidate.season === row.season && candidate.position === row.position)
      .sort((a, b) => b.leagueActualPoints - a.leagueActualPoints);
    const customPositionRank =
      positionRows.findIndex((candidate) => candidate.sleeper_player_id === row.sleeper_player_id) + 1;
    const replacementIndex =
      REPLACEMENT_POSITION_RANKS[row.position as keyof typeof REPLACEMENT_POSITION_RANKS] - 1;
    const replacementPoints = positionRows[replacementIndex]?.leagueActualPoints ?? 0;

    return {
      ...row,
      customPositionRank,
      leagueActualVor: row.leagueActualPoints - replacementPoints,
    };
  });
}

function summarize(rows: readonly PlayerSeason[]): StrategyMetrics {
  if (rows.length === 0) {
    return {
      evaluatedPicks: 0,
      vorCaptured: 0,
      averageRegret: 0,
      top24PositionHitRate: 0,
    };
  }

  return {
    evaluatedPicks: rows.length,
    vorCaptured: round(rows.reduce((sum, row) => sum + row.leagueActualVor, 0)),
    averageRegret: 0,
    top24PositionHitRate: round(
      rows.filter((row) => row.customPositionRank <= 24).length / rows.length
    ),
  };
}

function withAverageRegret(
  metrics: StrategyMetrics,
  regrets: readonly number[]
): StrategyMetrics {
  return {
    ...metrics,
    averageRegret: round(
      regrets.reduce((sum, regret) => sum + regret, 0) / Math.max(1, regrets.length)
    ),
  };
}

async function main(): Promise<void> {
  const history = JSON.parse(
    await readFile(join(DATA_DIR, 'league-history', 'leagueDraftHistory.json'), 'utf8')
  ) as LeagueHistory;
  const connection = await connectModelDb();

  try {
    const reader = await connection.runAndReadAll(`
      select *
      from (
        select
          season::integer as season,
          sleeper_player_id::varchar as sleeper_player_id,
          gsis_id::varchar as gsis_id,
          player_name::varchar as player_name,
          position::varchar as position,
          games::double as games,
          actual_points::double as actual_points,
          rush_attempts::double as rush_attempts,
          receptions::double as receptions,
          predraft_ecr::double as predraft_ecr,
          trailing_points_per_game_3yr::double as trailing_points_per_game_3yr,
          trailing_expected_points_per_game_3yr::double as trailing_expected_points_per_game_3yr,
          row_number() over (
            partition by season, sleeper_player_id, position
            order by
              case when ranking_type = 'redraft-overall' then 0 else 1 end,
              predraft_ecr asc nulls last
          ) as row_number
        from model.prediction_training_dataset
      )
      where row_number = 1
    `);
    const rawRows = (reader.getRowObjects() as unknown as TrainingRow[]).map((row) => ({
      ...row,
      games: asNumber(row.games),
      actual_points: asNumber(row.actual_points),
      rush_attempts: asNumber(row.rush_attempts),
      receptions: asNumber(row.receptions),
      predraft_ecr: row.predraft_ecr === null ? null : asNumber(row.predraft_ecr),
      trailing_points_per_game_3yr:
        row.trailing_points_per_game_3yr === null
          ? null
          : asNumber(row.trailing_points_per_game_3yr),
      trailing_expected_points_per_game_3yr:
        row.trailing_expected_points_per_game_3yr === null
          ? null
          : asNumber(row.trailing_expected_points_per_game_3yr),
    }));
    const playerSeasons = addDerivedValues(rawRows);
    const evaluations: PickEvaluation[] = [];
    const actualRows: PlayerSeason[] = [];
    const ecrRows: PlayerSeason[] = [];
    const modelRows: PlayerSeason[] = [];
    const actualRegrets: number[] = [];
    const ecrRegrets: number[] = [];
    const modelRegrets: number[] = [];

    for (const season of history.seasons) {
      const seasonRows = playerSeasons.filter((row) => row.season === season.season);
      const byPlayerId = new Map(seasonRows.map((row) => [row.sleeper_player_id, row]));
      const actualDrafted = new Set<string>();
      const ecrSelected = new Set<string>();
      const modelSelected = new Set<string>();

      for (const pick of [...season.picks].sort((a, b) => a.pickNo - b.pickNo)) {
        const chosenRow = byPlayerId.get(pick.playerId);

        if (pick.isUserPick && !pick.isKeeper && chosenRow && isOffensivePosition(pick.position)) {
          const available = seasonRows.filter((row) => !actualDrafted.has(row.sleeper_player_id));
          const bestActual = [...available].sort((a, b) => b.leagueActualVor - a.leagueActualVor)[0];
          const ecrPick = available
            .filter((row) => !ecrSelected.has(row.sleeper_player_id))
            .sort((a, b) => asNumber(a.predraft_ecr) - asNumber(b.predraft_ecr))[0];
          const modelPick = available
            .filter((row) => !modelSelected.has(row.sleeper_player_id))
            .sort((a, b) => b.transparentModelScore - a.transparentModelScore)[0];

          actualRows.push(chosenRow);
          if (ecrPick) {
            ecrRows.push(ecrPick);
            ecrSelected.add(ecrPick.sleeper_player_id);
          }
          if (modelPick) {
            modelRows.push(modelPick);
            modelSelected.add(modelPick.sleeper_player_id);
          }

          const bestVor = bestActual?.leagueActualVor ?? 0;
          actualRegrets.push(Math.max(0, bestVor - chosenRow.leagueActualVor));
          if (ecrPick) ecrRegrets.push(Math.max(0, bestVor - ecrPick.leagueActualVor));
          if (modelPick) modelRegrets.push(Math.max(0, bestVor - modelPick.leagueActualVor));
          evaluations.push({
            season: season.season,
            pickNo: pick.pickNo,
            actualPick: pick.playerName,
            actualPosition: pick.position,
            ecrPick: ecrPick?.player_name ?? null,
            modelPick: modelPick?.player_name ?? null,
            bestActualPick: bestActual?.player_name ?? null,
          });
        }

        actualDrafted.add(pick.playerId);
      }
    }

    const report = {
      generatedAt: new Date().toISOString(),
      modelVersion: 'transparent-pre-draft-baseline-v1',
      scoring: {
        note: 'Each historical season uses the league scoring rules active in that season.',
        seasons: {
          2022: getHistoricalLeagueScoringAdjustments(2022),
          2023: getHistoricalLeagueScoringAdjustments(2023),
          2024: getHistoricalLeagueScoringAdjustments(2024),
          2025: getHistoricalLeagueScoringAdjustments(2025),
        },
      },
      coverage: {
        evaluatedUserPicks: evaluations.length,
        totalHistoricalUserPicks: history.seasons.reduce(
          (count, season) => count + season.picks.filter((pick) => pick.isUserPick && !pick.isKeeper).length,
          0
        ),
      },
      strategies: {
        actualUserDraft: withAverageRegret(summarize(actualRows), actualRegrets),
        ecrOnly: withAverageRegret(summarize(ecrRows), ecrRegrets),
        transparentModelV1: withAverageRegret(summarize(modelRows), modelRegrets),
      },
      limitations: [
        'This is a transparent baseline, not a final claim that the live scorer wins.',
        'The replay excludes players already drafted in the real room and previously selected by each simulated strategy.',
        'The transparent model uses pre-draft ECR plus trailing production, expected points, and prior-usage scoring adjustments.',
        'Roster construction, keeper-aware tier removal, injuries known on the historical draft date, and manager-specific behavior are not replayed yet.',
      ],
      evaluations,
    };

    await mkdir(dirname(JSON_OUTPUT), { recursive: true });
    await mkdir(dirname(MARKDOWN_OUTPUT), { recursive: true });
    await writeFile(JSON_OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(
      MARKDOWN_OUTPUT,
      `# Recommendation Backtest

Generated: ${report.generatedAt}

This is the first transparent replay baseline. It is deliberately limited and
does not claim that the live recommendation scorer is fully validated.

## Coverage

- Evaluated user picks: ${String(report.coverage.evaluatedUserPicks)}
- Historical non-keeper user picks: ${String(report.coverage.totalHistoricalUserPicks)}

## Strategy Comparison

| Strategy | Picks | VOR captured | Average regret | Top-24 position hit rate |
| --- | ---: | ---: | ---: | ---: |
| Actual user draft | ${String(report.strategies.actualUserDraft.evaluatedPicks)} | ${String(report.strategies.actualUserDraft.vorCaptured)} | ${String(report.strategies.actualUserDraft.averageRegret)} | ${String(report.strategies.actualUserDraft.top24PositionHitRate)} |
| ECR only | ${String(report.strategies.ecrOnly.evaluatedPicks)} | ${String(report.strategies.ecrOnly.vorCaptured)} | ${String(report.strategies.ecrOnly.averageRegret)} | ${String(report.strategies.ecrOnly.top24PositionHitRate)} |
| Transparent model V1 | ${String(report.strategies.transparentModelV1.evaluatedPicks)} | ${String(report.strategies.transparentModelV1.vorCaptured)} | ${String(report.strategies.transparentModelV1.averageRegret)} | ${String(report.strategies.transparentModelV1.top24PositionHitRate)} |

## Limitations

${report.limitations.map((limitation) => `- ${limitation}`).join('\n')}
`
    );

    console.log(`Recommendation backtest JSON written to ${JSON_OUTPUT}`);
    console.log(`Recommendation backtest Markdown written to ${MARKDOWN_OUTPUT}`);
  } finally {
    connection.closeSync();
  }
}

main().catch((error: unknown) => {
  console.error('Recommendation backtest failed:', error);
  process.exit(1);
});
