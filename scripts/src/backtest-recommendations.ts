import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PickEvLayers, Position, RosterRequirements } from '@fantasy-draft/shared';
import {
  PICK_EV_OVERRIDE_THRESHOLD,
  scorePickEvBoard,
  selectPickEvRecommendation,
} from '@fantasy-draft/shared';
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
import {
  POSITION_FEATURES,
  POSITION_MODEL_CANDIDATE_SET_VERSION,
  POSITION_MODEL_LAMBDA_CANDIDATES,
  POSITION_MODEL_SPECIFICATIONS,
  POSITION_MODEL_VOLUME_THRESHOLD_CANDIDATES,
  fitPositionResidualModel,
  fitPositionResidualModelForSeason,
  predictPositionResidual,
  type OffensivePosition,
  type PositionResidualRow,
} from './model/position-residual-model.js';
import {
  aggregateCounterfactualSeasons,
  simulateCounterfactualSeason,
  type CounterfactualDraftMetrics,
  type CounterfactualSeason,
  type CounterfactualSimulationSummary,
} from './counterfactual-draft-simulator.js';

const JSON_OUTPUT = join(BACKTESTS_MODEL_DIR, 'recommendation-backtest.json');
const MARKDOWN_OUTPUT = join(REPO_ROOT, 'docs', 'recommendation-backtest.md');
const COUNTERFACTUAL_JSON_OUTPUT = join(
  BACKTESTS_MODEL_DIR,
  'counterfactual-recommendation-backtest.json'
);
const COUNTERFACTUAL_MARKDOWN_OUTPUT = join(
  REPO_ROOT,
  'docs',
  'counterfactual-recommendation-backtest.md'
);
const POLICY_OUTPUT = join(DATA_DIR, 'recommendation-policy.json');
const OFFENSIVE_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const satisfies readonly Position[];
const OUTER_TEST_SEASONS = [2022, 2023, 2024, 2025] as const;
const RELEASE_SEASONS_REQUIRED = 3;
const DEFAULT_COUNTERFACTUAL_ITERATIONS = 1_000;
const DEFAULT_COUNTERFACTUAL_SEED = 20_260_720;

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
  readonly round: number;
  readonly rosterId: number;
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly isUserPick: boolean;
  readonly isKeeper: boolean;
}

interface LeagueSeason {
  readonly season: number;
  readonly rosterPositions: readonly string[];
  readonly rosterIdToOwner: Readonly<Record<string, string>>;
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
  readonly trailing_pass_attempts_per_game_3yr: number | null;
  readonly trailing_rush_attempts_per_game_3yr: number | null;
  readonly trailing_targets_per_game_3yr: number | null;
  readonly trailing_player_volume_3yr: number | null;
  readonly trailing_target_share_3yr: number | null;
  readonly trailing_air_yards_share_3yr: number | null;
  readonly trailing_offense_snap_share_3yr: number | null;
  readonly trailing_offense_snaps_per_game_3yr: number | null;
  readonly trailing_pressure_rate_3yr: number | null;
  readonly trailing_pressure_time_to_throw_3yr: number | null;
  readonly trailing_number_pass_rushers_3yr: number | null;
  readonly trailing_dropback_participation_per_game_3yr: number | null;
  readonly trailing_charted_route_targets_per_game_3yr: number | null;
  readonly trailing_targets_per_dropback_participation_3yr: number | null;
  readonly trailing_deep_route_target_share_3yr: number | null;
  readonly trailing_screen_route_target_share_3yr: number | null;
  readonly trailing_goal_line_carries_per_game_3yr: number | null;
  readonly trailing_goal_line_targets_per_game_3yr: number | null;
  readonly trailing_completion_percentage_above_expectation_3yr: number | null;
  readonly trailing_avg_time_to_throw_3yr: number | null;
  readonly trailing_avg_intended_air_yards_3yr: number | null;
  readonly trailing_avg_separation_3yr: number | null;
  readonly trailing_avg_yac_above_expectation_3yr: number | null;
  readonly trailing_expected_rush_points_per_game_3yr: number | null;
  readonly trailing_expected_tds_per_game_3yr: number | null;
  readonly trailing_rush_yards_over_expected_per_attempt_3yr: number | null;
  readonly trailing_rush_pct_over_expected_3yr: number | null;
  readonly history_seasons: number;
}

interface PlayerSeason extends TrainingRow {
  readonly sleeper_player_id: string;
  readonly position: OffensivePosition;
  readonly leagueActualPoints: number;
  readonly leagueActualVor: number;
  readonly customPositionRank: number;
  readonly baselineModelScore: number;
  readonly transparentModelScore: number;
  readonly baselineProjectedPoints?: number;
  readonly transparentProjectedPoints?: number;
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

interface PromotionSeasonMetrics {
  readonly strategies: {
    readonly rosterAwareEcr: StrategyMetrics;
    readonly rosterAwareBaselineModel: StrategyMetrics;
    readonly rosterAwareModel: StrategyMetrics;
  };
}

interface PromotionStrategyMetrics {
  readonly rosterAwareEcr: StrategyMetrics;
  readonly rosterAwareBaselineModel: StrategyMetrics;
  readonly rosterAwareModel: StrategyMetrics;
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

interface PositionModelSelectionSummary {
  readonly specificationId: string;
  readonly lambda: number;
  readonly volumeThreshold: number;
  readonly selectedWithTrainingSeasons: readonly number[];
  readonly innerValidationSeason: number | null;
  readonly refitThroughSeason: number | null;
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

function pickEvRequirements(rules: RosterRules): RosterRequirements {
  const fixedSlots = Object.values(rules.fixedStarters).reduce((sum, count) => sum + count, 0);
  return {
    QB: { starters: rules.fixedStarters.QB, max: POSITION_MAXIMUMS.QB },
    RB: { starters: rules.fixedStarters.RB, max: POSITION_MAXIMUMS.RB },
    WR: { starters: rules.fixedStarters.WR, max: POSITION_MAXIMUMS.WR },
    TE: { starters: rules.fixedStarters.TE, max: POSITION_MAXIMUMS.TE },
    FLEX: { starters: rules.flexStarters, eligiblePositions: ['RB', 'WR', 'TE'] },
    K: { starters: 0, max: 0 },
    DEF: { starters: 0, max: 0 },
    BENCH: { spots: Math.max(0, rules.totalOffensiveSlots - fixedSlots - rules.flexStarters) },
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

function rosterAdjustedModelScore(
  candidate: PlayerSeason,
  valueOverReplacement: number,
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

  const rosterAdjustedVor = redundantSingleStarter
    ? valueOverReplacement * (candidate.position === 'QB' ? 0.2 : 0.45)
    : valueOverReplacement;
  return rosterAdjustedVor + (fixedNeed ? 34 : 0) + (flexNeed ? 12 : 0);
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
      rosterAdjustedModelScore(b, b.transparentModelScore, roster, rules) -
        rosterAdjustedModelScore(a, a.transparentModelScore, roster, rules) ||
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
      rosterAdjustedModelScore(b, b.baselineModelScore, roster, rules) -
        rosterAdjustedModelScore(a, a.baselineModelScore, roster, rules) ||
      asNumber(a.predraft_ecr) - asNumber(b.predraft_ecr)
    )[0];
}

function estimateConditionalSurvival(
  marketRank: number,
  currentPick: number,
  nextPick: number
): number {
  const scale = marketRank <= 60 ? 7 : 11;
  const draftedByCurrent = 1 / (1 + Math.exp(-(currentPick - marketRank) / scale));
  const draftedByNext = 1 / (1 + Math.exp(-(nextPick - marketRank) / scale));
  return Math.max(
    0.03,
    Math.min(0.97, (1 - draftedByNext) / Math.max(0.05, 1 - draftedByCurrent))
  );
}

function choosePickEv(
  available: readonly PlayerSeason[],
  roster: OffensiveRoster,
  rules: RosterRules,
  remainingPicks: number,
  currentPick: number,
  nextPick: number,
  totalTeams: number,
  totalPicks: number,
  layers: PickEvLayers
): PlayerSeason | undefined {
  const legal = available.filter((candidate) =>
    isLegalCandidate(candidate, roster, rules, remainingPicks)
  );
  const pickEvPlayers = legal.map((candidate) => ({
    id: candidate.sleeper_player_id,
    position: candidate.position,
    ecrRank: asNumber(candidate.predraft_ecr),
    projectedPoints:
      candidate.baselineProjectedPoints ?? Math.max(0, candidate.baselineModelScore),
    marketRank: asNumber(candidate.predraft_ecr),
    nextPickSurvivalProbability: estimateConditionalSurvival(
      asNumber(candidate.predraft_ecr),
      currentPick,
      nextPick
    ),
    ceilingScore: Math.min(10, 5 + Math.max(0, 2 - candidate.history_seasons) * 1.5),
    uncertaintyScore: 3 + Math.max(0, 2 - candidate.history_seasons) * 0.8,
    injuryRiskScore: 2,
  }));
  const needs = OFFENSIVE_POSITIONS.map((position) => ({
    position,
    priority: roster[position].length < rules.fixedStarters[position]
      ? 'critical' as const
      : 'low' as const,
  }));
  const scores = scorePickEvBoard(pickEvPlayers, needs, {
    currentPick,
    totalPicks,
    totalTeams,
    requirements: pickEvRequirements(rules),
    rosterPlayers: OFFENSIVE_POSITIONS.flatMap((position) =>
      roster[position].map((player) => ({
        id: player.sleeper_player_id,
        position: player.position,
        projectedPoints:
          player.baselineProjectedPoints ?? Math.max(0, player.baselineModelScore),
        ceilingScore: Math.min(10, 5 + Math.max(0, 2 - player.history_seasons) * 1.5),
      }))
    ),
    rosterCounts: {
      QB: roster.QB.length,
      RB: roster.RB.length,
      WR: roster.WR.length,
      TE: roster.TE.length,
    },
  }, layers);
  const selection = selectPickEvRecommendation(
    pickEvPlayers,
    scores,
    true,
    PICK_EV_OVERRIDE_THRESHOLD
  );
  return legal.find((candidate) => candidate.sleeper_player_id === selection.playerId);
}

function getResidualFeatures(
  row: TrainingRow & { position: OffensivePosition }
): Readonly<Record<string, number | null>> {
  const record = row as unknown as Readonly<Record<string, number | null>>;
  const featureNames: readonly string[] = row.position === 'QB'
    ? POSITION_FEATURES.QB
    : row.position === 'RB'
      ? POSITION_FEATURES.RB
      : row.position === 'WR'
        ? POSITION_FEATURES.WR
        : POSITION_FEATURES.TE;
  return Object.fromEntries(
    featureNames.map((featureName) => [featureName, record[featureName] ?? null])
  );
}

function getSharedPprProjection(row: TrainingRow): number {
  const trailingPointsPerGame =
    row.trailing_expected_points_per_game_3yr ?? row.trailing_points_per_game_3yr;
  return trailingPointsPerGame === null
    ? Math.max(0, 300 - asNumber(row.predraft_ecr)) * 0.72
    : trailingPointsPerGame * 17;
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

function addDerivedValues(rows: readonly TrainingRow[]): {
  readonly playerSeasons: PlayerSeason[];
  readonly modelCache: ReadonlyMap<string, ReturnType<typeof fitPositionResidualModel>>;
} {
  const eligible = rows.filter(
    (row): row is TrainingRow & { sleeper_player_id: string; position: OffensivePosition } =>
      Boolean(row.sleeper_player_id) &&
      isOffensivePosition(row.position) &&
      Number.isFinite(row.predraft_ecr) &&
      asNumber(row.predraft_ecr) <= 250
  );
  const residualRows: PositionResidualRow[] = eligible.map((row) => ({
    season: row.season,
    position: row.position,
    targetResidual: row.actual_points / Math.max(1, row.games) * 17 - getSharedPprProjection(row),
    playerVolume: row.trailing_player_volume_3yr,
    features: getResidualFeatures(row),
  }));
  const modelCache = new Map<string, ReturnType<typeof fitPositionResidualModel>>();
  const getWalkForwardModel = (
    season: number,
    position: OffensivePosition
  ): ReturnType<typeof fitPositionResidualModel> => {
    const key = `${String(season)}|${position}`;
    const cached = modelCache.get(key);
    if (cached) return cached;
    const model = fitPositionResidualModelForSeason(residualRows, position, season);
    modelCache.set(key, model);
    return model;
  };
  const residualCenterCache = new Map<string, number>();
  const getResidualCenter = (season: number, position: OffensivePosition): number => {
    const key = `${String(season)}|${position}`;
    const cached = residualCenterCache.get(key);
    if (cached !== undefined) return cached;
    const model = getWalkForwardModel(season, position);
    const seasonRows = eligible.filter((row) => row.season === season && row.position === position);
    const center = seasonRows.reduce(
      (sum, row) => sum + predictPositionResidual(
        model,
        getResidualFeatures(row),
        row.trailing_player_volume_3yr
      ),
      0
    ) / Math.max(1, seasonRows.length);
    residualCenterCache.set(key, center);
    return center;
  };
  const clippedResidualCenterCache = new Map<string, number>();
  const getClippedResidualCenter = (season: number, position: OffensivePosition): number => {
    const key = `${String(season)}|${position}`;
    const cached = clippedResidualCenterCache.get(key);
    if (cached !== undefined) return cached;
    const model = getWalkForwardModel(season, position);
    const rawCenter = getResidualCenter(season, position);
    const seasonRows = eligible.filter((row) => row.season === season && row.position === position);
    const center = seasonRows.reduce((sum, row) => {
      const rawResidual = predictPositionResidual(
        model,
        getResidualFeatures(row),
        row.trailing_player_volume_3yr
      );
      return sum + Math.max(
        -model.residualCap,
        Math.min(model.residualCap, rawResidual - rawCenter)
      );
    }, 0) / Math.max(1, seasonRows.length);
    clippedResidualCenterCache.set(key, center);
    return center;
  };
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
    const sharedProjectedPoints = getSharedPprProjection(row) + estimatedCustomBonus;
    const positionModel = getWalkForwardModel(row.season, row.position);
    const rawResidual = predictPositionResidual(
      positionModel,
      getResidualFeatures(row),
      row.trailing_player_volume_3yr
    );
    const centeredResidual = rawResidual - getResidualCenter(row.season, row.position);
    const clippedResidual = Math.max(
      -positionModel.residualCap,
      Math.min(positionModel.residualCap, centeredResidual)
    );
    const fittedResidual = clippedResidual - getClippedResidualCenter(row.season, row.position);
    return {
      ...row,
      sleeper_player_id: row.sleeper_player_id,
      position: row.position,
      leagueActualPoints,
      leagueActualVor: 0,
      customPositionRank: 0,
      baselineModelScore: sharedProjectedPoints,
      transparentModelScore: sharedProjectedPoints + fittedResidual,
      baselineProjectedPoints: sharedProjectedPoints,
      transparentProjectedPoints: sharedProjectedPoints + fittedResidual,
    };
  });

  const playerSeasons = baseRows.map((row) => {
    const positionRows = baseRows
      .filter((candidate) => candidate.season === row.season && candidate.position === row.position)
      .sort((a, b) => b.leagueActualPoints - a.leagueActualPoints);
    const customPositionRank =
      positionRows.findIndex((candidate) => candidate.sleeper_player_id === row.sleeper_player_id) + 1;
    const replacementPoints =
      positionRows[REPLACEMENT_POSITION_RANKS[row.position] - 1]?.leagueActualPoints ?? 0;
    const baselineReplacementPoints = [...positionRows]
      .sort((a, b) => b.baselineModelScore - a.baselineModelScore)[
        REPLACEMENT_POSITION_RANKS[row.position] - 1
      ]?.baselineModelScore ?? 0;
    const positionModelReplacementPoints = [...positionRows]
      .sort((a, b) => b.transparentModelScore - a.transparentModelScore)[
        REPLACEMENT_POSITION_RANKS[row.position] - 1
      ]?.transparentModelScore ?? 0;
    return {
      ...row,
      customPositionRank,
      leagueActualVor: row.leagueActualPoints - replacementPoints,
      baselineModelScore: row.baselineModelScore - baselineReplacementPoints,
      transparentModelScore: row.transparentModelScore - positionModelReplacementPoints,
    };
  });
  return { playerSeasons, modelCache };
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

function evaluatePromotionGates(
  seasons: readonly PromotionSeasonMetrics[],
  strategies: PromotionStrategyMetrics
) {
  const seasonsWon = seasons.filter(
    (season) =>
      season.strategies.rosterAwareModel.starterPoints >
      season.strategies.rosterAwareEcr.starterPoints
  ).length;
  const hasAllReleaseSeasons = seasons.length === OUTER_TEST_SEASONS.length;
  const regressions = seasons.map((season) => {
    const ecrPoints = season.strategies.rosterAwareEcr.starterPoints;
    return ecrPoints === 0
      ? 0
      : (season.strategies.rosterAwareModel.starterPoints - ecrPoints) / ecrPoints;
  });
  const worstStarterRegression = regressions.length > 0 ? Math.min(...regressions) : 0;
  const featureGateChecks = {
    outOfSampleStarterPointsImprovePreviousModel:
      strategies.rosterAwareModel.starterPoints >
      strategies.rosterAwareBaselineModel.starterPoints,
  };
  const releaseGateChecks = {
    seasonsWon:
      hasAllReleaseSeasons && seasonsWon >= RELEASE_SEASONS_REQUIRED,
    aggregateStarterPointsBeatEcr:
      strategies.rosterAwareModel.starterPoints > strategies.rosterAwareEcr.starterPoints,
    aggregateVorBeatEcr:
      strategies.rosterAwareModel.vorCaptured > strategies.rosterAwareEcr.vorCaptured,
    averageRegretBeatEcr:
      strategies.rosterAwareModel.averageRegret < strategies.rosterAwareEcr.averageRegret,
    top24HitRateNonInferior:
      strategies.rosterAwareModel.top24PositionHitRate >=
      strategies.rosterAwareEcr.top24PositionHitRate - 0.02,
    noSeasonStarterRegressionOver15Percent: worstStarterRegression >= -0.15,
  };
  const featureGatePassed = Object.values(featureGateChecks).every(Boolean);
  const releaseGatePassed = Object.values(releaseGateChecks).every(Boolean);

  return {
    featureGatePassed,
    featureGateChecks,
    releaseGatePassed,
    releaseGateChecks,
    promotionPassed: featureGatePassed && releaseGatePassed,
    seasonsWon,
    seasonsRequired: RELEASE_SEASONS_REQUIRED,
    seasonsExpected: OUTER_TEST_SEASONS.length,
    hasAllReleaseSeasons,
    worstStarterRegression,
  };
}

function positiveIntegerFromEnvironment(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function formatEstimate(estimate: {
  readonly mean: number;
  readonly confidenceInterval: { readonly lower: number; readonly upper: number };
}): string {
  return `${String(estimate.mean)} (${String(estimate.confidenceInterval.lower)}–` +
    `${String(estimate.confidenceInterval.upper)})`;
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
          trailing_pass_attempts_per_game_3yr::double as trailing_pass_attempts_per_game_3yr,
          trailing_rush_attempts_per_game_3yr::double as trailing_rush_attempts_per_game_3yr,
          trailing_targets_per_game_3yr::double as trailing_targets_per_game_3yr,
          trailing_player_volume_3yr::double as trailing_player_volume_3yr,
          trailing_target_share_3yr::double as trailing_target_share_3yr,
          trailing_air_yards_share_3yr::double as trailing_air_yards_share_3yr,
          trailing_offense_snap_share_3yr::double as trailing_offense_snap_share_3yr,
          trailing_offense_snaps_per_game_3yr::double as trailing_offense_snaps_per_game_3yr,
          trailing_pressure_rate_3yr::double as trailing_pressure_rate_3yr,
          trailing_pressure_time_to_throw_3yr::double as trailing_pressure_time_to_throw_3yr,
          trailing_number_pass_rushers_3yr::double as trailing_number_pass_rushers_3yr,
          trailing_dropback_participation_per_game_3yr::double
            as trailing_dropback_participation_per_game_3yr,
          trailing_charted_route_targets_per_game_3yr::double
            as trailing_charted_route_targets_per_game_3yr,
          trailing_targets_per_dropback_participation_3yr::double
            as trailing_targets_per_dropback_participation_3yr,
          trailing_deep_route_target_share_3yr::double as trailing_deep_route_target_share_3yr,
          trailing_screen_route_target_share_3yr::double as trailing_screen_route_target_share_3yr,
          trailing_goal_line_carries_per_game_3yr::double
            as trailing_goal_line_carries_per_game_3yr,
          trailing_goal_line_targets_per_game_3yr::double
            as trailing_goal_line_targets_per_game_3yr,
          trailing_completion_percentage_above_expectation_3yr::double
            as trailing_completion_percentage_above_expectation_3yr,
          trailing_avg_time_to_throw_3yr::double as trailing_avg_time_to_throw_3yr,
          trailing_avg_intended_air_yards_3yr::double as trailing_avg_intended_air_yards_3yr,
          trailing_avg_separation_3yr::double as trailing_avg_separation_3yr,
          trailing_avg_yac_above_expectation_3yr::double
            as trailing_avg_yac_above_expectation_3yr,
          trailing_expected_rush_points_per_game_3yr::double
            as trailing_expected_rush_points_per_game_3yr,
          trailing_expected_tds_per_game_3yr::double as trailing_expected_tds_per_game_3yr,
          trailing_rush_yards_over_expected_per_attempt_3yr::double
            as trailing_rush_yards_over_expected_per_attempt_3yr,
          trailing_rush_pct_over_expected_3yr::double as trailing_rush_pct_over_expected_3yr,
          least(3, greatest(
            0,
            season - min(season) over (partition by gsis_id)
          ))::integer as history_seasons,
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
      trailing_pass_attempts_per_game_3yr: row.trailing_pass_attempts_per_game_3yr === null
        ? null : asNumber(row.trailing_pass_attempts_per_game_3yr),
      trailing_rush_attempts_per_game_3yr: row.trailing_rush_attempts_per_game_3yr === null
        ? null : asNumber(row.trailing_rush_attempts_per_game_3yr),
      trailing_targets_per_game_3yr: row.trailing_targets_per_game_3yr === null
        ? null : asNumber(row.trailing_targets_per_game_3yr),
      trailing_player_volume_3yr: row.trailing_player_volume_3yr === null
        ? null : asNumber(row.trailing_player_volume_3yr),
      trailing_target_share_3yr: row.trailing_target_share_3yr === null
        ? null : asNumber(row.trailing_target_share_3yr),
      trailing_air_yards_share_3yr: row.trailing_air_yards_share_3yr === null
        ? null : asNumber(row.trailing_air_yards_share_3yr),
      trailing_offense_snap_share_3yr: row.trailing_offense_snap_share_3yr === null
        ? null : asNumber(row.trailing_offense_snap_share_3yr),
      trailing_offense_snaps_per_game_3yr: row.trailing_offense_snaps_per_game_3yr === null
        ? null : asNumber(row.trailing_offense_snaps_per_game_3yr),
      trailing_pressure_rate_3yr: row.trailing_pressure_rate_3yr === null
        ? null : asNumber(row.trailing_pressure_rate_3yr),
      trailing_pressure_time_to_throw_3yr: row.trailing_pressure_time_to_throw_3yr === null
        ? null : asNumber(row.trailing_pressure_time_to_throw_3yr),
      trailing_number_pass_rushers_3yr: row.trailing_number_pass_rushers_3yr === null
        ? null : asNumber(row.trailing_number_pass_rushers_3yr),
      trailing_dropback_participation_per_game_3yr:
        row.trailing_dropback_participation_per_game_3yr === null
          ? null : asNumber(row.trailing_dropback_participation_per_game_3yr),
      trailing_charted_route_targets_per_game_3yr:
        row.trailing_charted_route_targets_per_game_3yr === null
          ? null : asNumber(row.trailing_charted_route_targets_per_game_3yr),
      trailing_targets_per_dropback_participation_3yr:
        row.trailing_targets_per_dropback_participation_3yr === null
          ? null : asNumber(row.trailing_targets_per_dropback_participation_3yr),
      trailing_deep_route_target_share_3yr: row.trailing_deep_route_target_share_3yr === null
        ? null : asNumber(row.trailing_deep_route_target_share_3yr),
      trailing_screen_route_target_share_3yr: row.trailing_screen_route_target_share_3yr === null
        ? null : asNumber(row.trailing_screen_route_target_share_3yr),
      trailing_goal_line_carries_per_game_3yr:
        row.trailing_goal_line_carries_per_game_3yr === null
          ? null : asNumber(row.trailing_goal_line_carries_per_game_3yr),
      trailing_goal_line_targets_per_game_3yr:
        row.trailing_goal_line_targets_per_game_3yr === null
          ? null : asNumber(row.trailing_goal_line_targets_per_game_3yr),
      trailing_completion_percentage_above_expectation_3yr:
        row.trailing_completion_percentage_above_expectation_3yr === null
          ? null : asNumber(row.trailing_completion_percentage_above_expectation_3yr),
      trailing_avg_time_to_throw_3yr: row.trailing_avg_time_to_throw_3yr === null
        ? null : asNumber(row.trailing_avg_time_to_throw_3yr),
      trailing_avg_intended_air_yards_3yr: row.trailing_avg_intended_air_yards_3yr === null
        ? null : asNumber(row.trailing_avg_intended_air_yards_3yr),
      trailing_avg_separation_3yr: row.trailing_avg_separation_3yr === null
        ? null : asNumber(row.trailing_avg_separation_3yr),
      trailing_avg_yac_above_expectation_3yr: row.trailing_avg_yac_above_expectation_3yr === null
        ? null : asNumber(row.trailing_avg_yac_above_expectation_3yr),
      trailing_expected_rush_points_per_game_3yr:
        row.trailing_expected_rush_points_per_game_3yr === null
          ? null : asNumber(row.trailing_expected_rush_points_per_game_3yr),
      trailing_expected_tds_per_game_3yr: row.trailing_expected_tds_per_game_3yr === null
        ? null : asNumber(row.trailing_expected_tds_per_game_3yr),
      trailing_rush_yards_over_expected_per_attempt_3yr:
        row.trailing_rush_yards_over_expected_per_attempt_3yr === null
          ? null : asNumber(row.trailing_rush_yards_over_expected_per_attempt_3yr),
      trailing_rush_pct_over_expected_3yr: row.trailing_rush_pct_over_expected_3yr === null
        ? null : asNumber(row.trailing_rush_pct_over_expected_3yr),
      history_seasons: asNumber(row.history_seasons),
    }));
    const { playerSeasons, modelCache } = addDerivedValues(rawRows);
    const evaluations: PickEvaluation[] = [];
    const seasonReports: Array<{
      season: number;
      trainingSeasons: readonly number[];
      strategies: {
        actualUserDraft: StrategyMetrics;
        rosterAwareEcr: StrategyMetrics;
        rosterAwareBaselineModel: StrategyMetrics;
        rosterAwareModel: StrategyMetrics;
        ecrWaitingOnly: StrategyMetrics;
        pickEvProjection: StrategyMetrics;
        pickEvWaiting: StrategyMetrics;
        pickEvOption: StrategyMetrics;
        pickEvFull: StrategyMetrics;
      };
      positionModelSelections: Readonly<Record<
        OffensivePosition,
        PositionModelSelectionSummary
      >>;
      winner: 'model' | 'ecr' | 'tie';
    }> = [];
    const counterfactualIterations = positiveIntegerFromEnvironment(
      process.env.COUNTERFACTUAL_SIMULATIONS,
      DEFAULT_COUNTERFACTUAL_ITERATIONS
    );
    const counterfactualSeed = positiveIntegerFromEnvironment(
      process.env.COUNTERFACTUAL_SEED,
      DEFAULT_COUNTERFACTUAL_SEED
    );
    const counterfactualSeasonReports: Array<{
      readonly season: number;
      readonly strategies: {
        readonly rosterAwareEcr: CounterfactualSimulationSummary;
        readonly rosterAwareModel: CounterfactualSimulationSummary;
      };
    }> = [];
    const ecrCounterfactualIterations: CounterfactualDraftMetrics[][] = [];
    const modelCounterfactualIterations: CounterfactualDraftMetrics[][] = [];

    const sortedHistory = [...history.seasons].sort((a, b) => a.season - b.season);
    const evaluationHistory = sortedHistory.filter((season) =>
      OUTER_TEST_SEASONS.includes(season.season as (typeof OUTER_TEST_SEASONS)[number])
    );
    for (const season of evaluationHistory) {
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
      const ecrWaitingOnlySelected = new Set<string>();
      const pickEvProjectionSelected = new Set<string>();
      const pickEvWaitingSelected = new Set<string>();
      const pickEvOptionSelected = new Set<string>();
      const pickEvFullSelected = new Set<string>();
      const actual: StrategyAccumulator = { rows: [], regrets: [], roster: createRoster() };
      const ecr: StrategyAccumulator = { rows: [], regrets: [], roster: createRoster() };
      const baseline: StrategyAccumulator = { rows: [], regrets: [], roster: createRoster() };
      const model: StrategyAccumulator = { rows: [], regrets: [], roster: createRoster() };
      const ecrWaitingOnly: StrategyAccumulator = { rows: [], regrets: [], roster: createRoster() };
      const pickEvProjection: StrategyAccumulator = { rows: [], regrets: [], roster: createRoster() };
      const pickEvWaiting: StrategyAccumulator = { rows: [], regrets: [], roster: createRoster() };
      const pickEvOption: StrategyAccumulator = { rows: [], regrets: [], roster: createRoster() };
      const pickEvFull: StrategyAccumulator = { rows: [], regrets: [], roster: createRoster() };

      for (const keeper of keepers.filter((pick) => pick.isUserPick)) {
        const row = byPlayerId.get(keeper.playerId);
        if (!row) continue;
        addToRoster(actual.roster, row);
        addToRoster(ecr.roster, row);
        addToRoster(baseline.roster, row);
        addToRoster(model.roster, row);
        addToRoster(ecrWaitingOnly.roster, row);
        addToRoster(pickEvProjection.roster, row);
        addToRoster(pickEvWaiting.roster, row);
        addToRoster(pickEvOption.roster, row);
        addToRoster(pickEvFull.roster, row);
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
          const ecrWaitingOnlyAvailable = strategyAvailable(ecrWaitingOnlySelected);
          const pickEvProjectionAvailable = strategyAvailable(pickEvProjectionSelected);
          const pickEvWaitingAvailable = strategyAvailable(pickEvWaitingSelected);
          const pickEvOptionAvailable = strategyAvailable(pickEvOptionSelected);
          const pickEvFullAvailable = strategyAvailable(pickEvFullSelected);
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
          const nextUserPick = sortedPicks.slice(index + 1).find((candidate) =>
            candidate.isUserPick && !candidate.isKeeper
          )?.pickNo ?? pick.pickNo;
          const totalTeams = Math.max(1, Object.keys(season.rosterIdToOwner).length);
          const totalPicks = sortedPicks.at(-1)?.pickNo ?? pick.pickNo;
          const ecrWaitingOnlyPick = choosePickEv(
            ecrWaitingOnlyAvailable,
            ecrWaitingOnly.roster,
            rules,
            remainingPicks,
            pick.pickNo,
            nextUserPick,
            totalTeams,
            totalPicks,
            {
              projection: false,
              lineupUtility: false,
              costOfWaiting: true,
              lateRoundOptionValue: false,
              risk: false,
            }
          );
          const pickEvProjectionPick = choosePickEv(
            pickEvProjectionAvailable,
            pickEvProjection.roster,
            rules,
            remainingPicks,
            pick.pickNo,
            nextUserPick,
            totalTeams,
            totalPicks,
            {
              projection: true,
              lineupUtility: true,
              costOfWaiting: false,
              lateRoundOptionValue: false,
              risk: false,
            }
          );
          const pickEvWaitingPick = choosePickEv(
            pickEvWaitingAvailable,
            pickEvWaiting.roster,
            rules,
            remainingPicks,
            pick.pickNo,
            nextUserPick,
            totalTeams,
            totalPicks,
            {
              projection: true,
              lineupUtility: true,
              costOfWaiting: true,
              lateRoundOptionValue: false,
              risk: false,
            }
          );
          const pickEvOptionPick = choosePickEv(
            pickEvOptionAvailable,
            pickEvOption.roster,
            rules,
            remainingPicks,
            pick.pickNo,
            nextUserPick,
            totalTeams,
            totalPicks,
            {
              projection: true,
              lineupUtility: true,
              costOfWaiting: true,
              lateRoundOptionValue: true,
              risk: false,
            }
          );
          const pickEvFullPick = choosePickEv(
            pickEvFullAvailable,
            pickEvFull.roster,
            rules,
            remainingPicks,
            pick.pickNo,
            nextUserPick,
            totalTeams,
            totalPicks,
            {
              projection: true,
              lineupUtility: true,
              costOfWaiting: true,
              lateRoundOptionValue: true,
              risk: false,
            }
          );
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
          const recordPickEv = (
            accumulator: StrategyAccumulator,
            selected: Set<string>,
            selectedPlayer: PlayerSeason | undefined,
            board: readonly PlayerSeason[]
          ): void => {
            if (!selectedPlayer) return;
            const bestBoard = [...board].sort((a, b) => b.leagueActualVor - a.leagueActualVor)[0];
            accumulator.rows.push(selectedPlayer);
            selected.add(selectedPlayer.sleeper_player_id);
            addToRoster(accumulator.roster, selectedPlayer);
            accumulator.regrets.push(
              Math.max(0, (bestBoard?.leagueActualVor ?? 0) - selectedPlayer.leagueActualVor)
            );
          };
          recordPickEv(
            ecrWaitingOnly,
            ecrWaitingOnlySelected,
            ecrWaitingOnlyPick,
            ecrWaitingOnlyAvailable
          );
          recordPickEv(
            pickEvProjection,
            pickEvProjectionSelected,
            pickEvProjectionPick,
            pickEvProjectionAvailable
          );
          recordPickEv(
            pickEvWaiting,
            pickEvWaitingSelected,
            pickEvWaitingPick,
            pickEvWaitingAvailable
          );
          recordPickEv(
            pickEvOption,
            pickEvOptionSelected,
            pickEvOptionPick,
            pickEvOptionAvailable
          );
          recordPickEv(
            pickEvFull,
            pickEvFullSelected,
            pickEvFullPick,
            pickEvFullAvailable
          );
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
      const summarizePickEv = (accumulator: StrategyAccumulator): StrategyMetrics => summarize(
        accumulator.rows,
        accumulator.regrets,
        calculateStarterPoints(accumulator.roster, rules)
      );
      seasonReports.push({
        season: season.season,
        trainingSeasons,
        positionModelSelections: Object.fromEntries(OFFENSIVE_POSITIONS.map((position) => {
          const fitted = modelCache.get(`${String(season.season)}|${position}`);
          return [position, {
            specificationId: fitted?.specificationId ?? 'unavailable',
            lambda: fitted?.lambda ?? 0,
            volumeThreshold: fitted?.volumeThreshold ?? 0,
            selectedWithTrainingSeasons: fitted?.selectionTrainingSeasons ?? [],
            innerValidationSeason: fitted?.selectionValidationSeason ?? null,
            refitThroughSeason: fitted?.trainingSeasons.at(-1) ?? null,
          }];
        })) as Record<OffensivePosition, PositionModelSelectionSummary>,
        strategies: {
          actualUserDraft: actualMetrics,
          rosterAwareEcr: ecrMetrics,
          rosterAwareBaselineModel: baselineMetrics,
          rosterAwareModel: modelMetrics,
          ecrWaitingOnly: summarizePickEv(ecrWaitingOnly),
          pickEvProjection: summarizePickEv(pickEvProjection),
          pickEvWaiting: summarizePickEv(pickEvWaiting),
          pickEvOption: summarizePickEv(pickEvOption),
          pickEvFull: summarizePickEv(pickEvFull),
        },
        winner: modelMetrics.starterPoints > ecrMetrics.starterPoints
          ? 'model'
          : modelMetrics.starterPoints < ecrMetrics.starterPoints ? 'ecr' : 'tie',
      });

      const counterfactualPlayers = seasonRows.map((row) => ({
        id: row.sleeper_player_id,
        name: row.player_name,
        position: row.position,
        marketRank: asNumber(row.predraft_ecr),
        modelValue: row.transparentModelScore,
        actualPoints: row.leagueActualPoints,
        actualVor: row.leagueActualVor,
      }));
      const priorSeasons = sortedHistory.filter(
        (candidate) => candidate.season < season.season
      ) as readonly CounterfactualSeason[];
      const counterfactualSeason = season as CounterfactualSeason;
      const ecrCounterfactual = simulateCounterfactualSeason({
        season: counterfactualSeason,
        priorSeasons,
        players: counterfactualPlayers,
        strategy: 'ecr',
        iterations: counterfactualIterations,
        seed: counterfactualSeed,
      });
      const modelCounterfactual = simulateCounterfactualSeason({
        season: counterfactualSeason,
        priorSeasons,
        players: counterfactualPlayers,
        strategy: 'model',
        iterations: counterfactualIterations,
        seed: counterfactualSeed,
      });
      ecrCounterfactualIterations.push([...ecrCounterfactual.iterations]);
      modelCounterfactualIterations.push([...modelCounterfactual.iterations]);
      counterfactualSeasonReports.push({
        season: season.season,
        strategies: {
          rosterAwareEcr: ecrCounterfactual.summary,
          rosterAwareModel: modelCounterfactual.summary,
        },
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
    const architectureStrategies = {
      ecrAnchor: strategies.rosterAwareEcr,
      legacyProjectionVor: strategies.rosterAwareBaselineModel,
      ecrWaitingOnly: aggregate(
        seasonReports.map((season) => season.strategies.ecrWaitingOnly)
      ),
      pickEvProjection: aggregate(
        seasonReports.map((season) => season.strategies.pickEvProjection)
      ),
      pickEvWaiting: aggregate(
        seasonReports.map((season) => season.strategies.pickEvWaiting)
      ),
      pickEvOption: aggregate(
        seasonReports.map((season) => season.strategies.pickEvOption)
      ),
      pickEvFull: aggregate(seasonReports.map((season) => season.strategies.pickEvFull)),
    };
    const metricDelta = (current: StrategyMetrics, previous: StrategyMetrics) => ({
      starterPoints: round(current.starterPoints - previous.starterPoints),
      vorCaptured: round(current.vorCaptured - previous.vorCaptured),
      averageRegret: round(current.averageRegret - previous.averageRegret),
      top24PositionHitRate: round(
        current.top24PositionHitRate - previous.top24PositionHitRate
      ),
    });
    const architectureComparison = {
      dataStatus: {
        projections: 'Historical leakage-safe shared projection proxy; historical FantasyPros snapshots are not available.',
        adp: 'Historical pre-draft consensus rank proxy; observed historical player-level ADP is not available.',
        risk: 'Informational only; dated injury replay is not yet available, so risk is excluded from selection.',
        optionValue: 'History-length uncertainty is the leakage-safe late-round ceiling proxy.',
      },
      strategies: architectureStrategies,
      incrementalDeltas: {
        ecrWaitingOnlyVsEcr: metricDelta(
          architectureStrategies.ecrWaitingOnly,
          architectureStrategies.ecrAnchor
        ),
        projectionVsEcr: metricDelta(
          architectureStrategies.pickEvProjection,
          architectureStrategies.ecrAnchor
        ),
        waitingVsProjection: metricDelta(
          architectureStrategies.pickEvWaiting,
          architectureStrategies.pickEvProjection
        ),
        optionVsWaiting: metricDelta(
          architectureStrategies.pickEvOption,
          architectureStrategies.pickEvWaiting
        ),
        fullVsLegacy: metricDelta(
          architectureStrategies.pickEvFull,
          architectureStrategies.legacyProjectionVor
        ),
        fullVsEcr: metricDelta(
          architectureStrategies.pickEvFull,
          architectureStrategies.ecrAnchor
        ),
      },
    };
    const fullVsEcr = architectureComparison.incrementalDeltas.fullVsEcr;
    const pickEvOverrideValidation = {
      threshold: PICK_EV_OVERRIDE_THRESHOLD,
      checks: {
        starterPointsImprove: fullVsEcr.starterPoints > 0,
        vorDoesNotRegress: fullVsEcr.vorCaptured >= 0,
        regretDoesNotRegress: fullVsEcr.averageRegret <= 0,
        top24HitRateNonInferior: fullVsEcr.top24PositionHitRate >= -0.02,
      },
      passed:
        fullVsEcr.starterPoints > 0 &&
        fullVsEcr.vorCaptured >= 0 &&
        fullVsEcr.averageRegret <= 0 &&
        fullVsEcr.top24PositionHitRate >= -0.02,
    };
    const promotion = evaluatePromotionGates(seasonReports, strategies);
    const counterfactualStrategies = {
      rosterAwareEcr: aggregateCounterfactualSeasons(ecrCounterfactualIterations),
      rosterAwareModel: aggregateCounterfactualSeasons(modelCounterfactualIterations),
    };
    const counterfactualReport = {
      generatedAt: new Date().toISOString(),
      modelVersion: 'counterfactual-opponent-room-v1',
      iterations: counterfactualIterations,
      randomSeed: counterfactualSeed,
      confidenceLevel: 0.95,
      evaluationDesign: {
        method:
          'Each strategy receives an independent draft room. Keepers are seeded first, the user selects with the strategy, and every offensive opponent turn samples a replacement from that room’s available board.',
        marketModel:
          'Historical pre-draft consensus rank is used as the walk-forward ADP proxy because observed historical player-level ADP is unavailable.',
        opponentModel:
          'Opponent weights combine the market-rank proxy, current roster need, and manager position tendencies shrunk toward league rates.',
        leakageControl:
          'A test season uses only earlier league seasons for manager and league position tendencies. Test-season outcomes affect evaluation metrics only.',
        pairedRandomness:
          'ECR and model rooms use the same deterministic season/iteration random seeds to reduce comparison noise, while maintaining separate available-player boards.',
        releasePolicy:
          'This assumption-dependent report is diagnostic and does not replace the fixed-board release gate.',
      },
      strategies: counterfactualStrategies,
      seasons: counterfactualSeasonReports,
      limitations: [
        'Historical pre-draft consensus rank is an ADP proxy, not observed historical player-level ADP.',
        'Opponent behavior is a calibrated heuristic rather than a validated choice model; confidence intervals measure Monte Carlo draft-room variance, not model uncertainty.',
        'Kicker and defense turns remain allocated at their historical slots, while only the offensive player board is resampled.',
        'Injuries known on each historical draft date are not explicitly modeled beyond their effect on the pre-draft market rank.',
        'Only four outer test seasons are available.',
      ],
    };

    const report = {
      generatedAt: new Date().toISOString(),
      modelVersion: 'roster-aware-nested-walk-forward-v9-pick-ev',
      evaluationDesign: {
        method:
          'Nested season-by-season walk-forward replay: select on the immediately prior season, freeze the specification, refit through that season, then evaluate the untouched next season once.',
        leakageControl:
          'For test season T, candidate selection trains through T-2 and validates on T-1. The selected architecture, workload threshold, and ridge penalty are then frozen and refit through T-1; no T outcomes enter selection or fitting.',
        candidateDeclaration: {
          version: POSITION_MODEL_CANDIDATE_SET_VERSION,
          specifications: POSITION_MODEL_SPECIFICATIONS.map((specification) => ({
            id: specification.id,
            features: specification.features,
          })),
          ridgeLambdas: POSITION_MODEL_LAMBDA_CANDIDATES,
          volumeThresholds: POSITION_MODEL_VOLUME_THRESHOLD_CANDIDATES,
          changePolicy:
            'Changing any candidate or threshold requires a new declaration version and invalidates reuse of prior outer-fold results for tuning.',
        },
        rosterControl:
          'Actual, ECR, and model strategies begin with historical user keepers and must satisfy that season’s roster slots and position limits.',
        boardControl:
          'Historical opponent picks remain fixed; each simulated strategy also removes its own prior selections.',
      },
      scoring: {
        note: 'Each historical season uses the league scoring rules active in that season.',
        seasons: Object.fromEntries(
          evaluationHistory.map(
            (season) => [season.season, getHistoricalLeagueScoringAdjustments(season.season)]
          )
        ),
      },
      coverage: {
        evaluatedUserPicks: evaluations.length,
        totalHistoricalUserPicks: evaluationHistory.reduce(
          (count, season) => count + season.picks.filter((pick) => pick.isUserPick && !pick.isKeeper).length,
          0
        ),
        evaluatedSeasons: seasonReports.length,
      },
      featureGate: {
        passed: promotion.featureGatePassed,
        checks: promotion.featureGateChecks,
        decision: promotion.featureGatePassed
          ? 'The new feature family improves aggregate out-of-sample starter points over the previous model.'
          : 'The new feature family does not improve aggregate out-of-sample starter points over the previous model.',
      },
      releaseGate: {
        passed: promotion.releaseGatePassed,
        seasonsWon: promotion.seasonsWon,
        seasonsRequired: promotion.seasonsRequired,
        seasonsExpected: promotion.seasonsExpected,
        hasAllReleaseSeasons: promotion.hasAllReleaseSeasons,
        worstStarterRegression: round(promotion.worstStarterRegression, 4),
        checks: promotion.releaseGateChecks,
        decision: promotion.releaseGatePassed
          ? 'Model clears the ECR comparison gate and may be promoted as a validated recommendation signal.'
          : 'Model does not clear the ECR comparison gate; keep it experimental and do not claim an edge.',
      },
      promotion: {
        passed: promotion.promotionPassed,
        decision: promotion.promotionPassed
          ? 'Both promotion gates pass; the model is eligible for review, but the 2026 Draft Workspace remains ECR-anchored and observes it only in Shadow Recommendation.'
          : 'At least one promotion gate fails; keep the model in Shadow Recommendation and out of live ordering.',
      },
      featureAblation: {
        baselineModel: 'Shared projected-points prior converted to position VOR.',
        expandedModel: 'Shared prior plus workload-shrunk, centered QB/RB/WR/TE ridge residuals using pressure, routes, and goal-line opportunity.',
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
      architectureComparison,
      pickEvOverrideValidation,
      strategies,
      seasons: seasonReports,
      limitations: [
        'Historical opponent picks are held fixed; the replay does not simulate replacement picks when a strategy takes a player an opponent selected later.',
        'The 2022 fold uses the predeclared cold-start fallback because only one earlier dataset season is available; it contributes release-gate coverage but does not separate the expanded feature family from the previous model.',
        'The architecture-selection replay has only the four predeclared 2022–2025 outer folds, although residual fitting uses earlier player-season rows.',
        'Injuries known on each historical draft date and manager-specific opponent behavior are not yet replayed.',
        'PickEV architecture ablations use historical projection, ADP, and risk proxies; they compare scoring architecture now but cannot establish the incremental value of true historical FantasyPros and observed ADP inputs.',
        'The sample contains only four outer seasons and should be treated as a product gate, not statistical proof of superiority.',
      ],
      evaluations,
    };

    await mkdir(dirname(JSON_OUTPUT), { recursive: true });
    await mkdir(dirname(MARKDOWN_OUTPUT), { recursive: true });
    await writeFile(JSON_OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(
      COUNTERFACTUAL_JSON_OUTPUT,
      `${JSON.stringify(counterfactualReport, null, 2)}\n`
    );
    await writeFile(
      POLICY_OUTPUT,
      `${JSON.stringify({
        generatedAt: report.generatedAt,
        modelVersion: report.modelVersion,
        modelPredictionsEnabled: false,
        contractSignalEnabled: false,
        pickEvOverrideEnabled: pickEvOverrideValidation.passed,
        pickEvOverrideThreshold: PICK_EV_OVERRIDE_THRESHOLD,
        pickEvOverrideValidation,
        recommendationArchitecture: 'pick-ev-v1',
        pickEvEvaluation: {
          improvesLegacyStarterPoints:
            architectureComparison.incrementalDeltas.fullVsLegacy.starterPoints > 0,
          beatsEcrStarterPoints:
            architectureComparison.incrementalDeltas.fullVsEcr.starterPoints > 0,
          fullVsLegacy: architectureComparison.incrementalDeltas.fullVsLegacy,
          fullVsEcr: architectureComparison.incrementalDeltas.fullVsEcr,
          dataStatus: architectureComparison.dataStatus,
        },
        fallback: 'fantasypros-ecr-market',
        promotionGates: {
          feature: report.featureGate,
          release: report.releaseGate,
          passed: report.promotion.passed,
        },
        shadowLogging: {
          enabled: true,
          season: 2026,
          endpoint: '/api/shadow-recommendations',
        },
        reason: report.promotion.decision,
      }, null, 2)}\n`
    );
    const seasonRows = report.seasons.map((season) => {
      const selectedModels = OFFENSIVE_POSITIONS.map((position) => {
        const selection = season.positionModelSelections[position];
        return `${position}:${selection.specificationId} (λ=${String(selection.lambda)}, ` +
          `v=${String(selection.volumeThreshold)})`;
      }).join('<br>');
      return (
      `| ${String(season.season)} | ${season.trainingSeasons.join(', ') || 'none'} | ` +
      `${selectedModels} | ` +
      `${String(season.strategies.rosterAwareEcr.starterPoints)} | ` +
      `${String(season.strategies.rosterAwareBaselineModel.starterPoints)} | ` +
      `${String(season.strategies.rosterAwareModel.starterPoints)} | ${season.winner} |`
      );
    }).join('\n');
    const featureGateRows = Object.entries(report.featureGate.checks)
      .map(([check, passed]) => `| ${check} | ${passed ? 'pass' : 'fail'} |`)
      .join('\n');
    const releaseGateRows = Object.entries(report.releaseGate.checks)
      .map(([check, passed]) => `| ${check} | ${passed ? 'pass' : 'fail'} |`)
      .join('\n');
    const architectureRows = Object.entries(report.architectureComparison.strategies)
      .map(([name, metrics]) =>
        `| ${name} | ${String(metrics.evaluatedPicks)} | ${String(metrics.vorCaptured)} | ` +
        `${String(metrics.starterPoints)} | ${String(metrics.averageRegret)} | ` +
        `${String(metrics.top24PositionHitRate)} |`
      )
      .join('\n');
    const architectureDeltaRows = Object.entries(report.architectureComparison.incrementalDeltas)
      .map(([name, delta]) =>
        `| ${name} | ${String(delta.starterPoints)} | ${String(delta.vorCaptured)} | ` +
        `${String(delta.averageRegret)} | ${String(delta.top24PositionHitRate)} |`
      )
      .join('\n');
    await writeFile(MARKDOWN_OUTPUT, `# Recommendation Backtest

Generated: ${report.generatedAt}

This replay is roster-aware and walk-forward. Promotion requires both the
feature-family gate and the ECR release gate; a failure keeps the model experimental.

This is the fixed-board replay. The assumption-dependent companion is
[Counterfactual Recommendation Backtest](./counterfactual-recommendation-backtest.md).

Candidate declaration: **${report.evaluationDesign.candidateDeclaration.version}**.
Architectures, ridge penalties, and workload thresholds are fixed by that
declaration before the 2022–2025 outer folds. Changing it requires a new
backtest version.

## Promotion Gates

- Promoted: **${String(report.promotion.passed)}**
- Decision: ${report.promotion.decision}

### Feature gate

- Passed: **${String(report.featureGate.passed)}**
- Decision: ${report.featureGate.decision}

| Check | Result |
| --- | --- |
${featureGateRows}

### Release gate

- Passed: **${String(report.releaseGate.passed)}**
- Decision: ${report.releaseGate.decision}
- Seasons won: ${String(report.releaseGate.seasonsWon)} / ${String(report.releaseGate.seasonsExpected)} (required ${String(report.releaseGate.seasonsRequired)})
- Complete four-season evaluation: **${String(report.releaseGate.hasAllReleaseSeasons)}**

| Check | Result |
| --- | --- |
${releaseGateRows}

## Aggregate Strategy Comparison

| Strategy | Picks | VOR captured | Starter points | Average regret | Top-24 hit rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| Actual user draft | ${String(strategies.actualUserDraft.evaluatedPicks)} | ${String(strategies.actualUserDraft.vorCaptured)} | ${String(strategies.actualUserDraft.starterPoints)} | ${String(strategies.actualUserDraft.averageRegret)} | ${String(strategies.actualUserDraft.top24PositionHitRate)} |
| Roster-aware ECR | ${String(strategies.rosterAwareEcr.evaluatedPicks)} | ${String(strategies.rosterAwareEcr.vorCaptured)} | ${String(strategies.rosterAwareEcr.starterPoints)} | ${String(strategies.rosterAwareEcr.averageRegret)} | ${String(strategies.rosterAwareEcr.top24PositionHitRate)} |
| Baseline roster-aware model | ${String(strategies.rosterAwareBaselineModel.evaluatedPicks)} | ${String(strategies.rosterAwareBaselineModel.vorCaptured)} | ${String(strategies.rosterAwareBaselineModel.starterPoints)} | ${String(strategies.rosterAwareBaselineModel.averageRegret)} | ${String(strategies.rosterAwareBaselineModel.top24PositionHitRate)} |
| Roster-aware model | ${String(strategies.rosterAwareModel.evaluatedPicks)} | ${String(strategies.rosterAwareModel.vorCaptured)} | ${String(strategies.rosterAwareModel.starterPoints)} | ${String(strategies.rosterAwareModel.averageRegret)} | ${String(strategies.rosterAwareModel.top24PositionHitRate)} |

## PickEV Architecture Comparison

This comparison replays the legacy projection/VOR architecture and each PickEV
layer independently. Negative regret deltas are improvements. These are
architecture results using the historical proxies below, not evidence about
unavailable historical FantasyPros or observed ADP data.

- Projections: ${report.architectureComparison.dataStatus.projections}
- ADP: ${report.architectureComparison.dataStatus.adp}
- Risk: ${report.architectureComparison.dataStatus.risk}
- Late option value: ${report.architectureComparison.dataStatus.optionValue}

### PickEV override gate

- Candidate threshold: ${String(report.pickEvOverrideValidation.threshold)} PickEV points
- Validated for live overrides: **${String(report.pickEvOverrideValidation.passed)}**
- ECR remains the champion whenever this gate fails.

| Architecture | Picks | VOR captured | Starter points | Average regret | Top-24 hit rate |
| --- | ---: | ---: | ---: | ---: | ---: |
${architectureRows}

### Incremental layer deltas

| Comparison | Starter points | VOR captured | Average regret | Top-24 hit rate |
| --- | ---: | ---: | ---: | ---: |
${architectureDeltaRows}

## Position-model Ablation

- Starter points delta vs baseline: ${String(report.featureAblation.starterPointsDelta)}
- VOR delta vs baseline: ${String(report.featureAblation.vorDelta)}
- Average regret delta vs baseline: ${String(report.featureAblation.averageRegretDelta)}
- Top-24 hit-rate delta vs baseline: ${String(report.featureAblation.top24HitRateDelta)}

## Walk-Forward Folds

| Test season | Prior league seasons | Frozen position specifications | ECR starter points | Baseline model | Expanded model | Winner |
| --- | --- | --- | ---: | ---: | ---: | --- |
${seasonRows}

## Limitations

${report.limitations.map((limitation) => `- ${limitation}`).join('\n')}
`);

    const counterfactualSeasonRows = counterfactualReport.seasons.map((season) => {
      const ecr = season.strategies.rosterAwareEcr;
      const model = season.strategies.rosterAwareModel;
      return `| ${String(season.season)} | ${formatEstimate(ecr.expectedStarterPoints)} | ` +
        `${formatEstimate(model.expectedStarterPoints)} | ` +
        `${formatEstimate(ecr.expectedVorCaptured)} | ` +
        `${formatEstimate(model.expectedVorCaptured)} | ` +
        `${formatEstimate(ecr.expectedAverageRegret)} | ` +
        `${formatEstimate(model.expectedAverageRegret)} |`;
    }).join('\n');
    await writeFile(COUNTERFACTUAL_MARKDOWN_OUTPUT, `# Counterfactual Recommendation Backtest

Generated: ${counterfactualReport.generatedAt}

This companion to the [fixed-board replay](./recommendation-backtest.md) gives
each strategy its own draft room. Results are means with 95% Monte Carlo
intervals across ${String(counterfactualReport.iterations)} simulations per season.

This report is diagnostic. The fixed-board replay remains the release gate
because the counterfactual result depends on the opponent model.

## Aggregate Strategy Comparison

| Strategy | Expected starter points | Expected VOR | Expected regret |
| --- | ---: | ---: | ---: |
| Roster-aware ECR | ${formatEstimate(counterfactualStrategies.rosterAwareEcr.expectedStarterPoints)} | ${formatEstimate(counterfactualStrategies.rosterAwareEcr.expectedVorCaptured)} | ${formatEstimate(counterfactualStrategies.rosterAwareEcr.expectedAverageRegret)} |
| Roster-aware model | ${formatEstimate(counterfactualStrategies.rosterAwareModel.expectedStarterPoints)} | ${formatEstimate(counterfactualStrategies.rosterAwareModel.expectedVorCaptured)} | ${formatEstimate(counterfactualStrategies.rosterAwareModel.expectedAverageRegret)} |

## Season Results

| Season | ECR starter points | Model starter points | ECR VOR | Model VOR | ECR regret | Model regret |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${counterfactualSeasonRows}

## Opponent Model

- Keepers are seeded before the draft and removed from every room's board.
- The user selects with roster-aware ECR or the walk-forward model.
- Opponents sample from available offensive players using the pre-draft market-rank proxy, current roster need, and that owner's prior-season position tendencies.
- Manager tendencies are phase-specific (rounds 1–4, 5–8, and 9+) and shrink toward league rates when samples are small.
- Every selected player is removed only from that strategy's simulated room.
- Random seed: ${String(counterfactualReport.randomSeed)}.

## Limitations

${counterfactualReport.limitations.map((limitation) => `- ${limitation}`).join('\n')}
`);

    console.log(`Recommendation backtest JSON written to ${JSON_OUTPUT}`);
    console.log(`Recommendation backtest Markdown written to ${MARKDOWN_OUTPUT}`);
    console.log(`Counterfactual backtest JSON written to ${COUNTERFACTUAL_JSON_OUTPUT}`);
    console.log(`Counterfactual backtest Markdown written to ${COUNTERFACTUAL_MARKDOWN_OUTPUT}`);
    console.log(`Feature gate: ${promotion.featureGatePassed ? 'PASS' : 'FAIL'}`);
    console.log(`ECR release gate: ${promotion.releaseGatePassed ? 'PASS' : 'FAIL'}`);
    console.log(`Promotion: ${promotion.promotionPassed ? 'PASS' : 'FAIL'}`);
  } finally {
    connection.closeSync();
  }
}

export const backtestInternals = {
  createRoster,
  deriveRosterRules,
  missingRequiredSlots,
  isLegalCandidate,
  rosterAdjustedModelScore,
  calculateStarterPoints,
  evaluatePromotionGates,
};

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    console.error('Recommendation backtest failed:', error);
    process.exit(1);
  });
}
