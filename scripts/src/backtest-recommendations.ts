import { decodeBacktestLeagueHistory, decodeBacktestTrainingRows, type BacktestTrainingRow } from './script-file-schemas.js';
import { readContractSignalEvidence, writeRecommendationEvaluation } from './recommendation-evaluation.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Position } from '@fantasy-draft/shared/league';
import type { RosterRequirements } from '@fantasy-draft/shared/league';
import {
  applyPositionTiers,
  getRecommendations,
  type RecommendationContext,
} from '@fantasy-draft/shared/draft';
import { asProbability, asRank, asVor } from '@fantasy-draft/shared/units';
import {
  PICK_EV_MIN_OVERRIDE_ADVANTAGE,
  scorePickEvBoard,
  selectPickEvRecommendation,
  type PickEvLayers,
} from './research/pick-ev.js';
import {
  BACKTESTS_MODEL_DIR,
  DATA_DIR,
  REPO_ROOT,
  connectModelDbReadOnly,
} from './model/duckdb.js';
import {
  FLEX_GROUPS,
  OFFENSIVE_POSITIONS,
  calculateLeagueScoringAdjustment,
  getHistoricalLeagueScoringAdjustments,
  sqlPositionList,
  type OffensivePosition,
} from '@fantasy-draft/shared/league';
import {
  POSITION_FEATURES,
  POSITION_MODEL_CANDIDATE_SET_VERSION,
  POSITION_MODEL_LAMBDA_CANDIDATES,
  POSITION_MODEL_SPECIFICATIONS,
  POSITION_MODEL_VOLUME_THRESHOLD_CANDIDATES,
  fitPositionResidualModel,
  fitPositionResidualModelForSeason,
  MIN_TRAINING_ROWS,
  predictPositionResidual,
  type PositionResidualRow,
} from './model/position-residual-model.js';
import {
  aggregateCounterfactualSeasons,
  simulateCounterfactualSeason,
  type CounterfactualDraftMetrics,
  type CounterfactualSeason,
  type CounterfactualSimulationSummary,
} from './counterfactual-draft-simulator.js';
import {
  calculateStarterPoints as calculateSharedStarterPoints,
  createOffensiveRoster,
  deriveRosterRules,
  isLegalCandidate as isLegalOffensiveCandidate,
  missingRequiredSlots,
  POSITION_MAXIMUMS,
  rosterAdjustedValue,
  type OffensiveRoster,
  type RosterRules,
} from './offensive-roster.js';
import {
  assertBestPickGateRecorded,
  assertBestPickPolicyUnchanged,
  BEST_PICK_GATE_TOLERANCE,
  BEST_PICK_POLICY_ROOTS,
  bestPickGateFailures,
  bestPickReplayEntryChain,
  bestPickReplayProblems,
  hashBestPickPolicySources,
  nextBestPickGate,
  parseBestPickGateBlocks,
  renderBestPickGateBlocks,
} from './best-pick-backtest-gate.js';
import {
  PROSPECTIVE_FIRST_SEASON,
  REGULAR_SEASON_GAMES,
  fullSeasonPace,
  isRegularSeasonComplete,
  type ProspectiveSeasonStatus,
} from './model/prospective-fold.js';
import { trailingHistorySql, trailingPlayerVolumeSql } from './model/trailing-features-sql.js';
import { access } from 'node:fs/promises';

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

type TrainingRow = BacktestTrainingRow;

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

type RecommendationRoster = OffensiveRoster<PlayerSeason>;

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

interface PromotionGateResult {
  readonly featureGatePassed: boolean;
  readonly featureGateChecks: {
    readonly outOfSampleStarterPointsImprovePreviousModel: boolean;
  };
  readonly releaseGatePassed: boolean;
  readonly releaseGateChecks: {
    readonly seasonsWon: boolean;
    readonly aggregateStarterPointsBeatEcr: boolean;
    readonly aggregateVorBeatEcr: boolean;
    readonly averageRegretBeatEcr: boolean;
    readonly top24HitRateNonInferior: boolean;
    readonly noSeasonStarterRegressionOver15Percent: boolean;
  };
  readonly promotionPassed: boolean;
  readonly seasonsWon: number;
  readonly seasonsRequired: number;
  readonly seasonsExpected: number;
  readonly hasAllReleaseSeasons: boolean;
  readonly worstStarterRegression: number;
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
  readonly roster: RecommendationRoster;
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

function createRoster(): RecommendationRoster {
  return createOffensiveRoster<PlayerSeason>();
}

function addToRoster(roster: RecommendationRoster, player: PlayerSeason): void {
  roster[player.position].push(player);
}

function rosterLabel(roster: RecommendationRoster): string {
  return OFFENSIVE_POSITIONS.map((position) => `${position}${String(roster[position].length)}`).join(' ');
}

function pickEvRequirements(rules: RosterRules): RosterRequirements {
  const fixedSlots = Object.values(rules.fixedStarters).reduce((sum, count) => sum + count, 0);
  return {
    QB: { starters: rules.fixedStarters.QB, max: POSITION_MAXIMUMS.QB },
    RB: { starters: rules.fixedStarters.RB, max: POSITION_MAXIMUMS.RB },
    WR: { starters: rules.fixedStarters.WR, max: POSITION_MAXIMUMS.WR },
    TE: { starters: rules.fixedStarters.TE, max: POSITION_MAXIMUMS.TE },
    FLEX: { starters: rules.flexStarters, eligiblePositions: [...FLEX_GROUPS.standard] },
    K: { starters: 0, max: 0 },
    DEF: { starters: 0, max: 0 },
    BENCH: { spots: Math.max(0, rules.totalOffensiveSlots - fixedSlots - rules.flexStarters) },
  };
}

function isLegalCandidate(
  candidate: PlayerSeason,
  roster: RecommendationRoster,
  rules: RosterRules,
  remainingPicksIncludingCurrent: number
): boolean {
  return isLegalOffensiveCandidate(candidate, roster, rules, remainingPicksIncludingCurrent);
}

function rosterAdjustedModelScore(
  candidate: PlayerSeason,
  valueOverReplacement: number,
  roster: RecommendationRoster,
  rules: RosterRules
): number {
  return rosterAdjustedValue(candidate, valueOverReplacement, roster, rules);
}

function chooseEcr(
  available: readonly PlayerSeason[],
  roster: RecommendationRoster,
  rules: RosterRules,
  remainingPicks: number
): PlayerSeason | undefined {
  return [...available]
    .filter((candidate) => isLegalCandidate(candidate, roster, rules, remainingPicks))
    .sort((a, b) => asNumber(a.predraft_ecr) - asNumber(b.predraft_ecr))[0];
}

function chooseModel(
  available: readonly PlayerSeason[],
  roster: RecommendationRoster,
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
  roster: RecommendationRoster,
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
  roster: RecommendationRoster,
  rules: RosterRules,
  remainingPicks: number,
  currentPick: number,
  nextPick: number | null,
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
    nextPickSurvivalProbability: nextPick === null
      ? 0
      : estimateConditionalSurvival(asNumber(candidate.predraft_ecr), currentPick, nextPick),
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
    PICK_EV_MIN_OVERRIDE_ADVANTAGE
  );
  return legal.find((candidate) => candidate.sleeper_player_id === selection.playerId);
}

type BoardPlayer = Parameters<typeof getRecommendations>[0][number];
type BestPickTuning = NonNullable<RecommendationContext['bestPickTuning']>;

/** The starter weights 09781a5 shipped and the backtest rejected: a 12-rank starter window and a doubled late bonus. */
const REJECTED_BEST_PICK_TUNING: BestPickTuning = { starterEcrNeighborhood: 12, lateStarterWeight: 2 };

function ceilingProxy(player: PlayerSeason): number {
  return Math.min(10, 5 + Math.max(0, 2 - player.history_seasons) * 1.5);
}

function projectionProxy(player: PlayerSeason): number {
  return player.baselineProjectedPoints ?? Math.max(0, player.baselineModelScore);
}

/**
 * One season's board as the app's players. Only draft-day information goes in: the expert rank, the walk-forward
 * projection and its value over replacement. Everything the app reads from live feeds takes a neutral value.
 */
function buildBestPickBoard(rows: readonly PlayerSeason[]): ReadonlyMap<string, BoardPlayer> {
  const positionRanks = new Map<string, number>();
  const players = [...rows]
    .sort((a, b) => asNumber(a.predraft_ecr) - asNumber(b.predraft_ecr))
    .map((row): BoardPlayer => {
      const rank = asNumber(row.predraft_ecr);
      const positionRank = (positionRanks.get(row.position) ?? 0) + 1;
      positionRanks.set(row.position, positionRank);
      const uncertainty = 3 + Math.max(0, 2 - row.history_seasons) * 0.8;
      return {
        id: row.sleeper_player_id,
        name: row.player_name,
        position: row.position,
        // Best Pick never reads the team; the type only needs a valid code.
        team: 'ARI',
        byeWeek: 0,
        ecrRank: asRank(rank),
        positionalRank: asRank(positionRank),
        sleeperAdp: rank,
        valueScore: 0,
        marketRank: rank,
        marketAdp: rank,
        marketAdpTrend: 0,
        isContractYear: false,
        offensiveEnvironmentScore: 5,
        projectedPoints: projectionProxy(row),
        valueOverReplacement: asVor(row.baselineModelScore),
        tier: 1,
        tierDropoffScore: 0,
        nextPickSurvivalProbability: asProbability(0.5),
        ceilingScore: ceilingProxy(row),
        floorScore: 5,
        upsideScore: 5,
        uncertaintyScore: uncertainty,
        injuryRiskScore: 2,
        predictionSource: 'heuristic',
        newsStatus: 'healthy',
        stackPartnerTeam: 'ARI',
        highlightLevel: 'neutral',
      };
    });
  return new Map(applyPositionTiers(players).map((player) => [player.id, player]));
}

/** Replays the shipped Best Pick: the same call the Assistant makes, on the historical board. */
function chooseBestPick(
  available: readonly PlayerSeason[],
  board: ReadonlyMap<string, BoardPlayer>,
  roster: RecommendationRoster,
  rules: RosterRules,
  remainingPicks: number,
  currentPick: number,
  nextPick: number | null,
  totalTeams: number,
  totalPicks: number,
  tuning?: BestPickTuning
): PlayerSeason | undefined {
  const legal = available.filter((candidate) =>
    isLegalCandidate(candidate, roster, rules, remainingPicks)
  );
  const players = legal.flatMap((candidate) => {
    const player = board.get(candidate.sleeper_player_id);
    return player
      ? [{
          ...player,
          nextPickSurvivalProbability: asProbability(nextPick === null
            ? 0
            : estimateConditionalSurvival(asNumber(candidate.predraft_ecr), currentPick, nextPick)),
        }]
      : [];
  });
  const result = getRecommendations(players, [], 1, {
    currentPick,
    totalPicks,
    totalTeams,
    isMyTurn: true,
    requirements: pickEvRequirements(rules),
    rosterPlayers: OFFENSIVE_POSITIONS.flatMap((position) =>
      roster[position].map((player) => ({
        id: player.sleeper_player_id,
        position: player.position,
        projectedPoints: projectionProxy(player),
        ceilingScore: ceilingProxy(player),
      }))
    ),
    rosterCounts: {
      QB: roster.QB.length,
      RB: roster.RB.length,
      WR: roster.WR.length,
      TE: roster.TE.length,
    },
    selectionsRemaining: remainingPicks,
    ...(tuning ? { bestPickTuning: tuning } : {}),
  });
  const preferred = result.selection.preferredPlayerId;
  return legal.find((candidate) => candidate.sleeper_player_id === preferred);
}

function getResidualFeatures(
  row: TrainingRow & { position: OffensivePosition }
): Readonly<Record<string, number | null>> {
  const featureNames = row.position === 'QB'
    ? POSITION_FEATURES.QB
    : row.position === 'RB'
      ? POSITION_FEATURES.RB
      : row.position === 'WR'
        ? POSITION_FEATURES.WR
        : POSITION_FEATURES.TE;
  return Object.fromEntries(
    featureNames.map((featureName) => [featureName, row[featureName] ?? null])
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

/** Key of one player's season in the scoring lookup. */
function playerSeasonKey(season: number, playerId: string): string {
  return `${String(season)}|${playerId}`;
}

/**
 * Board rows for the replay, plus `scoringRows`: the board and every requested off-board player (no rank, or ranked
 * past 250). Off-board rows never enter the fit, the centers or replacement levels, and are never candidates; they
 * exist so the picks and keepers that drafted them still score against the board's replacement level.
 */
function addDerivedValues(rows: readonly TrainingRow[], scoringKeys: ReadonlySet<string> = new Set()): {
  readonly playerSeasons: PlayerSeason[];
  readonly scoringRows: PlayerSeason[];
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
  ): ReturnType<typeof fitPositionResidualModel> | null => {
    const key = `${String(season)}|${position}`;
    const cached = modelCache.get(key);
    if (cached) return cached;
    const trainingRowCount = residualRows.filter(
      (row) => row.position === position && row.season < season
    ).length;
    if (trainingRowCount < MIN_TRAINING_ROWS) return null;
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
    if (model === null) return 0;
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
    if (model === null) return 0;
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
  const deriveBase = (
    row: TrainingRow & { sleeper_player_id: string; position: OffensivePosition }
  ): PlayerSeason => {
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
    // An unranked off-board player projects from the bottom of the board, not from rank 0.
    const sharedProjectedPoints =
      getSharedPprProjection(row.predraft_ecr === null ? { ...row, predraft_ecr: 300 } : row) + estimatedCustomBonus;
    const positionModel = getWalkForwardModel(row.season, row.position);
    let fittedResidual = 0;
    if (positionModel !== null) {
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
      fittedResidual = clippedResidual - getClippedResidualCenter(row.season, row.position);
    }
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
  };
  const baseRows: PlayerSeason[] = eligible.map(deriveBase);

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

  const eligibleRows = new Set<TrainingRow>(eligible);
  const offBoardRows = rows
    .filter((row): row is TrainingRow & { sleeper_player_id: string; position: OffensivePosition } =>
      Boolean(row.sleeper_player_id) &&
      isOffensivePosition(row.position) &&
      !eligibleRows.has(row) &&
      scoringKeys.has(playerSeasonKey(row.season, row.sleeper_player_id ?? ''))
    )
    .map(deriveBase)
    .map((row) => {
      const positionRows = baseRows
        .filter((candidate) => candidate.season === row.season && candidate.position === row.position);
      const replacementAt = (score: (candidate: PlayerSeason) => number): number =>
        positionRows.map(score).sort((a, b) => b - a)[REPLACEMENT_POSITION_RANKS[row.position] - 1] ?? 0;
      return {
        ...row,
        customPositionRank:
          positionRows.filter((candidate) => candidate.leagueActualPoints > row.leagueActualPoints).length + 1,
        leagueActualVor: row.leagueActualPoints - replacementAt((candidate) => candidate.leagueActualPoints),
        baselineModelScore: row.baselineModelScore - replacementAt((candidate) => candidate.baselineModelScore),
        transparentModelScore:
          row.transparentModelScore - replacementAt((candidate) => candidate.transparentModelScore),
      };
    });
  return { playerSeasons, scoringRows: [...playerSeasons, ...offBoardRows], modelCache };
}

interface UserTurn {
  readonly pickNo: number;
  /** The user's offensive non-keeper picks from this one on; specialist and keeper picks are not turns. */
  readonly remainingPicks: number;
  /** The drafted player's scoring row, undefined only when the player has no outcome row at all. */
  readonly chosenRow: PlayerSeason | undefined;
}

/**
 * The user's side of one replayed draft: keeper rows, in league-history order, that start every strategy's roster,
 * and one turn per offensive non-keeper user pick, keyed by its index in the picks sorted by pick number. Players
 * resolve through the scoring lookup, so off-board picks and keepers score even though they were never on the board.
 */
function planUserTurns(
  picks: ReadonlyArray<{
    readonly pickNo: number;
    readonly playerId: string;
    readonly position: Position;
    readonly isUserPick: boolean;
    readonly isKeeper: boolean;
  }>,
  scoring: ReadonlyMap<string, PlayerSeason>
): { readonly keeperRows: PlayerSeason[]; readonly turns: ReadonlyMap<number, UserTurn> } {
  type Pick = (typeof picks)[number];
  const isUserOffensive = (pick: Pick): boolean => pick.isUserPick && isOffensivePosition(pick.position);
  const sortedPicks = [...picks].sort((a, b) => a.pickNo - b.pickNo);
  const keeperRows = picks
    .filter((pick) => isUserOffensive(pick) && pick.isKeeper)
    .flatMap((pick) => scoring.get(pick.playerId) ?? []);
  const turnIndexes = sortedPicks.flatMap((pick, index) => isUserOffensive(pick) && !pick.isKeeper ? [index] : []);
  const turns = new Map(turnIndexes.map((pickIndex, position) => {
    const pick = sortedPicks[pickIndex] as Pick;
    return [pickIndex, {
      pickNo: pick.pickNo,
      remainingPicks: turnIndexes.length - position,
      chosenRow: scoring.get(pick.playerId),
    }] as const;
  }));
  return { keeperRows, turns };
}

function calculateStarterPoints(roster: RecommendationRoster, rules: RosterRules): number {
  return calculateSharedStarterPoints(
    roster,
    rules,
    (player) => player.sleeper_player_id,
    (player) => player.leagueActualPoints
  );
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
  strategies: PromotionStrategyMetrics,
  release: { readonly seasonsExpected: number; readonly seasonsRequired: number } = {
    seasonsExpected: OUTER_TEST_SEASONS.length,
    seasonsRequired: RELEASE_SEASONS_REQUIRED,
  }
): PromotionGateResult {
  const seasonsWon = seasons.filter(
    (season) =>
      season.strategies.rosterAwareModel.starterPoints >
      season.strategies.rosterAwareEcr.starterPoints
  ).length;
  const hasAllReleaseSeasons = seasons.length === release.seasonsExpected;
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
      hasAllReleaseSeasons && seasonsWon >= release.seasonsRequired,
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
    seasonsRequired: release.seasonsRequired,
    seasonsExpected: release.seasonsExpected,
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

type ModelConnection = Awaited<ReturnType<typeof connectModelDbReadOnly>>;

/** Feature columns a prospective row shares with the training rows, rebuilt from the seasons before it. */
const PROSPECTIVE_FEATURE_COLUMNS = [
  'trailing_points_per_game_3yr', 'trailing_expected_points_per_game_3yr',
  'trailing_pass_attempts_per_game_3yr', 'trailing_rush_attempts_per_game_3yr',
  'trailing_targets_per_game_3yr', 'trailing_player_volume_3yr', 'trailing_target_share_3yr',
  'trailing_air_yards_share_3yr', 'trailing_offense_snap_share_3yr', 'trailing_offense_snaps_per_game_3yr',
  'trailing_pressure_rate_3yr', 'trailing_pressure_time_to_throw_3yr', 'trailing_number_pass_rushers_3yr',
  'trailing_dropback_participation_per_game_3yr', 'trailing_charted_route_targets_per_game_3yr',
  'trailing_targets_per_dropback_participation_3yr', 'trailing_deep_route_target_share_3yr',
  'trailing_screen_route_target_share_3yr', 'trailing_goal_line_carries_per_game_3yr',
  'trailing_goal_line_targets_per_game_3yr', 'trailing_completion_percentage_above_expectation_3yr',
  'trailing_avg_time_to_throw_3yr', 'trailing_avg_intended_air_yards_3yr', 'trailing_avg_separation_3yr',
  'trailing_avg_yac_above_expectation_3yr', 'trailing_expected_rush_points_per_game_3yr',
  'trailing_expected_tds_per_game_3yr', 'trailing_rush_yards_over_expected_per_attempt_3yr',
  'trailing_rush_pct_over_expected_3yr',
] as const;

interface ProspectiveFoldInput {
  readonly season: number;
  readonly status: ProspectiveSeasonStatus;
  readonly complete: boolean;
  readonly boardPlayers: number;
  readonly rankingsAfterDraft: number;
  /** Drafted offensive players with no draft-day rank, added so their picks and keepers still score. */
  readonly unrankedDrafted: number;
}

interface ProspectiveLoad {
  readonly rows: TrainingRow[];
  readonly folds: ProspectiveFoldInput[];
  readonly skipped: string[];
}

function finiteOrNull(value: unknown): number | null {
  const number = typeof value === 'bigint' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

/**
 * Board rows for each prospective season. The pool and positions come from the draft-day ranking snapshot: the
 * latest DynastyProcess scrape made before the draft started, selected after that cutoff is applied, plus every
 * offensive player the room drafted. Trailing features are rebuilt from the three training seasons before it, keyed
 * by gsis_id with the workload input chosen by the draft-day position, so they never depend on who is in today's
 * player pool or on a later position change. Season-to-date nflverse outcomes are scaled to a full-season pace by
 * team games. Only the season after the last training season can be built, because its trailing features need
 * every earlier season.
 */
async function loadProspectiveRows(
  connection: ModelConnection,
  seasons: ReadonlyArray<{
    readonly season: number;
    readonly draftStartTimestamp?: string | undefined;
    readonly picks: ReadonlyArray<{ readonly playerId: string; readonly playerName: string; readonly position: Position }>;
  }>
): Promise<ProspectiveLoad> {
  const skipped: string[] = [];
  if (seasons.length === 0) return { rows: [], folds: [], skipped };
  const tables = new Set((await connection.runAndReadAll(
    `select table_name from information_schema.tables where table_schema = 'model'`
  )).getRowObjects().map((row) => String(row.table_name)));
  if (!tables.has('prospective_player_outcomes') || !tables.has('prospective_season_status')) {
    return {
      rows: [],
      folds: [],
      skipped: ['Prospective outcomes are not built; run `pnpm model:prospective`.'],
    };
  }
  const lastTrainingSeason = finiteOrNull((await connection.runAndReadAll(
    'select max(season) as season from model.prediction_training_dataset'
  )).getRowObjects()[0]?.season);
  const rows: TrainingRow[] = [];
  const folds: ProspectiveFoldInput[] = [];
  for (const { season, draftStartTimestamp, picks } of seasons) {
    if (lastTrainingSeason === null || season !== lastTrainingSeason + 1) {
      skipped.push(
        `${String(season)}: the training dataset ends in ${String(lastTrainingSeason ?? 'no season')}, ` +
        'so trailing features for this season cannot be rebuilt.'
      );
      continue;
    }
    if (!draftStartTimestamp || Number.isNaN(Date.parse(draftStartTimestamp))) {
      skipped.push(`${String(season)}: the league history has no draft start time to cut rankings at.`);
      continue;
    }
    const statusRow = (await connection.runAndReadAll(
      `select * from model.prospective_season_status where season = ${String(season)}`
    )).getRowObjects()[0];
    if (!statusRow) {
      skipped.push(`${String(season)}: no nflverse schedule rows; rerun \`pnpm model:prospective\`.`);
      continue;
    }
    const status: ProspectiveSeasonStatus = {
      season,
      regGamesScheduled: finiteOrNull(statusRow.reg_games_scheduled) ?? 0,
      regGamesPlayed: finiteOrNull(statusRow.reg_games_played) ?? 0,
      regGamesWithStats: finiteOrNull(statusRow.reg_games_with_stats) ?? 0,
      lastWeekPlayed: finiteOrNull(statusRow.last_week_played),
      fetchedAt: String(statusRow.fetched_at),
    };
    const cutoff = sqlTimestamp(draftStartTimestamp);
    const drafted = picks.filter((pick) => isOffensivePosition(pick.position));
    const draftedValues = drafted.length === 0
      ? `select null::varchar as sleeper_player_id, null::varchar as player_name, null::varchar as position
          where false`
      : `select * from (values ${drafted.map((pick) =>
        `(${sqlString(pick.playerId)}, ${sqlString(pick.playerName)}, ${sqlString(pick.position)})`
      ).join(', ')}) as drafted(sleeper_player_id, player_name, position)`;
    const reader = await connection.runAndReadAll(`
      with trained as (
        select gsis_id, min(season) as first_season
        from model.prediction_training_dataset
        where gsis_id is not null
        group by 1
      ), ids as (
        select sleeper_player_id, any_value(gsis_id) as gsis_id
        from model.dynastyprocess_player_ids
        where sleeper_player_id is not null
        group by 1
      ), snapshots as (
        select
          ids.sleeper_player_id::varchar as sleeper_player_id,
          ids.gsis_id::varchar as gsis_id,
          r.player::varchar as player_name,
          r.pos::varchar as position,
          r.page_type::varchar as ranking_type,
          r.ecr::double as predraft_ecr,
          cast(r.scrape_date as date) as scrape_date,
          (cast(r.scrape_date as date) + interval 1 day)::timestamptz <= ${cutoff} as before_draft
        from source.dynastyprocess_rankings r
        join model.dynastyprocess_player_ids ids on r.id::varchar = ids.fantasypros_id
        where r.page_type in ('redraft-overall', 'best-overall')
          and r.pos in ${sqlPositionList(OFFENSIVE_POSITIONS)}
          and ids.sleeper_player_id is not null
          and cast(r.scrape_date as date)
            between make_date(${String(season)}, 5, 1) and make_date(${String(season)}, 9, 10)
      ), rankings as (
        select * from snapshots
        where before_draft
        qualify row_number() over (
          partition by sleeper_player_id
          order by case when ranking_type = 'redraft-overall' then 0 else 1 end, scrape_date desc
        ) = 1
      ), drafted as (
        ${draftedValues}
      ), pool as (
        select sleeper_player_id, gsis_id, player_name, position, predraft_ecr from rankings
        union all
        select drafted.sleeper_player_id, ids.gsis_id, drafted.player_name, drafted.position, null::double
        from drafted
        left join ids on ids.sleeper_player_id = drafted.sleeper_player_id
        where drafted.sleeper_player_id not in (select sleeper_player_id from rankings)
      )
      select
        ${String(season)}::integer as season,
        pool.sleeper_player_id::varchar as sleeper_player_id,
        pool.gsis_id::varchar as gsis_id,
        pool.player_name::varchar as player_name,
        pool.position::varchar as position,
        coalesce(outcomes.games, 0)::double as games,
        coalesce(outcomes.ppr_points, 0)::double as actual_points,
        coalesce(outcomes.rush_attempts, 0)::double as rush_attempts,
        coalesce(outcomes.receptions, 0)::double as receptions,
        outcomes.team_games_played::double as team_games_played,
        outcomes.team_games_scheduled::double as team_games_scheduled,
        pool.predraft_ecr::double as predraft_ecr,
        ${PROSPECTIVE_FEATURE_COLUMNS.map((column) => column === 'trailing_player_volume_3yr'
          ? `(${trailingPlayerVolumeSql('pool.position', 'history')})::double as ${column}`
          : `history.${column}::double as ${column}`).join(',\n        ')},
        least(3, greatest(0, ${String(season)} - coalesce(trained.first_season, ${String(season)})))::integer
          as history_seasons,
        (select count(*) from snapshots where not before_draft)::integer as rankings_after_draft
      from pool
      left join (${trailingHistorySql(season)}) history on history.gsis_id = pool.gsis_id
      left join trained on trained.gsis_id = pool.gsis_id
      left join model.prospective_player_outcomes outcomes
        on outcomes.season = ${String(season)} and outcomes.gsis_id = pool.gsis_id
    `);
    const objects = reader.getRowObjects();
    const decoded = decodeBacktestTrainingRows(objects);
    decoded.forEach((row, index) => {
      const source = objects[index];
      const played = finiteOrNull(source?.team_games_played);
      const scheduled = finiteOrNull(source?.team_games_scheduled);
      const pace = (value: number) => fullSeasonPace(value, played, scheduled);
      rows.push({
        ...row,
        games: pace(row.games),
        actual_points: pace(row.actual_points),
        rush_attempts: pace(row.rush_attempts),
        receptions: pace(row.receptions),
      });
    });
    folds.push({
      season,
      status,
      complete: isRegularSeasonComplete(status),
      boardPlayers: decoded.filter((row) => (row.predraft_ecr ?? Infinity) <= 250).length,
      rankingsAfterDraft: finiteOrNull(objects[0]?.rankings_after_draft) ?? 0,
      unrankedDrafted: decoded.filter((row) => row.predraft_ecr === null).length,
    });
  }
  return { rows, folds, skipped };
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlTimestamp(iso: string): string {
  return `'${new Date(iso).toISOString()}'::timestamptz`;
}

async function main(): Promise<void> {
  // Hash before the replay so the recorded digest describes the code that ran; re-checked before any write.
  bestPickReplayEntryChain();
  const policySourceHash = hashBestPickPolicySources();
  const history = decodeBacktestLeagueHistory(JSON.parse(
    await readFile(join(DATA_DIR, 'league-history', 'leagueDraftHistory.json'), 'utf8')
  ));
  // Read-only and without creating model directories, so a run refused before writing leaves nothing behind.
  const connection = await connectModelDbReadOnly();

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
          case
            when gsis_id is null then null
            else least(3, greatest(
              0,
              season - min(season) over (partition by gsis_id)
            ))::integer
          end as history_seasons,
          row_number() over (
            partition by season, sleeper_player_id, position
            order by case when ranking_type = 'redraft-overall' then 0 else 1 end,
              predraft_ecr asc nulls last
          ) as row_number
        from model.prediction_training_dataset
      ) where row_number = 1
    `);
    const rawRows = decodeBacktestTrainingRows(reader.getRowObjects()).map((row) => ({
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
    const prospectiveSeasonInputs = history.seasons
      .filter((season) => season.season >= PROSPECTIVE_FIRST_SEASON)
      .sort((a, b) => a.season - b.season);
    const prospective = await loadProspectiveRows(connection, prospectiveSeasonInputs);
    // Prospective rows only add seasons after every outer fold: walk-forward fits and centers read earlier or
    // same-season rows, so the 2022–2025 results do not change.
    const draftedKeys = new Set(history.seasons.flatMap((season) =>
      season.picks.map((pick) => playerSeasonKey(season.season, pick.playerId))
    ));
    const { playerSeasons, scoringRows, modelCache } = addDerivedValues(
      [...rawRows, ...prospective.rows],
      draftedKeys
    );
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
        bestPick: StrategyMetrics;
        bestPickRejectedWeights: StrategyMetrics;
      };
      /** Draft pick numbers Best Pick and roster-aware ECR were scored on, for the regression gate. */
      bestPickGatePicks: { readonly bestPick: readonly number[]; readonly rosterAwareEcr: readonly number[] };
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
    const prospectiveFoldSeasons = new Set(prospective.folds.map((fold) => fold.season));
    const prospectiveHistory = sortedHistory.filter((season) => prospectiveFoldSeasons.has(season.season));
    const prospectiveSeasonReports: typeof seasonReports = [];
    for (const season of [...evaluationHistory, ...prospectiveHistory]) {
      const isProspective = prospectiveFoldSeasons.has(season.season);
      const trainingSeasons = sortedHistory
        .filter((candidate) => candidate.season < season.season)
        .map((candidate) => candidate.season);
      const rules = deriveRosterRules(season.rosterPositions);
      const seasonRows = playerSeasons.filter((row) => row.season === season.season);
      const scoringById = new Map(scoringRows
        .filter((row) => row.season === season.season)
        .map((row) => [row.sleeper_player_id, row]));
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
      const bestPickBoard = buildBestPickBoard(seasonRows);
      const bestPickSelected = new Set<string>();
      const bestPickRejectedSelected = new Set<string>();
      const bestPick: StrategyAccumulator = { rows: [], regrets: [], roster: createRoster() };
      const bestPickRejected: StrategyAccumulator = { rows: [], regrets: [], roster: createRoster() };
      const bestPickPickNumbers: number[] = [];
      const ecrPickNumbers: number[] = [];

      const userPlan = planUserTurns(season.picks, scoringById);
      for (const row of userPlan.keeperRows) {
        addToRoster(actual.roster, row);
        addToRoster(ecr.roster, row);
        addToRoster(baseline.roster, row);
        addToRoster(model.roster, row);
        addToRoster(ecrWaitingOnly.roster, row);
        addToRoster(pickEvProjection.roster, row);
        addToRoster(pickEvWaiting.roster, row);
        addToRoster(pickEvOption.roster, row);
        addToRoster(pickEvFull.roster, row);
        addToRoster(bestPick.roster, row);
        addToRoster(bestPickRejected.roster, row);
      }

      const sortedPicks = [...season.picks].sort((a, b) => a.pickNo - b.pickNo);
      for (let index = 0; index < sortedPicks.length; index += 1) {
        const pick = sortedPicks[index];
        if (!pick || pick.isKeeper) continue;
        // Turns and remaining picks follow the user's offensive draft slots, not whether the pick was on the board.
        const turn = userPlan.turns.get(index);
        if (turn) {
          const { remainingPicks, chosenRow } = turn;
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
          )?.pickNo ?? null;
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
              risk: true,
            }
          );
          const bestActual = [...actualAvailable].sort((a, b) => b.leagueActualVor - a.leagueActualVor)[0];
          const bestEcrBoard = [...ecrAvailable].sort((a, b) => b.leagueActualVor - a.leagueActualVor)[0];
          const bestBaselineBoard = [...baselineAvailable]
            .sort((a, b) => b.leagueActualVor - a.leagueActualVor)[0];
          const bestModelBoard = [...modelAvailable].sort((a, b) => b.leagueActualVor - a.leagueActualVor)[0];

          if (chosenRow) {
            actual.rows.push(chosenRow);
            addToRoster(actual.roster, chosenRow);
            actual.regrets.push(Math.max(0, (bestActual?.leagueActualVor ?? 0) - chosenRow.leagueActualVor));
          }
          if (ecrPick) {
            ecrPickNumbers.push(pick.pickNo);
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
          const bestPickAvailable = strategyAvailable(bestPickSelected);
          const bestPickRejectedAvailable = strategyAvailable(bestPickRejectedSelected);
          const bestPickChoice = chooseBestPick(
            bestPickAvailable,
            bestPickBoard,
            bestPick.roster,
            rules,
            remainingPicks,
            pick.pickNo,
            nextUserPick,
            totalTeams,
            totalPicks
          );
          if (bestPickChoice) bestPickPickNumbers.push(pick.pickNo);
          recordPickEv(bestPick, bestPickSelected, bestPickChoice, bestPickAvailable);
          recordPickEv(
            bestPickRejected,
            bestPickRejectedSelected,
            chooseBestPick(
              bestPickRejectedAvailable,
              bestPickBoard,
              bestPickRejected.roster,
              rules,
              remainingPicks,
              pick.pickNo,
              nextUserPick,
              totalTeams,
              totalPicks,
              REJECTED_BEST_PICK_TUNING
            ),
            bestPickRejectedAvailable
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
      (isProspective ? prospectiveSeasonReports : seasonReports).push({
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
          bestPick: summarizePickEv(bestPick),
          bestPickRejectedWeights: summarizePickEv(bestPickRejected),
        },
        bestPickGatePicks: { bestPick: bestPickPickNumbers, rosterAwareEcr: ecrPickNumbers },
        winner: modelMetrics.starterPoints > ecrMetrics.starterPoints
          ? 'model'
          : modelMetrics.starterPoints < ecrMetrics.starterPoints ? 'ecr' : 'tie',
      });

      // The counterfactual room is a diagnostic of the outer folds only.
      if (isProspective) continue;
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
    const bestPickStrategies = {
      bestPick: aggregate(seasonReports.map((season) => season.strategies.bestPick)),
      bestPickRejectedWeights: aggregate(
        seasonReports.map((season) => season.strategies.bestPickRejectedWeights)
      ),
    };
    const bestPickPolicy = {
      description:
        'The shipped Best Pick rule, called through the same function the Assistant uses, on each historical board.',
      inputs:
        'Expert rank, walk-forward projection and value over replacement. Live-feed inputs (news, bye weeks, contract and environment signals) take neutral values.',
      rejectedWeights: REJECTED_BEST_PICK_TUNING,
      strategies: { rosterAwareEcr: strategies.rosterAwareEcr, ...bestPickStrategies },
      deltas: {
        bestPickVsEcr: metricDelta(bestPickStrategies.bestPick, strategies.rosterAwareEcr),
        bestPickVsRejectedWeights: metricDelta(
          bestPickStrategies.bestPick,
          bestPickStrategies.bestPickRejectedWeights
        ),
      },
      seasons: seasonReports.map((season) => ({
        season: season.season,
        rosterAwareEcr: season.strategies.rosterAwareEcr.starterPoints,
        bestPick: season.strategies.bestPick.starterPoints,
        bestPickRejectedWeights: season.strategies.bestPickRejectedWeights.starterPoints,
      })),
    };
    const acceptBestPickBaseline = process.argv.includes('--accept-best-pick-baseline');
    const previousReport = await readFile(MARKDOWN_OUTPUT, 'utf8').catch(() => '');
    const bestPickGate = nextBestPickGate(
      acceptBestPickBaseline
        ? { candidate: undefined, baseline: undefined }
        : parseBestPickGateBlocks(previousReport),
      {
        version: 3,
        policySourceHash,
        folds: seasonReports.map((season) => ({
          season: season.season,
          pickNumbers: season.bestPickGatePicks.bestPick,
        })),
        bestPickVsEcr: bestPickPolicy.deltas.bestPickVsEcr,
      },
      bestPickReplayProblems(seasonReports.map((season) => ({
        season: season.season,
        bestPickPicks: season.bestPickGatePicks.bestPick,
        ecrPicks: season.bestPickGatePicks.rosterAwareEcr,
      }))),
      acceptBestPickBaseline
    );
    assertBestPickGateRecorded(bestPickGate);
    const bestPickGateProblems = bestPickGateFailures(bestPickGate, policySourceHash);
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
      threshold: PICK_EV_MIN_OVERRIDE_ADVANTAGE,
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
    const historicalEvaluations = evaluations.filter((evaluation) => !prospectiveFoldSeasons.has(evaluation.season));
    const prospectiveFolds = await Promise.all(prospective.folds.flatMap((fold) => {
      const seasonReport = prospectiveSeasonReports.find((season) => season.season === fold.season);
      return seasonReport ? [{ fold, seasonReport }] : [];
    }).map(async ({ fold, seasonReport }) => {
      const gate = evaluatePromotionGates([seasonReport], seasonReport.strategies, {
        seasonsExpected: 1,
        seasonsRequired: 1,
      });
      // Seasons won has no meaning for one season; every other release check must pass on its own.
      const { seasonsWon: _seasonsWon, ...singleSeasonChecks } = gate.releaseGateChecks;
      const foldEvaluations = evaluations.filter((evaluation) => evaluation.season === fold.season);
      const foldPicks = prospectiveHistory.find((season) => season.season === fold.season)?.picks ?? [];
      const shadowLogPath = join('data', 'shadow-logs', `${String(fold.season)}-recommendations.ndjson`);
      const shadowLogPresent = await access(join(REPO_ROOT, shadowLogPath)).then(() => true, () => false);
      return {
        season: fold.season,
        status: fold.complete ? 'complete' as const : 'provisional' as const,
        countsTowardReleaseGate: fold.complete,
        regularSeason: {
          gamesScheduled: fold.status.regGamesScheduled,
          gamesPlayed: fold.status.regGamesPlayed,
          gamesWithPlayerStats: fold.status.regGamesWithStats,
          lastWeekPlayed: fold.status.lastWeekPlayed,
          outcomesFetchedAt: fold.status.fetchedAt,
        },
        outcomeBasis: fold.complete
          ? 'Complete regular-season nflverse totals.'
          : 'Season-to-date nflverse regular-season totals from scored games with player stats, scaled to a full-season pace by each player\'s matched team games.',
        boardPlayers: fold.boardPlayers,
        rankingsScrapedAfterDraftExcluded: fold.rankingsAfterDraft,
        unrankedDraftedPlayers: fold.unrankedDrafted,
        coverage: {
          // Picks the actual draft scored, not replay turns: a turn whose player has no outcome row scores nothing.
          evaluatedUserPicks: seasonReport.strategies.actualUserDraft.evaluatedPicks,
          totalUserPicks: foldPicks.filter((pick) => pick.isUserPick && !pick.isKeeper).length,
        },
        strategies: {
          actualUserDraft: seasonReport.strategies.actualUserDraft,
          rosterAwareEcr: seasonReport.strategies.rosterAwareEcr,
          rosterAwareBaselineModel: seasonReport.strategies.rosterAwareBaselineModel,
          rosterAwareModel: seasonReport.strategies.rosterAwareModel,
          bestPick: seasonReport.strategies.bestPick,
        },
        releaseGate: {
          passed: Object.values(singleSeasonChecks).every(Boolean),
          checks: singleSeasonChecks,
        },
        shadowLog: {
          path: shadowLogPath,
          present: shadowLogPresent,
          scored: false,
        },
        evaluations: foldEvaluations,
      };
    }));
    const prospectiveReopenEligible = prospectiveFolds.some(
      (fold) => fold.countsTowardReleaseGate && fold.releaseGate.passed
    );
    const counterfactualStrategies = {
      rosterAwareEcr: aggregateCounterfactualSeasons(ecrCounterfactualIterations),
      rosterAwareModel: aggregateCounterfactualSeasons(modelCounterfactualIterations),
    };
    const counterfactualReport = {
      generatedAt: new Date().toISOString(),
      modelVersion: 'counterfactual-opponent-room-v1',
      provenance: {
        command: 'pnpm model:backtest',
        modelIdentifier: 'counterfactual-opponent-room-v1',
        rankingIdentifier: 'historical-pre-draft-consensus-rank-proxy',
        keeperIdentifier: 'historical-user-keepers-from-league-history',
        historicalInputIdentifier:
          `${String(OUTER_TEST_SEASONS[0])}-${String(OUTER_TEST_SEASONS.at(-1))}-league-history`,
      },
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
        aggregation:
          'Starter points and VOR sum season results at each simulation index. Average regret is weighted by evaluated user picks across those season results.',
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
        evaluatedUserPicks: historicalEvaluations.length,
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
      bestPickPolicy,
      bestPickGate,
      prospective: {
        firstSeason: PROSPECTIVE_FIRST_SEASON,
        reopenEligible: prospectiveReopenEligible,
        folds: prospectiveFolds,
        skipped: prospective.skipped,
      },
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
      evaluations: historicalEvaluations,
    };

    assertBestPickPolicyUnchanged(policySourceHash, hashBestPickPolicySources());
    await mkdir(dirname(JSON_OUTPUT), { recursive: true });
    await mkdir(dirname(MARKDOWN_OUTPUT), { recursive: true });
    await writeFile(JSON_OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(
      COUNTERFACTUAL_JSON_OUTPUT,
      `${JSON.stringify(counterfactualReport, null, 2)}\n`
    );
    await writeRecommendationEvaluation(DATA_DIR, {
      generatedAt: report.generatedAt,
      modelVersion: report.modelVersion,
      pickEvOverrideThreshold: PICK_EV_MIN_OVERRIDE_ADVANTAGE,
      pickEvOverrideValidation,
      evaluatedArchitecture: 'pick-ev-v1',
      pickEvEvaluation: {
        improvesLegacyStarterPoints:
          architectureComparison.incrementalDeltas.fullVsLegacy.starterPoints > 0,
        beatsEcrStarterPoints:
          architectureComparison.incrementalDeltas.fullVsEcr.starterPoints > 0,
        fullVsLegacy: architectureComparison.incrementalDeltas.fullVsLegacy,
        fullVsEcr: architectureComparison.incrementalDeltas.fullVsEcr,
        dataStatus: architectureComparison.dataStatus,
      },
      promotionGates: {
        feature: report.featureGate,
        release: report.releaseGate,
        passed: report.promotion.passed,
      },
      decision: report.promotion.decision,
      ...await readContractSignalEvidence(DATA_DIR),
    });
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
    const metricRow = (name: string, metrics: StrategyMetrics): string =>
      `| ${name} | ${String(metrics.evaluatedPicks)} | ${String(metrics.vorCaptured)} | ` +
      `${String(metrics.starterPoints)} | ${String(metrics.averageRegret)} | ` +
      `${String(metrics.top24PositionHitRate)} |`;
    const prospectiveMetricRows = (fold: (typeof prospectiveFolds)[number]): string => [
      metricRow('Actual user draft', fold.strategies.actualUserDraft),
      metricRow('Roster-aware ECR', fold.strategies.rosterAwareEcr),
      metricRow('Best Pick (shipped)', fold.strategies.bestPick),
      metricRow('Baseline roster-aware model', fold.strategies.rosterAwareBaselineModel),
      metricRow('Roster-aware model', fold.strategies.rosterAwareModel),
    ].join('\n');
    const prospectiveFoldSections = prospectiveFolds.map((fold) => `### ${String(fold.season)}: ${
      fold.status === 'complete' ? 'complete' : '**PROVISIONAL**'
    }

- Regular season: ${String(fold.regularSeason.gamesPlayed)} of ${String(fold.regularSeason.gamesScheduled)} scheduled games scored (${String(REGULAR_SEASON_GAMES)} in a full season); ${String(fold.regularSeason.gamesWithPlayerStats)} matched to weekly player stats, through week ${String(fold.regularSeason.lastWeekPlayed)} (outcomes fetched ${fold.regularSeason.outcomesFetchedAt}).
- ${fold.countsTowardReleaseGate
    ? `Counts toward the release gate: all ${String(REGULAR_SEASON_GAMES)} regular-season games are scored and matched to player stats.`
    : `Excluded from the release gate until all ${String(REGULAR_SEASON_GAMES)} regular-season games are scored and matched to player stats; the numbers move each week.`}
- Outcomes: ${fold.outcomeBasis}
- Coverage: ${String(fold.coverage.evaluatedUserPicks)} of ${String(fold.coverage.totalUserPicks)} user picks scored.
- Board: ${String(fold.boardPlayers)} offensive players ranked inside the top 250 in the last snapshot before the draft; ${String(fold.rankingsScrapedAfterDraftExcluded)} player rankings scraped after the draft started were excluded before that selection; ${String(fold.unrankedDraftedPlayers)} drafted players without a draft-day rank were added so their picks and keepers score.
- Shadow Recommendation log: ${fold.shadowLog.present
    ? `\`${fold.shadowLog.path}\` is present but this report does not score it yet.`
    : `absent (no \`${fold.shadowLog.path}\`), so only the replayed model is scored.`}

| Strategy | Picks | VOR captured | Starter points | Average regret | Top-24 hit rate |
| --- | ---: | ---: | ---: | ---: | ---: |
${prospectiveMetricRows(fold)}

Single-season release gate (model must beat roster-aware ECR on every release check this season; seasons won does not apply): **${fold.releaseGate.passed ? 'pass' : 'fail'}**${
  fold.countsTowardReleaseGate ? '' : ' (provisional, not counted)'}

| Check | Result |
| --- | --- |
${Object.entries(fold.releaseGate.checks).map(([check, passed]) => `| ${check} | ${passed ? 'pass' : 'fail'} |`).join('\n')}
`).join('\n');
    const prospectiveSection = `## Prospective Folds

Seasons drafted after the ${POSITION_MODEL_CANDIDATE_SET_VERSION} declaration was frozen. Their outcomes could not
shape the declaration, so a complete prospective season that passes the release gate is the only evidence that
reopens the model (see [modeling-duckdb.md](./modeling-duckdb.md#status-frozen-as-shadow-recommendation-2026-11-24)).
A fold stays provisional, and outside every gate and aggregate above, until all ${String(REGULAR_SEASON_GAMES)} of its
regular-season games are scored and matched to weekly player stats; completeness comes from nflverse, not a flag. Refresh outcomes with \`pnpm model:prospective\`.

${[
  `- Reopen eligible: **${String(prospectiveReopenEligible)}**`,
  ...prospective.skipped.map((reason) => `- Skipped: ${reason}`),
].join('\n')}

${prospectiveFoldSections || 'No prospective season is available.'}
`;
    const bestPickRows = [
      metricRow('Roster-aware ECR', bestPickPolicy.strategies.rosterAwareEcr),
      metricRow('Best Pick (shipped weights)', bestPickPolicy.strategies.bestPick),
      metricRow('Best Pick (rejected 12/2 weights)', bestPickPolicy.strategies.bestPickRejectedWeights),
    ].join('\n');
    const bestPickDeltaRows = Object.entries(bestPickPolicy.deltas)
      .map(([name, delta]) =>
        `| ${name} | ${String(delta.starterPoints)} | ${String(delta.vorCaptured)} | ` +
        `${String(delta.averageRegret)} | ${String(delta.top24PositionHitRate)} |`
      )
      .join('\n');
    const bestPickSeasonRows = bestPickPolicy.seasons
      .map((season) =>
        `| ${String(season.season)} | ${String(season.rosterAwareEcr)} | ` +
        `${String(season.bestPick)} | ${String(season.bestPickRejectedWeights)} |`
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

Decision (2026-11-24): the prediction model failed this gate, so its feature-family work is frozen and it stays
as Shadow Recommendation logging only. It may be reopened only if the unchanged declaration beats roster-aware
ECR on every release check applied to the completed 2026 prospective fold alone. See [modeling-duckdb.md](./modeling-duckdb.md#status-frozen-as-shadow-recommendation-2026-11-24).

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

${prospectiveSection}
## Best Pick Policy

${bestPickPolicy.description} The rejected-weights row replays the same rule with
the starter window at ${String(REJECTED_BEST_PICK_TUNING.starterEcrNeighborhood)} ranks and the late starter bonus
multiplied by ${String(REJECTED_BEST_PICK_TUNING.lateStarterWeight)}, the tuning 09781a5 shipped and this report
rejected. Negative regret deltas are improvements.

- Inputs: ${bestPickPolicy.inputs}

| Strategy | Picks | VOR captured | Starter points | Average regret | Top-24 hit rate |
| --- | ---: | ---: | ---: | ---: | ---: |
${bestPickRows}

| Comparison | Starter points | VOR captured | Average regret | Top-24 hit rate |
| --- | ---: | ---: | ---: | ---: |
${bestPickDeltaRows}

| Season | Roster-aware ECR | Best Pick | Best Pick, rejected weights |
| ---: | ---: | ---: | ---: |
${bestPickSeasonRows}

### Best Pick regression gate

\`pnpm verify\` checks these records without league data (scripts/src/best-pick-backtest-gate.test.ts). It fails
when either block is missing, when ${BEST_PICK_POLICY_ROOTS.map((path) => `\`${path}\``).join(', ')} and the
shared/src modules they reach through runtime imports no longer hash to the gate block's \`policySourceHash\`, when
the gate block does not cover the 2022–2025 folds with the baseline's draft picks, or when Best Pick's margin over roster-aware ECR is more than
${String(BEST_PICK_GATE_TOLERANCE.vorCaptured)} VOR or ${String(BEST_PICK_GATE_TOLERANCE.averageRegret)} average
regret worse than the accepted baseline. Regenerating copies the baseline block unchanged; only
\`pnpm model:backtest:accept-best-pick\` replaces it with the current replay, so a baseline change is always a
reviewed diff. A partial replay, or one whose Best Pick and ECR picks differ, stops the run before any report is
written.

${[
  `- Gate: **${bestPickGateProblems.length === 0 ? 'pass' : 'fail'}**`,
  ...bestPickGateProblems.map((problem) => `- ${problem}`),
].join('\n')}

${renderBestPickGateBlocks(bestPickGate)}

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
- Historical override gate passed: **${String(report.pickEvOverrideValidation.passed)}**
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

Provenance: command \`${counterfactualReport.provenance.command}\`; model identifier \`${counterfactualReport.provenance.modelIdentifier}\`; ranking identifier \`${counterfactualReport.provenance.rankingIdentifier}\`; keeper identifier \`${counterfactualReport.provenance.keeperIdentifier}\`; historical-input identifier \`${counterfactualReport.provenance.historicalInputIdentifier}\`.

This report is diagnostic. The fixed-board replay remains the release gate
because the counterfactual result depends on the opponent model.

## Aggregate Strategy Comparison

Starter points and VOR are summed season means across the four 1,000-simulation season runs. Regret is the pick-weighted mean across all evaluated user picks.

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
    for (const fold of prospectiveFolds) {
      console.log(
        `Prospective ${String(fold.season)} (${fold.status}): model ${String(fold.strategies.rosterAwareModel.starterPoints)} ` +
        `vs ECR ${String(fold.strategies.rosterAwareEcr.starterPoints)} starter points; ` +
        `release gate ${fold.releaseGate.passed ? 'PASS' : 'FAIL'}${fold.countsTowardReleaseGate ? '' : ' (not counted)'}`
      );
    }
    console.log(`Best Pick regression gate: ${bestPickGateProblems.length === 0 ? 'PASS' : 'FAIL'}`);
    for (const problem of bestPickGateProblems) console.log(`  ${problem}`);
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
  addDerivedValues,
  planUserTurns,
  playerSeasonKey,
  summarize,
  loadProspectiveRows,
  PROSPECTIVE_FEATURE_COLUMNS,
};

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    console.error('Recommendation backtest failed:', error);
    process.exit(1);
  });
}
