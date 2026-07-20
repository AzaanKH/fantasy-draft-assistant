import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
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
const POLICY_OUTPUT = join(DATA_DIR, 'recommendation-policy.json');
const OFFENSIVE_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const satisfies readonly Position[];
type OffensivePosition = (typeof OFFENSIVE_POSITIONS)[number];

const REPLACEMENT_POSITION_RANKS: Record<OffensivePosition, number> = {
  QB: 12,
  RB: 30,
  WR: 30,
  TE: 14,
};
const POSITION_MAXIMUMS: Record<OffensivePosition, number> = {
  QB: 4,
  RB: 8,
  WR: 8,
  TE: 3,
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
  readonly rosterPositions: readonly string[];
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
  readonly trailing_offense_snap_share_3yr: number | null;
  readonly trailing_completion_percentage_above_expectation_3yr: number | null;
  readonly trailing_avg_separation_3yr: number | null;
  readonly trailing_avg_yac_above_expectation_3yr: number | null;
  readonly trailing_rush_yards_over_expected_per_attempt_3yr: number | null;
  readonly trailing_rush_pct_over_expected_3yr: number | null;
}

interface PlayerSeason extends TrainingRow {
  readonly sleeper_player_id: string;
  readonly position: OffensivePosition;
  readonly leagueActualPoints: number;
  readonly leagueActualVor: number;
  readonly customPositionRank: number;
  readonly baselineModelScore: number;
  readonly transparentModelScore: number;
}

interface OffensiveRoster {
  readonly QB: PlayerSeason[];
  readonly RB: PlayerSeason[];
  readonly WR: PlayerSeason[];
  readonly TE: PlayerSeason[];
}

interface RosterRules {
  readonly fixedStarters: Record<OffensivePosition, number>;
  readonly flexStarters: number;
  readonly totalOffensiveSlots: number;
}

interface StrategyMetrics {
  readonly evaluatedPicks: number;
  readonly vorCaptured: number;
  readonly starterPoints: number;
  readonly averageRegret: number;
  readonly top24PositionHitRate: number;
}

interface PickEvaluation {
  readonly season: number;
  readonly trainingSeasons: readonly number[];
  readonly pickNo: number;
  readonly actualPick: string;
  readonly actualPosition: Position;
  readonly ecrPick: string | null;
  readonly modelPick: string | null;
  readonly bestActualPick: string | null;
  readonly ecrRosterBefore: string;
  readonly modelRosterBefore: string;
}

interface StrategyAccumulator {
  readonly rows: PlayerSeason[];
  readonly regrets: number[];
  readonly roster: OffensiveRoster;
}

function isOffensivePosition(position: Position): position is OffensivePosition {
  return OFFENSIVE_POSITIONS.includes(position as OffensivePosition);
}

function round(value: number, digits: number = 2): number {
  return Number(value.toFixed(digits));
}

function asNumber(value: number | bigint | null | undefined): number {
  return Number(value ?? 0);
}

function createRoster(): OffensiveRoster {
  return { QB: [], RB: [], WR: [], TE: [] };
}

function addToRoster(roster: OffensiveRoster, player: PlayerSeason): void {
  roster[player.position].push(player);
}

function rosterLabel(roster: OffensiveRoster): string {
  return OFFENSIVE_POSITIONS.map((position) => `${position}${String(roster[position].length)}`).join(' ');
}

function deriveRosterRules(rosterPositions: readonly string[]): RosterRules {
  const fixedStarters: Record<OffensivePosition, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const position of OFFENSIVE_POSITIONS) {
    fixedStarters[position] = rosterPositions.filter((slot) => slot === position).length;
  }
  const flexStarters = rosterPositions.filter((slot) => slot === 'FLEX').length;
  return {
    fixedStarters,
    flexStarters,
    totalOffensiveSlots:
      Object.values(fixedStarters).reduce((sum, count) => sum + count, 0) +
      flexStarters +
      rosterPositions.filter((slot) => slot === 'BN').length,
  };
}

function missingRequiredSlots(roster: OffensiveRoster, rules: RosterRules): number {
  const missingFixed = OFFENSIVE_POSITIONS.reduce(
    (sum, position) => sum + Math.max(0, rules.fixedStarters[position] - roster[position].length),
    0
  );
  const flexEligibleCount = roster.RB.length + roster.WR.length + roster.TE.length;
  const fixedFlexBase = rules.fixedStarters.RB + rules.fixedStarters.WR + rules.fixedStarters.TE;
  const filledFlex = Math.min(rules.flexStarters, Math.max(0, flexEligibleCount - fixedFlexBase));
  return missingFixed + Math.max(0, rules.flexStarters - filledFlex);
}

function cloneRosterWith(roster: OffensiveRoster, candidate: PlayerSeason): OffensiveRoster {
  return {
    QB: [...roster.QB, ...(candidate.position === 'QB' ? [candidate] : [])],
    RB: [...roster.RB, ...(candidate.position === 'RB' ? [candidate] : [])],
    WR: [...roster.WR, ...(candidate.position === 'WR' ? [candidate] : [])],
    TE: [...roster.TE, ...(candidate.position === 'TE' ? [candidate] : [])],
  };
}

function isLegalCandidate(
  candidate: PlayerSeason,
  roster: OffensiveRoster,
  rules: RosterRules,
  remainingPicksIncludingCurrent: number
): boolean {
  const currentCount = OFFENSIVE_POSITIONS.reduce(
    (sum, position) => sum + roster[position].length,
    0
  );
  if (currentCount >= rules.totalOffensiveSlots) return false;
  if (roster[candidate.position].length >= POSITION_MAXIMUMS[candidate.position]) return false;

  const after = cloneRosterWith(roster, candidate);
  return missingRequiredSlots(after, rules) <= Math.max(0, remainingPicksIncludingCurrent - 1);
}

function modelRosterAdjustment(
  candidate: PlayerSeason,
  roster: OffensiveRoster,
  rules: RosterRules
): number {
  const fixedNeed = roster[candidate.position].length < rules.fixedStarters[candidate.position];
  const flexEligible = candidate.position === 'RB' || candidate.position === 'WR' || candidate.position === 'TE';
  const flexEligibleCount = roster.RB.length + roster.WR.length + roster.TE.length;
  const flexTarget = rules.fixedStarters.RB + rules.fixedStarters.WR + rules.fixedStarters.TE + rules.flexStarters;
  const flexNeed = flexEligible && flexEligibleCount < flexTarget;
  const redundantSingleStarter =
    (candidate.position === 'QB' || candidate.position === 'TE') &&
    roster[candidate.position].length >= Math.max(1, rules.fixedStarters[candidate.position]);

  return (fixedNeed ? 34 : 0) + (flexNeed ? 12 : 0) - (redundantSingleStarter ? 22 : 0);
}

function chooseEcr(
  available: readonly PlayerSeason[],
  roster: OffensiveRoster,
  rules: RosterRules,
  remainingPicks: number
): PlayerSeason | undefined {
  return [...available]
    .filter((candidate) => isLegalCandidate(candidate, roster, rules, remainingPicks))
    .sort((a, b) => asNumber(a.predraft_ecr) - asNumber(b.predraft_ecr))[0];
}

function chooseModel(
  available: readonly PlayerSeason[],
  roster: OffensiveRoster,
  rules: RosterRules,
  remainingPicks: number
): PlayerSeason | undefined {
  return [...available]
    .filter((candidate) => isLegalCandidate(candidate, roster, rules, remainingPicks))
    .sort((a, b) =>
      (b.transparentModelScore + modelRosterAdjustment(b, roster, rules)) -
        (a.transparentModelScore + modelRosterAdjustment(a, roster, rules)) ||
      asNumber(a.predraft_ecr) - asNumber(b.predraft_ecr)
    )[0];
}

function chooseBaselineModel(
  available: readonly PlayerSeason[],
  roster: OffensiveRoster,
  rules: RosterRules,
  remainingPicks: number
): PlayerSeason | undefined {
  return [...available]
    .filter((candidate) => isLegalCandidate(candidate, roster, rules, remainingPicks))
    .sort((a, b) =>
      (b.baselineModelScore + modelRosterAdjustment(b, roster, rules)) -
        (a.baselineModelScore + modelRosterAdjustment(a, roster, rules)) ||
      asNumber(a.predraft_ecr) - asNumber(b.predraft_ecr)
    )[0];
}

function getUsageEfficiencyFeatureScore(row: TrainingRow): number {
  const snapBaseline: Record<OffensivePosition, number> = {
    QB: 0.80,
    RB: 0.38,
    WR: 0.51,
    TE: 0.45,
  };
  const snapScore = row.trailing_offense_snap_share_3yr === null
    ? 0
    : (row.trailing_offense_snap_share_3yr - snapBaseline[row.position as OffensivePosition]) * 20;
  let efficiencyScore = 0;
  if (row.position === 'QB') {
    efficiencyScore = asNumber(row.trailing_completion_percentage_above_expectation_3yr) * 0.2;
  } else if (row.position === 'WR' || row.position === 'TE') {
    const separationBaseline = row.position === 'TE' ? 3.42 : 2.84;
    efficiencyScore = row.trailing_avg_separation_3yr === null
      ? 0
      : (row.trailing_avg_separation_3yr - separationBaseline) * 2;
    efficiencyScore += asNumber(row.trailing_avg_yac_above_expectation_3yr) * 0.8;
  } else if (row.position === 'RB') {
    efficiencyScore =
      asNumber(row.trailing_rush_yards_over_expected_per_attempt_3yr) * 2 +
      asNumber(row.trailing_rush_pct_over_expected_3yr) * 2;
  }
  return Math.max(-15, Math.min(15, snapScore + efficiencyScore));
}

function getPriorUsage(
  row: TrainingRow,
  rows: readonly TrainingRow[]
): { rushAttemptsPerGame: number; receptionsPerGame: number } {
  const priorRows = rows.filter(
    (candidate) =>
      candidate.season < row.season &&
      candidate.season >= row.season - 3 &&
      candidate.gsis_id &&
      candidate.gsis_id === row.gsis_id &&
      candidate.games > 0
  );
  if (priorRows.length === 0) return { rushAttemptsPerGame: 0, receptionsPerGame: 0 };

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
    (row): row is TrainingRow & { sleeper_player_id: string; position: OffensivePosition } =>
      Boolean(row.sleeper_player_id) &&
      isOffensivePosition(row.position) &&
      Number.isFinite(row.predraft_ecr) &&
      asNumber(row.predraft_ecr) <= 250
  );
  const baseRows: PlayerSeason[] = eligible.map((row) => {
    const scoringRules = getHistoricalLeagueScoringAdjustments(row.season);
    const leagueActualPoints = row.actual_points + calculateLeagueScoringAdjustment({
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
    const baselineModelScore =
      300 - asNumber(row.predraft_ecr) +
      asNumber(row.trailing_expected_points_per_game_3yr) * 0.8 +
      asNumber(row.trailing_points_per_game_3yr) * 0.4 +
      estimatedCustomBonus * 0.2;
    return {
      ...row,
      sleeper_player_id: row.sleeper_player_id,
      position: row.position,
      leagueActualPoints,
      leagueActualVor: 0,
      customPositionRank: 0,
      baselineModelScore,
      transparentModelScore: baselineModelScore + getUsageEfficiencyFeatureScore(row),
    };
  });

  return baseRows.map((row) => {
    const positionRows = baseRows
      .filter((candidate) => candidate.season === row.season && candidate.position === row.position)
      .sort((a, b) => b.leagueActualPoints - a.leagueActualPoints);
    const customPositionRank =
      positionRows.findIndex((candidate) => candidate.sleeper_player_id === row.sleeper_player_id) + 1;
    const replacementPoints =
      positionRows[REPLACEMENT_POSITION_RANKS[row.position] - 1]?.leagueActualPoints ?? 0;
    return {
      ...row,
      customPositionRank,
      leagueActualVor: row.leagueActualPoints - replacementPoints,
    };
  });
}

function calculateStarterPoints(roster: OffensiveRoster, rules: RosterRules): number {
  const used = new Set<string>();
  let points = 0;
  for (const position of OFFENSIVE_POSITIONS) {
    const starters = [...roster[position]]
      .sort((a, b) => b.leagueActualPoints - a.leagueActualPoints)
      .slice(0, rules.fixedStarters[position]);
    for (const player of starters) {
      used.add(player.sleeper_player_id);
      points += player.leagueActualPoints;
    }
  }
  const flex = [...roster.RB, ...roster.WR, ...roster.TE]
    .filter((player) => !used.has(player.sleeper_player_id))
    .sort((a, b) => b.leagueActualPoints - a.leagueActualPoints)
    .slice(0, rules.flexStarters);
  return round(points + flex.reduce((sum, player) => sum + player.leagueActualPoints, 0));
}

function summarize(
  rows: readonly PlayerSeason[],
  regrets: readonly number[],
  starterPoints: number
): StrategyMetrics {
  return {
    evaluatedPicks: rows.length,
    vorCaptured: round(rows.reduce((sum, row) => sum + row.leagueActualVor, 0)),
    starterPoints,
    averageRegret: round(
      regrets.reduce((sum, regret) => sum + regret, 0) / Math.max(1, regrets.length)
    ),
    top24PositionHitRate: round(
      rows.filter((row) => row.customPositionRank <= 24).length / Math.max(1, rows.length)
    ),
  };
}

function aggregate(metrics: readonly StrategyMetrics[]): StrategyMetrics {
  const picks = metrics.reduce((sum, metric) => sum + metric.evaluatedPicks, 0);
  return {
    evaluatedPicks: picks,
    vorCaptured: round(metrics.reduce((sum, metric) => sum + metric.vorCaptured, 0)),
    starterPoints: round(metrics.reduce((sum, metric) => sum + metric.starterPoints, 0)),
    averageRegret: round(
      metrics.reduce((sum, metric) => sum + metric.averageRegret * metric.evaluatedPicks, 0) /
        Math.max(1, picks)
    ),
    top24PositionHitRate: round(
      metrics.reduce((sum, metric) => sum + metric.top24PositionHitRate * metric.evaluatedPicks, 0) /
        Math.max(1, picks)
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
      select * from (
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
          trailing_offense_snap_share_3yr::double as trailing_offense_snap_share_3yr,
          trailing_completion_percentage_above_expectation_3yr::double
            as trailing_completion_percentage_above_expectation_3yr,
          trailing_avg_separation_3yr::double as trailing_avg_separation_3yr,
          trailing_avg_yac_above_expectation_3yr::double
            as trailing_avg_yac_above_expectation_3yr,
          trailing_rush_yards_over_expected_per_attempt_3yr::double
            as trailing_rush_yards_over_expected_per_attempt_3yr,
          trailing_rush_pct_over_expected_3yr::double as trailing_rush_pct_over_expected_3yr,
          row_number() over (
            partition by season, sleeper_player_id, position
            order by case when ranking_type = 'redraft-overall' then 0 else 1 end,
              predraft_ecr asc nulls last
          ) as row_number
        from model.prediction_training_dataset
      ) where row_number = 1
    `);
    const rawRows = (reader.getRowObjects() as unknown as TrainingRow[]).map((row) => ({
      ...row,
      games: asNumber(row.games),
      actual_points: asNumber(row.actual_points),
      rush_attempts: asNumber(row.rush_attempts),
      receptions: asNumber(row.receptions),
      predraft_ecr: row.predraft_ecr === null ? null : asNumber(row.predraft_ecr),
      trailing_points_per_game_3yr: row.trailing_points_per_game_3yr === null
        ? null : asNumber(row.trailing_points_per_game_3yr),
      trailing_expected_points_per_game_3yr: row.trailing_expected_points_per_game_3yr === null
        ? null : asNumber(row.trailing_expected_points_per_game_3yr),
      trailing_offense_snap_share_3yr: row.trailing_offense_snap_share_3yr === null
        ? null : asNumber(row.trailing_offense_snap_share_3yr),
      trailing_completion_percentage_above_expectation_3yr:
        row.trailing_completion_percentage_above_expectation_3yr === null
          ? null : asNumber(row.trailing_completion_percentage_above_expectation_3yr),
      trailing_avg_separation_3yr: row.trailing_avg_separation_3yr === null
        ? null : asNumber(row.trailing_avg_separation_3yr),
      trailing_avg_yac_above_expectation_3yr: row.trailing_avg_yac_above_expectation_3yr === null
        ? null : asNumber(row.trailing_avg_yac_above_expectation_3yr),
      trailing_rush_yards_over_expected_per_attempt_3yr:
        row.trailing_rush_yards_over_expected_per_attempt_3yr === null
          ? null : asNumber(row.trailing_rush_yards_over_expected_per_attempt_3yr),
      trailing_rush_pct_over_expected_3yr: row.trailing_rush_pct_over_expected_3yr === null
        ? null : asNumber(row.trailing_rush_pct_over_expected_3yr),
    }));
    const playerSeasons = addDerivedValues(rawRows);
    const evaluations: PickEvaluation[] = [];
    const seasonReports: Array<{
      season: number;
      trainingSeasons: readonly number[];
      strategies: {
        actualUserDraft: StrategyMetrics;
        rosterAwareEcr: StrategyMetrics;
        rosterAwareBaselineModel: StrategyMetrics;
        rosterAwareModel: StrategyMetrics;
      };
      winner: 'model' | 'ecr' | 'tie';
    }> = [];

    const sortedHistory = [...history.seasons].sort((a, b) => a.season - b.season);
    for (const season of sortedHistory) {
      const trainingSeasons = sortedHistory
        .filter((candidate) => candidate.season < season.season)
        .map((candidate) => candidate.season);
      const rules = deriveRosterRules(season.rosterPositions);
      const seasonRows = playerSeasons.filter((row) => row.season === season.season);
      const byPlayerId = new Map(seasonRows.map((row) => [row.sleeper_player_id, row]));
      const keepers = season.picks.filter((pick) => pick.isKeeper);
      const roomDrafted = new Set(keepers.map((pick) => pick.playerId));
      const actualDrafted = new Set(keepers.map((pick) => pick.playerId));
      const ecrSelected = new Set<string>();
      const baselineSelected = new Set<string>();
      const modelSelected = new Set<string>();
      const actual: StrategyAccumulator = { rows: [], regrets: [], roster: createRoster() };
      const ecr: StrategyAccumulator = { rows: [], regrets: [], roster: createRoster() };
      const baseline: StrategyAccumulator = { rows: [], regrets: [], roster: createRoster() };
      const model: StrategyAccumulator = { rows: [], regrets: [], roster: createRoster() };

      for (const keeper of keepers.filter((pick) => pick.isUserPick)) {
        const row = byPlayerId.get(keeper.playerId);
        if (!row) continue;
        addToRoster(actual.roster, row);
        addToRoster(ecr.roster, row);
        addToRoster(baseline.roster, row);
        addToRoster(model.roster, row);
      }

      const sortedPicks = [...season.picks].sort((a, b) => a.pickNo - b.pickNo);
      for (let index = 0; index < sortedPicks.length; index += 1) {
        const pick = sortedPicks[index];
        if (!pick || pick.isKeeper) continue;
        const chosenRow = byPlayerId.get(pick.playerId);

        if (pick.isUserPick && chosenRow && isOffensivePosition(pick.position)) {
          const remainingPicks = sortedPicks.slice(index).filter((candidate) =>
            candidate.isUserPick && !candidate.isKeeper && byPlayerId.has(candidate.playerId)
          ).length;
          const actualAvailable = seasonRows.filter((row) => !actualDrafted.has(row.sleeper_player_id));
          const strategyAvailable = (selected: ReadonlySet<string>): PlayerSeason[] =>
            seasonRows.filter((row) =>
              !roomDrafted.has(row.sleeper_player_id) && !selected.has(row.sleeper_player_id)
            );
          const ecrAvailable = strategyAvailable(ecrSelected);
          const baselineAvailable = strategyAvailable(baselineSelected);
          const modelAvailable = strategyAvailable(modelSelected);
          const ecrRosterBefore = rosterLabel(ecr.roster);
          const modelRosterBefore = rosterLabel(model.roster);
          const ecrPick = chooseEcr(ecrAvailable, ecr.roster, rules, remainingPicks);
          const baselinePick = chooseBaselineModel(
            baselineAvailable,
            baseline.roster,
            rules,
            remainingPicks
          );
          const modelPick = chooseModel(modelAvailable, model.roster, rules, remainingPicks);
          const bestActual = [...actualAvailable].sort((a, b) => b.leagueActualVor - a.leagueActualVor)[0];
          const bestEcrBoard = [...ecrAvailable].sort((a, b) => b.leagueActualVor - a.leagueActualVor)[0];
          const bestBaselineBoard = [...baselineAvailable]
            .sort((a, b) => b.leagueActualVor - a.leagueActualVor)[0];
          const bestModelBoard = [...modelAvailable].sort((a, b) => b.leagueActualVor - a.leagueActualVor)[0];

          actual.rows.push(chosenRow);
          addToRoster(actual.roster, chosenRow);
          actual.regrets.push(Math.max(0, (bestActual?.leagueActualVor ?? 0) - chosenRow.leagueActualVor));
          if (ecrPick) {
            ecr.rows.push(ecrPick);
            ecrSelected.add(ecrPick.sleeper_player_id);
            addToRoster(ecr.roster, ecrPick);
            ecr.regrets.push(Math.max(0, (bestEcrBoard?.leagueActualVor ?? 0) - ecrPick.leagueActualVor));
          }
          if (modelPick) {
            model.rows.push(modelPick);
            modelSelected.add(modelPick.sleeper_player_id);
            addToRoster(model.roster, modelPick);
            model.regrets.push(Math.max(0, (bestModelBoard?.leagueActualVor ?? 0) - modelPick.leagueActualVor));
          }
          if (baselinePick) {
            baseline.rows.push(baselinePick);
            baselineSelected.add(baselinePick.sleeper_player_id);
            addToRoster(baseline.roster, baselinePick);
            baseline.regrets.push(
              Math.max(0, (bestBaselineBoard?.leagueActualVor ?? 0) - baselinePick.leagueActualVor)
            );
          }
          evaluations.push({
            season: season.season,
            trainingSeasons,
            pickNo: pick.pickNo,
            actualPick: pick.playerName,
            actualPosition: pick.position,
            ecrPick: ecrPick?.player_name ?? null,
            modelPick: modelPick?.player_name ?? null,
            bestActualPick: bestActual?.player_name ?? null,
            ecrRosterBefore,
            modelRosterBefore,
          });
        }

        actualDrafted.add(pick.playerId);
        if (!pick.isUserPick) roomDrafted.add(pick.playerId);
      }

      const actualMetrics = summarize(
        actual.rows,
        actual.regrets,
        calculateStarterPoints(actual.roster, rules)
      );
      const ecrMetrics = summarize(ecr.rows, ecr.regrets, calculateStarterPoints(ecr.roster, rules));
      const modelMetrics = summarize(
        model.rows,
        model.regrets,
        calculateStarterPoints(model.roster, rules)
      );
      const baselineMetrics = summarize(
        baseline.rows,
        baseline.regrets,
        calculateStarterPoints(baseline.roster, rules)
      );
      seasonReports.push({
        season: season.season,
        trainingSeasons,
        strategies: {
          actualUserDraft: actualMetrics,
          rosterAwareEcr: ecrMetrics,
          rosterAwareBaselineModel: baselineMetrics,
          rosterAwareModel: modelMetrics,
        },
        winner: modelMetrics.starterPoints > ecrMetrics.starterPoints
          ? 'model'
          : modelMetrics.starterPoints < ecrMetrics.starterPoints ? 'ecr' : 'tie',
      });
    }

    const strategies = {
      actualUserDraft: aggregate(seasonReports.map((season) => season.strategies.actualUserDraft)),
      rosterAwareEcr: aggregate(seasonReports.map((season) => season.strategies.rosterAwareEcr)),
      rosterAwareBaselineModel: aggregate(
        seasonReports.map((season) => season.strategies.rosterAwareBaselineModel)
      ),
      rosterAwareModel: aggregate(seasonReports.map((season) => season.strategies.rosterAwareModel)),
    };
    const seasonsWon = seasonReports.filter((season) => season.winner === 'model').length;
    const seasonsRequired = Math.ceil(seasonReports.length * 0.75);
    const worstStarterRegression = Math.min(...seasonReports.map((season) => {
      const ecrPoints = season.strategies.rosterAwareEcr.starterPoints;
      return ecrPoints === 0
        ? 0
        : (season.strategies.rosterAwareModel.starterPoints - ecrPoints) / ecrPoints;
    }));
    const releaseGateChecks = {
      aggregateStarterPointsBeatEcr:
        strategies.rosterAwareModel.starterPoints > strategies.rosterAwareEcr.starterPoints,
      aggregateVorBeatEcr:
        strategies.rosterAwareModel.vorCaptured > strategies.rosterAwareEcr.vorCaptured,
      averageRegretBeatEcr:
        strategies.rosterAwareModel.averageRegret < strategies.rosterAwareEcr.averageRegret,
      top24HitRateNonInferior:
        strategies.rosterAwareModel.top24PositionHitRate >=
        strategies.rosterAwareEcr.top24PositionHitRate - 0.02,
      seasonsWon: seasonsWon >= seasonsRequired,
      noSeasonStarterRegressionOver15Percent: worstStarterRegression >= -0.15,
    };
    const releaseGatePassed = Object.values(releaseGateChecks).every(Boolean);

    const report = {
      generatedAt: new Date().toISOString(),
      modelVersion: 'roster-aware-walk-forward-v3-snaps-ngs',
      evaluationDesign: {
        method: 'Season-by-season walk-forward replay with frozen model weights.',
        leakageControl:
          'Every evaluated season uses pre-draft ECR and trailing production, opportunity, snap-share, and Next Gen Stats features from earlier seasons only.',
        rosterControl:
          'Actual, ECR, and model strategies begin with historical user keepers and must satisfy that season’s roster slots and position limits.',
        boardControl:
          'Historical opponent picks remain fixed; each simulated strategy also removes its own prior selections.',
      },
      scoring: {
        note: 'Each historical season uses the league scoring rules active in that season.',
        seasons: Object.fromEntries(
          sortedHistory.map((season) => [season.season, getHistoricalLeagueScoringAdjustments(season.season)])
        ),
      },
      coverage: {
        evaluatedUserPicks: evaluations.length,
        totalHistoricalUserPicks: history.seasons.reduce(
          (count, season) => count + season.picks.filter((pick) => pick.isUserPick && !pick.isKeeper).length,
          0
        ),
        evaluatedSeasons: seasonReports.length,
      },
      releaseGate: {
        passed: releaseGatePassed,
        seasonsWon,
        seasonsRequired,
        worstStarterRegression: round(worstStarterRegression, 4),
        checks: releaseGateChecks,
        decision: releaseGatePassed
          ? 'Model clears the ECR comparison gate and may be promoted as a validated recommendation signal.'
          : 'Model does not clear the ECR comparison gate; keep it experimental and do not claim an edge.',
      },
      featureAblation: {
        baselineModel: 'Frozen v2 score without snap-share or Next Gen Stats.',
        expandedModel: 'Baseline plus capped trailing snap-share and position-specific NGS efficiency.',
        starterPointsDelta:
          round(strategies.rosterAwareModel.starterPoints -
            strategies.rosterAwareBaselineModel.starterPoints),
        vorDelta:
          round(strategies.rosterAwareModel.vorCaptured -
            strategies.rosterAwareBaselineModel.vorCaptured),
        averageRegretDelta:
          round(strategies.rosterAwareModel.averageRegret -
            strategies.rosterAwareBaselineModel.averageRegret),
        top24HitRateDelta:
          round(strategies.rosterAwareModel.top24PositionHitRate -
            strategies.rosterAwareBaselineModel.top24PositionHitRate),
      },
      strategies,
      seasons: seasonReports,
      limitations: [
        'Historical opponent picks are held fixed; the replay does not simulate replacement picks when a strategy takes a player an opponent selected later.',
        'The model weights are frozen and transparent rather than fitted inside each fold; walk-forward leakage control applies to its input features and evaluation.',
        'Injuries known on each historical draft date and manager-specific opponent behavior are not yet replayed.',
        'The sample contains only four seasons and should be treated as a product gate, not statistical proof of superiority.',
      ],
      evaluations,
    };

    await mkdir(dirname(JSON_OUTPUT), { recursive: true });
    await mkdir(dirname(MARKDOWN_OUTPUT), { recursive: true });
    await writeFile(JSON_OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(
      POLICY_OUTPUT,
      `${JSON.stringify({
        generatedAt: report.generatedAt,
        modelVersion: report.modelVersion,
        modelPredictionsEnabled: releaseGatePassed,
        contractSignalEnabled: false,
        fallback: releaseGatePassed ? 'model' : 'fantasypros-ecr-market',
        reason: report.releaseGate.decision,
      }, null, 2)}\n`
    );
    const seasonRows = report.seasons.map((season) =>
      `| ${String(season.season)} | ${season.trainingSeasons.join(', ') || 'none'} | ` +
      `${String(season.strategies.rosterAwareEcr.starterPoints)} | ` +
      `${String(season.strategies.rosterAwareBaselineModel.starterPoints)} | ` +
      `${String(season.strategies.rosterAwareModel.starterPoints)} | ${season.winner} |`
    ).join('\n');
    await writeFile(MARKDOWN_OUTPUT, `# Recommendation Backtest

Generated: ${report.generatedAt}

This replay is roster-aware and walk-forward. It is allowed to fail its ECR
release gate; a failed gate means the model remains experimental.

## Release Gate

- Passed: **${String(report.releaseGate.passed)}**
- Decision: ${report.releaseGate.decision}
- Seasons won: ${String(report.releaseGate.seasonsWon)} / ${String(report.coverage.evaluatedSeasons)} (required ${String(report.releaseGate.seasonsRequired)})

## Aggregate Strategy Comparison

| Strategy | Picks | VOR captured | Starter points | Average regret | Top-24 hit rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| Actual user draft | ${String(strategies.actualUserDraft.evaluatedPicks)} | ${String(strategies.actualUserDraft.vorCaptured)} | ${String(strategies.actualUserDraft.starterPoints)} | ${String(strategies.actualUserDraft.averageRegret)} | ${String(strategies.actualUserDraft.top24PositionHitRate)} |
| Roster-aware ECR | ${String(strategies.rosterAwareEcr.evaluatedPicks)} | ${String(strategies.rosterAwareEcr.vorCaptured)} | ${String(strategies.rosterAwareEcr.starterPoints)} | ${String(strategies.rosterAwareEcr.averageRegret)} | ${String(strategies.rosterAwareEcr.top24PositionHitRate)} |
| Baseline roster-aware model | ${String(strategies.rosterAwareBaselineModel.evaluatedPicks)} | ${String(strategies.rosterAwareBaselineModel.vorCaptured)} | ${String(strategies.rosterAwareBaselineModel.starterPoints)} | ${String(strategies.rosterAwareBaselineModel.averageRegret)} | ${String(strategies.rosterAwareBaselineModel.top24PositionHitRate)} |
| Roster-aware model | ${String(strategies.rosterAwareModel.evaluatedPicks)} | ${String(strategies.rosterAwareModel.vorCaptured)} | ${String(strategies.rosterAwareModel.starterPoints)} | ${String(strategies.rosterAwareModel.averageRegret)} | ${String(strategies.rosterAwareModel.top24PositionHitRate)} |

## Snap Share / NGS Ablation

- Starter points delta vs baseline: ${String(report.featureAblation.starterPointsDelta)}
- VOR delta vs baseline: ${String(report.featureAblation.vorDelta)}
- Average regret delta vs baseline: ${String(report.featureAblation.averageRegretDelta)}
- Top-24 hit-rate delta vs baseline: ${String(report.featureAblation.top24HitRateDelta)}

## Walk-Forward Folds

| Test season | Prior league seasons | ECR starter points | Baseline model | Expanded model | Winner |
| --- | --- | ---: | ---: | ---: | --- |
${seasonRows}

## Limitations

${report.limitations.map((limitation) => `- ${limitation}`).join('\n')}
`);

    console.log(`Recommendation backtest JSON written to ${JSON_OUTPUT}`);
    console.log(`Recommendation backtest Markdown written to ${MARKDOWN_OUTPUT}`);
    console.log(`ECR release gate: ${releaseGatePassed ? 'PASS' : 'FAIL'}`);
  } finally {
    connection.closeSync();
  }
}

export const backtestInternals = {
  createRoster,
  deriveRosterRules,
  missingRequiredSlots,
  isLegalCandidate,
  modelRosterAdjustment,
  calculateStarterPoints,
};

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    console.error('Recommendation backtest failed:', error);
    process.exit(1);
  });
}
