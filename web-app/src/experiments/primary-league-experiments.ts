import type {
  FantasyProsSnapshot,
  NFLTeam,
  Player,
  Position,
  Roster,
  RosterRequirements,
  ScoringRules,
  TeamEnvironment,
} from '@fantasy-draft/shared';
import {
  DEFAULT_ROSTER_REQUIREMENTS,
  DEFAULT_SCORING_RULES,
} from '@fantasy-draft/shared';
import fantasyProsJson from '../../../data/fantasypros-snapshot.json';
import identityJson from '../../../data/player-identity.json';
import keeperJson from '../../../data/league-history/current-keepers.json';
import sleeperJson from '../../../data/sleeper-adp.json';
import survivalModelJson from '../../../data/league-history/survival-model.json';
import teamEnvironmentJson from '../../../data/team-environment.json';
import { calculateAllScarcityScores } from '../lib/calculations/scarcity';
import { getRecommendations } from '../lib/calculations/recommendations';
import {
  mergePlayerData,
  normalizePlayerName,
  type PlayerIdentityData,
  type SleeperADPPlayer,
} from '../lib/calculations/player-value';
import { applyLeagueSurvivalModel, type LeagueSurvivalModel } from '../lib/calculations/survival';
import { calculateTeamNeeds } from '../lib/calculations/team-needs';
import {
  estimateMockSurvivalProbabilities,
  formatRoundPick,
  getKeeperAtPick,
  getTeamIndexForPick,
  selectCpuPlayer,
  type MockDraftEngineConfig,
  type MockDraftPickLike,
  type MockKeeperAssignment,
  type MockLeagueHistoryModel,
} from '../lib/mock-draft-engine';

type CorePosition = 'QB' | 'RB' | 'WR' | 'TE';

interface SleeperFile {
  readonly players: readonly SleeperADPPlayer[];
}

interface TeamEnvironmentFile {
  readonly teams: Record<NFLTeam, TeamEnvironment>;
}

interface IdentityFile {
  readonly players: readonly PlayerIdentityData[];
}

interface KeeperFile {
  readonly keepers: readonly {
    readonly playerName: string;
    readonly position: Position;
    readonly team: number;
    readonly round: number;
    readonly isMyKeeper?: boolean;
  }[];
}

interface ExperimentPolicy {
  readonly id: string;
  readonly label: string;
  readonly selectionMode?: 'best-pick' | 'best-player';
  readonly forceByRound?: Readonly<Partial<Record<number, CorePosition>>>;
  readonly positionTiming?: {
    readonly position: CorePosition;
    readonly targetRound: number;
  };
}

interface OpponentProfile {
  readonly id: string;
  readonly label: string;
  readonly randomness: number;
  readonly historyModel: MockLeagueHistoryModel | null;
  readonly positionPressure?: CorePosition;
}

interface AuditDecision {
  readonly pickNumber: number;
  readonly roundPick: string;
  readonly bestPickId: string;
  readonly bestPickName: string;
  readonly bestPickPosition: Position;
  readonly bestPickEcr: number;
  readonly bestPlayerId: string;
  readonly bestPlayerName: string;
  readonly bestPlayerPosition: Position;
  readonly bestPlayerEcr: number;
  readonly ecrGap: number;
  readonly diverged: boolean;
  readonly withinBoundary: boolean;
  readonly feasibilityException: boolean;
  readonly factors: readonly string[];
}

interface DraftOutcome {
  readonly starterProjectedPoints: number;
  readonly starterVor: number;
  readonly rosterProjectedPoints: number;
  readonly firstFourPositions: string;
  readonly firstFourPlayers: string;
  readonly qbRound: number | null;
  readonly qbName: string | null;
  readonly qbProjectedPoints: number | null;
  readonly teRound: number | null;
  readonly teName: string | null;
  readonly teProjectedPoints: number | null;
  readonly first50PositionCounts: Readonly<Record<CorePosition, number>>;
  readonly audit: readonly AuditDecision[];
}

interface MetricSummary {
  readonly mean: number;
  readonly p10: number;
  readonly p90: number;
  readonly meanConfidenceInterval95: {
    readonly lower: number;
    readonly upper: number;
  };
}

interface StrategySummary {
  readonly id: string;
  readonly label: string;
  readonly iterations: number;
  readonly starterProjectedPoints: MetricSummary;
  readonly starterVor: MetricSummary;
  readonly rosterProjectedPoints: MetricSummary;
  readonly pairedStarterPointsDeltaVsBestPick?: MetricSummary;
  readonly mostCommonOpenings: readonly {
    readonly positions: string;
    readonly rate: number;
  }[];
  readonly mostCommonFirstFourPlayers: readonly {
    readonly players: string;
    readonly rate: number;
  }[];
  readonly averageFirst50PositionCounts: Readonly<Record<CorePosition, number>>;
  readonly qb: {
    readonly averageRound: number | null;
    readonly mostCommonPlayers: readonly { readonly player: string; readonly rate: number }[];
    readonly averageProjectedPoints: number | null;
  };
  readonly te: {
    readonly averageRound: number | null;
    readonly mostCommonPlayers: readonly { readonly player: string; readonly rate: number }[];
    readonly averageProjectedPoints: number | null;
  };
}

interface ExperimentInputs {
  readonly players: readonly Player[];
  readonly keepers: readonly MockKeeperAssignment[];
  readonly historyModel: LeagueSurvivalModel & MockLeagueHistoryModel;
  readonly config: Omit<MockDraftEngineConfig, 'randomness' | 'seed'>;
  readonly myTeamIndex: number;
  readonly myKeeper: MockKeeperAssignment;
}

interface ExperimentScale {
  readonly tournamentIterations: number;
  readonly timingIterations: number;
  readonly stressIterations: number;
  readonly sensitivityIterations: number;
  readonly scoringIterations: number;
  readonly waitMapIterations: number;
}

export interface PrimaryLeagueExperimentOptions {
  readonly seed?: number;
  readonly scale?: Partial<ExperimentScale>;
}

export interface PrimaryLeagueExperimentReport {
  readonly generatedAt: string;
  readonly experimentVersion: string;
  readonly parameters: {
    readonly seed: number;
    readonly draftSlot: number;
    readonly totalTeams: number;
    readonly totalRounds: number;
    readonly keeper: {
      readonly playerName: string;
      readonly position: Position;
      readonly round: number;
    };
    readonly scale: ExperimentScale;
  };
  readonly openingPlanTournament: {
    readonly strategies: readonly StrategySummary[];
    readonly projectedPointsLeader: string;
    readonly robustLeader: string;
  };
  readonly takeNowOrWaitMap: {
    readonly representativeSeed: number;
    readonly decisions: readonly TakeWaitDecision[];
  };
  readonly qbAndTeTiming: {
    readonly qb: readonly StrategySummary[];
    readonly te: readonly StrategySummary[];
  };
  readonly positionalRunStressTest: {
    readonly scenarios: readonly StrategySummary[];
  };
  readonly opponentModelSensitivity: {
    readonly scenarios: readonly StrategySummary[];
    readonly openingAgreementRate: number;
  };
  readonly scoringRuleAblation: {
    readonly scenarios: readonly ScoringScenarioSummary[];
    readonly largestPlayerAdjustments: readonly PlayerScoringAdjustment[];
  };
  readonly bestPickAudit: BestPickAuditSummary;
  readonly limitations: readonly string[];
}

interface TakeWaitCandidate {
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly ecrRank: number;
  readonly projectedPoints: number;
  readonly returnProbability: number;
  readonly recommendation: 'take-now' | 'decision-zone' | 'likely-to-return' | 'last-pick';
  readonly isBestPick: boolean;
  readonly isBestPlayer: boolean;
}

interface TakeWaitDecision {
  readonly pickNumber: number;
  readonly roundPick: string;
  readonly selectedPlayer: string;
  readonly selectedPosition: Position;
  readonly nextPickNumber: number | null;
  readonly candidates: readonly TakeWaitCandidate[];
}

interface ScoringScenarioSummary {
  readonly id: string;
  readonly label: string;
  readonly strategy: StrategySummary;
  readonly averageFirstFourPositionCounts: Readonly<Record<CorePosition, number>>;
}

interface PlayerScoringAdjustment {
  readonly playerName: string;
  readonly position: Position;
  readonly primaryLeaguePoints: number;
  readonly standardPprPoints: number;
  readonly adjustment: number;
}

interface BestPickAuditSummary {
  readonly decisions: number;
  readonly divergences: number;
  readonly divergenceRate: number;
  readonly policyDivergences: number;
  readonly policyDivergenceRate: number;
  readonly averageEcrGapWhenDiverged: number;
  readonly maximumEcrGap: number;
  readonly boundaryViolations: number;
  readonly feasibilityExceptions: number;
  readonly feasibilityDivergences: number;
  readonly factorCounts: Readonly<Record<string, number>>;
  readonly divergenceByRound: readonly {
    readonly round: number;
    readonly decisions: number;
    readonly divergences: number;
    readonly rate: number;
  }[];
  readonly commonDivergences: readonly {
    readonly bestPlayer: string;
    readonly bestPick: string;
    readonly count: number;
  }[];
  readonly commonFeasibilityRescues: readonly {
    readonly bestPlayer: string;
    readonly bestPick: string;
    readonly count: number;
  }[];
  readonly bestPickVsBestPlayer: {
    readonly starterProjectedPointsDelta: number;
    readonly starterVorDelta: number;
    readonly pairedStarterPointsDelta95: {
      readonly lower: number;
      readonly upper: number;
    };
  };
}

const CORE_POSITIONS: readonly CorePosition[] = ['QB', 'RB', 'WR', 'TE'];
const DEFAULT_SCALE: ExperimentScale = {
  tournamentIterations: 150,
  timingIterations: 100,
  stressIterations: 100,
  sensitivityIterations: 100,
  scoringIterations: 100,
  waitMapIterations: 400,
};

const leagueAdjustedPlayerCache = new WeakMap<
  ExperimentInputs,
  Map<number, readonly Player[]>
>();

function round(value: number, digits: number = 2): number {
  return Number(value.toFixed(digits));
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function quantile(values: readonly number[], probability: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(1, probability)) * (sorted.length - 1);
  const lower = sorted[Math.floor(index)] ?? 0;
  const upper = sorted[Math.ceil(index)] ?? lower;
  return lower + (upper - lower) * (index - Math.floor(index));
}

function summarizeMetric(values: readonly number[]): MetricSummary {
  const average = mean(values);
  const variance = values.length <= 1
    ? 0
    : values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
      (values.length - 1);
  const margin = 1.96 * Math.sqrt(variance / Math.max(1, values.length));
  return {
    mean: round(average),
    p10: round(quantile(values, 0.1)),
    p90: round(quantile(values, 0.9)),
    meanConfidenceInterval95: {
      lower: round(average - margin),
      upper: round(average + margin),
    },
  };
}

function topRates(values: readonly string[], limit: number): readonly {
  readonly players: string;
  readonly rate: number;
}[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([players, count]) => ({ players, rate: round(count / Math.max(1, values.length), 3) }));
}

function topPlayerRates(values: readonly (string | null)[], limit: number): readonly {
  readonly player: string;
  readonly rate: number;
}[] {
  return topRates(values.filter((value): value is string => value !== null), limit)
    .map(({ players, rate }) => ({ player: players, rate }));
}

function cloneScoringRules(overrides: {
  readonly rushAttemptBonus: number;
  readonly tePremium: number;
}): ScoringRules {
  return {
    ...DEFAULT_SCORING_RULES,
    passing: { ...DEFAULT_SCORING_RULES.passing },
    rushing: {
      ...DEFAULT_SCORING_RULES.rushing,
      attemptBonus: overrides.rushAttemptBonus,
    },
    receiving: {
      ...DEFAULT_SCORING_RULES.receiving,
      tePremium: overrides.tePremium,
    },
    kicking: { ...DEFAULT_SCORING_RULES.kicking },
    defense: {
      ...DEFAULT_SCORING_RULES.defense,
      pointsAllowed: { ...DEFAULT_SCORING_RULES.defense.pointsAllowed },
    },
    misc: { ...DEFAULT_SCORING_RULES.misc },
  };
}

function buildPlayers(scoringRules: ScoringRules): Player[] {
  const fantasyPros = fantasyProsJson as unknown as FantasyProsSnapshot;
  const sleeper = sleeperJson as unknown as SleeperFile;
  const environments = teamEnvironmentJson as unknown as TeamEnvironmentFile;
  const identities = identityJson as unknown as IdentityFile;
  return mergePlayerData(
    fantasyPros.rankings,
    fantasyPros.projections,
    fantasyPros.news,
    sleeper.players,
    environments.teams,
    {
      fantasyProsAdp: fantasyPros.adp ?? [],
      identities: identities.players,
      leagueContext: {
        scoringRules,
        totalTeams: 10,
        rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS,
      },
    }
  ).filter((player) =>
    player.position !== 'DEF' &&
    (player.position === 'K' ? player.positionalRank <= 20 : player.ecrRank <= 260)
  );
}

function resolveKeepers(players: readonly Player[]): MockKeeperAssignment[] {
  const keeperFile = keeperJson as unknown as KeeperFile;
  return keeperFile.keepers.map((keeper) => {
    const match = players.find((player) =>
      player.position === keeper.position &&
      normalizePlayerName(player.name) === normalizePlayerName(keeper.playerName)
    );
    if (!match) throw new Error(`Missing keeper player: ${keeper.playerName}`);
    return {
      playerId: match.id,
      playerName: match.name,
      position: match.position,
      teamIndex: keeper.team - 1,
      round: keeper.round,
    };
  });
}

function createInputs(players: readonly Player[] = buildPlayers(DEFAULT_SCORING_RULES)): ExperimentInputs {
  const keeperFile = keeperJson as unknown as KeeperFile;
  const myKeeperEntry = keeperFile.keepers.find((keeper) => keeper.isMyKeeper);
  if (!myKeeperEntry) throw new Error('The Primary League keeper file has no isMyKeeper entry.');
  const keepers = resolveKeepers(players);
  const myKeeper = keepers.find((keeper) =>
    keeper.teamIndex === myKeeperEntry.team - 1 && keeper.round === myKeeperEntry.round
  );
  if (!myKeeper) throw new Error(`Could not resolve my keeper: ${myKeeperEntry.playerName}`);
  return {
    players,
    keepers,
    historyModel: survivalModelJson as unknown as LeagueSurvivalModel & MockLeagueHistoryModel,
    config: {
      totalTeams: 10,
      totalRounds: 14,
      myPickPosition: myKeeperEntry.team,
      rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS,
    },
    myTeamIndex: myKeeperEntry.team - 1,
    myKeeper,
  };
}

function createRoster(playerIds: ReadonlySet<string>, playersById: ReadonlyMap<string, Player>): Roster {
  const roster: Record<Position, string[]> = {
    QB: [], RB: [], WR: [], TE: [], K: [], DEF: [],
  };
  for (const playerId of playerIds) {
    const player = playersById.get(playerId);
    if (player) roster[player.position].push(playerId);
  }
  return roster;
}

function getLeagueAdjustedPlayers(
  experiment: ExperimentInputs,
  currentPick: number
): readonly Player[] {
  let byPick = leagueAdjustedPlayerCache.get(experiment);
  if (!byPick) {
    byPick = new Map<number, readonly Player[]>();
    leagueAdjustedPlayerCache.set(experiment, byPick);
  }
  const cached = byPick.get(currentPick);
  if (cached) return cached;
  const adjusted = applyLeagueSurvivalModel(
    experiment.players,
    experiment.historyModel,
    {
      currentPick,
      myPickPosition: experiment.config.myPickPosition,
      totalTeams: experiment.config.totalTeams,
      totalRounds: experiment.config.totalRounds,
    }
  );
  byPick.set(currentPick, adjusted);
  return adjusted;
}

function rosterCounts(roster: Roster): Readonly<Record<Position, number>> {
  return {
    QB: roster.QB.length,
    RB: roster.RB.length,
    WR: roster.WR.length,
    TE: roster.TE.length,
    K: roster.K.length,
    DEF: roster.DEF.length,
  };
}

function getSelectedStarters(
  rosterPlayers: readonly Player[],
  requirements: RosterRequirements
): readonly Player[] {
  const used = new Set<string>();
  const starters: Player[] = [];
  const add = (candidates: readonly Player[], count: number): void => {
    [...candidates]
      .sort((left, right) => right.projectedPoints - left.projectedPoints || left.ecrRank - right.ecrRank)
      .slice(0, count)
      .forEach((player) => {
        used.add(player.id);
        starters.push(player);
      });
  };
  for (const position of ['QB', 'RB', 'WR', 'TE', 'K'] as const) {
    add(
      rosterPlayers.filter((player) => player.position === position),
      requirements[position].starters
    );
  }
  add(
    rosterPlayers.filter((player) =>
      requirements.FLEX.eligiblePositions.includes(player.position) && !used.has(player.id)
    ),
    requirements.FLEX.starters
  );
  return starters;
}

function pressureOpponentPlayers(
  players: readonly Player[],
  position: CorePosition | undefined
): readonly Player[] {
  if (!position) return players;
  return players.map((player) => player.position === position
    ? {
        ...player,
        leagueAdjustedMarketRank: Math.max(
          1,
          (player.leagueAdjustedMarketRank ?? player.marketAdp) - 18
        ),
      }
    : player
  );
}

function getForcedPosition(
  policy: ExperimentPolicy,
  roundNumber: number,
  roster: Roster
): CorePosition | undefined {
  const forced = policy.forceByRound?.[roundNumber];
  if (forced) return forced;
  const timing = policy.positionTiming;
  if (!timing || roundNumber !== timing.targetRound || roster[timing.position].length > 0) {
    return undefined;
  }
  return timing.position;
}

function shouldDeferPosition(
  policy: ExperimentPolicy,
  roundNumber: number,
  position: Position
): boolean {
  return policy.positionTiming?.position === position &&
    roundNumber < policy.positionTiming.targetRound;
}

function getAuditFactors(player: Player | undefined, decisionFactors: AuditDecisionFactors): string[] {
  if (!player) return [];
  const factors: string[] = [];
  if (decisionFactors.leagueValue) factors.push('league-value');
  if (decisionFactors.rosterFit) factors.push('roster-fit');
  if (decisionFactors.tierSupply) factors.push('tier-supply');
  if (decisionFactors.draftTiming) factors.push('draft-timing');
  return factors;
}

interface AuditDecisionFactors {
  readonly leagueValue: boolean;
  readonly rosterFit: boolean;
  readonly tierSupply: boolean;
  readonly draftTiming: boolean;
}

function runDraft(input: {
  readonly experiment: ExperimentInputs;
  readonly policy: ExperimentPolicy;
  readonly opponent: OpponentProfile;
  readonly seed: number;
  readonly waitMap?: {
    readonly iterations: number;
    readonly decisions: TakeWaitDecision[];
  };
}): DraftOutcome {
  const { experiment, policy, opponent } = input;
  const config: MockDraftEngineConfig = {
    ...experiment.config,
    randomness: opponent.randomness,
    seed: input.seed,
  };
  const playersById = new Map(experiment.players.map((player) => [player.id, player]));
  const opponentPlayers = pressureOpponentPlayers(
    experiment.players,
    opponent.positionPressure
  );
  const drafted = new Set(experiment.keepers.map((keeper) => keeper.playerId));
  const history: MockDraftPickLike[] = [];
  const myRosterIds = new Set(
    experiment.keepers
      .filter((keeper) => keeper.teamIndex === experiment.myTeamIndex)
      .map((keeper) => keeper.playerId)
  );
  const userPicks: { readonly pickNumber: number; readonly player: Player }[] = [];
  const audit: AuditDecision[] = [];
  const totalPicks = config.totalTeams * config.totalRounds;

  for (let pickNumber = 1; pickNumber <= totalPicks; pickNumber += 1) {
    const keeper = getKeeperAtPick(experiment.keepers, pickNumber, config.totalTeams);
    if (keeper) {
      history.push({
        pickNumber,
        playerId: keeper.playerId,
        playerName: keeper.playerName,
        position: keeper.position,
        teamIndex: keeper.teamIndex,
        source: 'keeper',
      });
      continue;
    }

    const teamIndex = getTeamIndexForPick(pickNumber, config.totalTeams);
    if (teamIndex !== experiment.myTeamIndex) {
      const selection = selectCpuPlayer({
        players: opponentPlayers,
        draftedPlayerIds: drafted,
        history,
        keepers: experiment.keepers,
        currentPick: pickNumber,
        config,
        historyModel: opponent.historyModel,
        iterationSalt: input.seed,
      });
      if (!selection) throw new Error(`No CPU selection at pick ${String(pickNumber)}.`);
      drafted.add(selection.player.id);
      history.push({
        pickNumber,
        playerId: selection.player.id,
        playerName: selection.player.name,
        position: selection.player.position,
        teamIndex,
        source: 'cpu',
      });
      continue;
    }

    const leagueAdjusted = getLeagueAdjustedPlayers(experiment, pickNumber);
    const available = leagueAdjusted.filter((player) => !drafted.has(player.id));
    const roster = createRoster(myRosterIds, playersById);
    const counts = rosterCounts(roster);
    const needs = calculateTeamNeeds(
      roster,
      config.rosterRequirements,
      calculateAllScarcityScores(available),
      {
        currentPick: pickNumber,
        totalPicks,
        totalRounds: config.totalRounds,
      }
    );
    const recommendations = getRecommendations(
      available,
      needs,
      available.length,
      {
        currentPick: pickNumber,
        totalPicks,
        totalTeams: config.totalTeams,
        isMyTurn: true,
        architecture: 'best-pick-policy',
        requirements: config.rosterRequirements,
        rosterCounts: counts,
        selectionsRemaining: Math.max(0, config.totalRounds - myRosterIds.size),
      }
    );
    const recommendedIds = new Set(recommendations.draftNow.map((candidate) => candidate.playerId));
    const canonicalBestPick = recommendations.draftNow[0];
    const canonicalBestPlayer = recommendations.bestAvailable.find((candidate) =>
      recommendedIds.has(candidate.playerId)
    ) ?? recommendations.bestAvailable[0];
    if (!canonicalBestPick || !canonicalBestPlayer) {
      throw new Error(`No user recommendation at pick ${String(pickNumber)}.`);
    }

    const bestPickPlayer = available.find((player) => player.id === canonicalBestPick.playerId);
    const bestPlayer = available.find((player) => player.id === canonicalBestPlayer.playerId);
    if (!bestPickPlayer || !bestPlayer) {
      throw new Error(`Recommendation player missing at pick ${String(pickNumber)}.`);
    }
    const decisionFactors = canonicalBestPick.decisionFactors;
    const factorFlags: AuditDecisionFactors = {
      leagueValue: decisionFactors?.leagueValue.materiallyChangedOrdering ?? false,
      rosterFit: decisionFactors?.rosterFit.materiallyChangedOrdering ?? false,
      tierSupply: decisionFactors?.tierSupply.materiallyChangedOrdering ?? false,
      draftTiming: decisionFactors?.draftTiming.materiallyChangedOrdering ?? false,
    };
    audit.push({
      pickNumber,
      roundPick: formatRoundPick(pickNumber, config.totalTeams),
      bestPickId: bestPickPlayer.id,
      bestPickName: bestPickPlayer.name,
      bestPickPosition: bestPickPlayer.position,
      bestPickEcr: bestPickPlayer.ecrRank,
      bestPlayerId: bestPlayer.id,
      bestPlayerName: bestPlayer.name,
      bestPlayerPosition: bestPlayer.position,
      bestPlayerEcr: bestPlayer.ecrRank,
      ecrGap: bestPickPlayer.ecrRank - bestPlayer.ecrRank,
      diverged: bestPickPlayer.id !== bestPlayer.id,
      withinBoundary: decisionFactors?.conservativeBoundary.withinBoundary ?? true,
      feasibilityException: decisionFactors?.conservativeBoundary.feasibilityException ?? false,
      factors: getAuditFactors(bestPickPlayer, factorFlags),
    });

    if (input.waitMap) {
      const probabilities = estimateMockSurvivalProbabilities({
        players: experiment.players,
        draftedPlayerIds: drafted,
        history,
        keepers: experiment.keepers,
        currentPick: pickNumber,
        config,
        historyModel: opponent.historyModel,
        iterations: input.waitMap.iterations,
        iterationOffset: pickNumber * input.waitMap.iterations,
      });
      const nextUserPick = canonicalBestPick.diagnostics?.nextPickNumber ?? null;
      const candidateIds = new Set([
        ...recommendations.draftNow.slice(0, 5).map((candidate) => candidate.playerId),
        canonicalBestPlayer.playerId,
      ]);
      const candidates = available
        .filter((player) => candidateIds.has(player.id))
        .sort((left, right) => left.ecrRank - right.ecrRank)
        .map((player): TakeWaitCandidate => {
          const returnProbability = probabilities[player.id] ?? 0;
          return {
            playerId: player.id,
            playerName: player.name,
            position: player.position,
            ecrRank: player.ecrRank,
            projectedPoints: round(player.projectedPoints),
            returnProbability,
            recommendation: nextUserPick === null
              ? 'last-pick'
              : returnProbability <= 0.25
                ? 'take-now'
                : returnProbability <= 0.65
                  ? 'decision-zone'
                  : 'likely-to-return',
            isBestPick: player.id === canonicalBestPick.playerId,
            isBestPlayer: player.id === canonicalBestPlayer.playerId,
          };
        });
      input.waitMap.decisions.push({
        pickNumber,
        roundPick: formatRoundPick(pickNumber, config.totalTeams),
        selectedPlayer: bestPickPlayer.name,
        selectedPosition: bestPickPlayer.position,
        nextPickNumber: nextUserPick,
        candidates,
      });
    }

    const roundNumber = Math.ceil(pickNumber / config.totalTeams);
    const forcedPosition = getForcedPosition(policy, roundNumber, roster);
    const candidates = recommendations.draftNow.filter((candidate) => {
      if (forcedPosition) return candidate.position === forcedPosition;
      return !shouldDeferPosition(policy, roundNumber, candidate.position);
    });
    const selectedRecommendation = forcedPosition
      ? candidates[0] ?? canonicalBestPick
      : policy.selectionMode === 'best-player'
        ? recommendations.bestAvailable.find((candidate) =>
            recommendedIds.has(candidate.playerId) &&
            !shouldDeferPosition(policy, roundNumber, candidate.position)
          ) ?? candidates[0] ?? canonicalBestPick
        : candidates[0] ?? canonicalBestPick;
    const selected = available.find((player) => player.id === selectedRecommendation.playerId);
    if (!selected) throw new Error(`Selected player missing at pick ${String(pickNumber)}.`);
    drafted.add(selected.id);
    myRosterIds.add(selected.id);
    userPicks.push({ pickNumber, player: selected });
    history.push({
      pickNumber,
      playerId: selected.id,
      playerName: selected.name,
      position: selected.position,
      teamIndex,
      source: 'manual',
    });
  }

  const rosterPlayers = [...myRosterIds]
    .flatMap((playerId) => {
      const player = playersById.get(playerId);
      return player ? [player] : [];
    });
  const starters = getSelectedStarters(rosterPlayers, config.rosterRequirements);
  const firstFour = userPicks.slice(0, 4);
  const qbPick = userPicks.find(({ player }) => player.position === 'QB');
  const tePick = userPicks.find(({ player }) => player.position === 'TE');
  const first50 = history.filter((pick) => pick.source !== 'keeper').slice(0, 50);
  const first50PositionCounts = Object.fromEntries(CORE_POSITIONS.map((position) => [
    position,
    first50.filter((pick) => pick.position === position).length,
  ])) as Record<CorePosition, number>;

  return {
    starterProjectedPoints: round(starters.reduce((sum, player) => sum + player.projectedPoints, 0)),
    starterVor: round(starters.reduce((sum, player) => sum + player.valueOverReplacement, 0)),
    rosterProjectedPoints: round(rosterPlayers.reduce((sum, player) => sum + player.projectedPoints, 0)),
    firstFourPositions: firstFour.map(({ player }) => player.position).join('-'),
    firstFourPlayers: firstFour.map(({ player }) => player.name).join(' / '),
    qbRound: qbPick ? Math.ceil(qbPick.pickNumber / config.totalTeams) : null,
    qbName: qbPick?.player.name ?? null,
    qbProjectedPoints: qbPick ? round(qbPick.player.projectedPoints) : null,
    teRound: tePick ? Math.ceil(tePick.pickNumber / config.totalTeams) : null,
    teName: tePick?.player.name ?? null,
    teProjectedPoints: tePick ? round(tePick.player.projectedPoints) : null,
    first50PositionCounts,
    audit,
  };
}

function summarizeStrategy(
  policy: ExperimentPolicy,
  outcomes: readonly DraftOutcome[],
  baseline?: readonly DraftOutcome[]
): StrategySummary {
  const averageFirst50PositionCounts = Object.fromEntries(CORE_POSITIONS.map((position) => [
    position,
    round(mean(outcomes.map((outcome) => outcome.first50PositionCounts[position]))),
  ])) as Record<CorePosition, number>;
  const qbRounds = outcomes.flatMap((outcome) => outcome.qbRound === null ? [] : [outcome.qbRound]);
  const teRounds = outcomes.flatMap((outcome) => outcome.teRound === null ? [] : [outcome.teRound]);
  const qbPoints = outcomes.flatMap((outcome) =>
    outcome.qbProjectedPoints === null ? [] : [outcome.qbProjectedPoints]
  );
  const tePoints = outcomes.flatMap((outcome) =>
    outcome.teProjectedPoints === null ? [] : [outcome.teProjectedPoints]
  );
  return {
    id: policy.id,
    label: policy.label,
    iterations: outcomes.length,
    starterProjectedPoints: summarizeMetric(outcomes.map((outcome) => outcome.starterProjectedPoints)),
    starterVor: summarizeMetric(outcomes.map((outcome) => outcome.starterVor)),
    rosterProjectedPoints: summarizeMetric(outcomes.map((outcome) => outcome.rosterProjectedPoints)),
    ...(baseline && baseline.length === outcomes.length
      ? {
          pairedStarterPointsDeltaVsBestPick: summarizeMetric(
            outcomes.map((outcome, index) =>
              outcome.starterProjectedPoints - (baseline[index]?.starterProjectedPoints ?? 0)
            )
          ),
        }
      : {}),
    mostCommonOpenings: topRates(outcomes.map((outcome) => outcome.firstFourPositions), 3)
      .map(({ players: positions, rate }) => ({ positions, rate })),
    mostCommonFirstFourPlayers: topRates(
      outcomes.map((outcome) => outcome.firstFourPlayers),
      3
    ),
    averageFirst50PositionCounts,
    qb: {
      averageRound: qbRounds.length > 0 ? round(mean(qbRounds)) : null,
      mostCommonPlayers: topPlayerRates(outcomes.map((outcome) => outcome.qbName), 3),
      averageProjectedPoints: qbPoints.length > 0 ? round(mean(qbPoints)) : null,
    },
    te: {
      averageRound: teRounds.length > 0 ? round(mean(teRounds)) : null,
      mostCommonPlayers: topPlayerRates(outcomes.map((outcome) => outcome.teName), 3),
      averageProjectedPoints: tePoints.length > 0 ? round(mean(tePoints)) : null,
    },
  };
}

function runPolicyBatch(input: {
  readonly experiment: ExperimentInputs;
  readonly policy: ExperimentPolicy;
  readonly opponent: OpponentProfile;
  readonly iterations: number;
  readonly seed: number;
}): DraftOutcome[] {
  return Array.from({ length: input.iterations }, (_, index) => runDraft({
    experiment: input.experiment,
    policy: input.policy,
    opponent: input.opponent,
    seed: input.seed + index,
  }));
}

function auditBestPick(
  bestPickOutcomes: readonly DraftOutcome[],
  bestPlayerOutcomes: readonly DraftOutcome[]
): BestPickAuditSummary {
  const decisions = bestPickOutcomes.flatMap((outcome) => outcome.audit);
  const divergences = decisions.filter((decision) => decision.diverged);
  const policyDivergences = divergences.filter((decision) => !decision.feasibilityException);
  const feasibilityRescues = divergences.filter((decision) => decision.feasibilityException);
  const factorCounts = new Map<string, number>();
  for (const decision of policyDivergences) {
    for (const factor of decision.factors) {
      factorCounts.set(factor, (factorCounts.get(factor) ?? 0) + 1);
    }
  }
  const rounds = new Map<number, AuditDecision[]>();
  for (const decision of decisions) {
    const roundNumber = Math.ceil(decision.pickNumber / 10);
    rounds.set(roundNumber, [...(rounds.get(roundNumber) ?? []), decision]);
  }
  const countPairs = (items: readonly AuditDecision[]): Map<string, number> => {
    const result = new Map<string, number>();
    for (const decision of items) {
      const key = `${decision.bestPlayerName}\0${decision.bestPickName}`;
      result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
  };
  const pairs = countPairs(policyDivergences);
  const rescuePairs = countPairs(feasibilityRescues);
  const summarizePairs = (items: ReadonlyMap<string, number>): readonly {
    readonly bestPlayer: string;
    readonly bestPick: string;
    readonly count: number;
  }[] => [...items.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([key, count]) => {
      const [bestPlayer = '', bestPick = ''] = key.split('\0');
      return { bestPlayer, bestPick, count };
    });
  const pairedStarterDeltas = bestPickOutcomes.map((outcome, index) =>
    outcome.starterProjectedPoints - (bestPlayerOutcomes[index]?.starterProjectedPoints ?? 0)
  );
  const pairedVorDeltas = bestPickOutcomes.map((outcome, index) =>
    outcome.starterVor - (bestPlayerOutcomes[index]?.starterVor ?? 0)
  );
  const deltaSummary = summarizeMetric(pairedStarterDeltas);
  return {
    decisions: decisions.length,
    divergences: divergences.length,
    divergenceRate: round(divergences.length / Math.max(1, decisions.length), 3),
    policyDivergences: policyDivergences.length,
    policyDivergenceRate: round(policyDivergences.length / Math.max(1, decisions.length), 3),
    averageEcrGapWhenDiverged: round(mean(policyDivergences.map((decision) => decision.ecrGap))),
    maximumEcrGap: Math.max(0, ...policyDivergences.map((decision) => decision.ecrGap)),
    boundaryViolations: decisions.filter((decision) =>
      !decision.withinBoundary && !decision.feasibilityException
    ).length,
    feasibilityExceptions: decisions.filter((decision) => decision.feasibilityException).length,
    feasibilityDivergences: feasibilityRescues.length,
    factorCounts: Object.fromEntries([...factorCounts.entries()].sort()),
    divergenceByRound: [...rounds.entries()]
      .sort(([left], [right]) => left - right)
      .map(([roundNumber, roundDecisions]) => {
        const roundDivergences = roundDecisions.filter((decision) => decision.diverged).length;
        return {
          round: roundNumber,
          decisions: roundDecisions.length,
          divergences: roundDivergences,
          rate: round(roundDivergences / roundDecisions.length, 3),
        };
      }),
    commonDivergences: summarizePairs(pairs),
    commonFeasibilityRescues: summarizePairs(rescuePairs),
    bestPickVsBestPlayer: {
      starterProjectedPointsDelta: round(mean(pairedStarterDeltas)),
      starterVorDelta: round(mean(pairedVorDeltas)),
      pairedStarterPointsDelta95: deltaSummary.meanConfidenceInterval95,
    },
  };
}

function averageFirstFourPositionCounts(
  outcomes: readonly DraftOutcome[]
): Record<CorePosition, number> {
  const counts = Object.fromEntries(CORE_POSITIONS.map((position) => [position, 0])) as Record<
    CorePosition,
    number
  >;
  for (const outcome of outcomes) {
    for (const position of outcome.firstFourPositions.split('-') as CorePosition[]) {
      if (CORE_POSITIONS.includes(position)) counts[position] += 1;
    }
  }
  for (const position of CORE_POSITIONS) counts[position] = round(counts[position] / outcomes.length);
  return counts;
}

export function runPrimaryLeagueExperiments(
  options: PrimaryLeagueExperimentOptions = {}
): PrimaryLeagueExperimentReport {
  const seed = options.seed ?? 20260831;
  const scale: ExperimentScale = { ...DEFAULT_SCALE, ...options.scale };
  const experiment = createInputs();
  const baselineOpponent: OpponentProfile = {
    id: 'league-history',
    label: 'League history',
    randomness: 0.55,
    historyModel: experiment.historyModel,
  };

  const openingPolicies: readonly ExperimentPolicy[] = [
    { id: 'best-pick', label: 'Best Pick', selectionMode: 'best-pick' },
    { id: 'best-player', label: 'Best Player', selectionMode: 'best-player' },
    { id: 'wr-wr', label: 'WR-WR start', forceByRound: { 1: 'WR', 2: 'WR' } },
    { id: 'rb-rb', label: 'RB-RB start', forceByRound: { 1: 'RB', 2: 'RB' } },
    { id: 'wr-rb', label: 'WR-RB start', forceByRound: { 1: 'WR', 2: 'RB' } },
    { id: 'rb-wr', label: 'RB-WR start', forceByRound: { 1: 'RB', 2: 'WR' } },
    { id: 'elite-te', label: 'TE in round 2', forceByRound: { 2: 'TE' } },
    { id: 'early-qb', label: 'QB in round 3', forceByRound: { 3: 'QB' } },
  ];
  const openingOutcomes = new Map<string, DraftOutcome[]>();
  for (const policy of openingPolicies) {
    openingOutcomes.set(policy.id, runPolicyBatch({
      experiment,
      policy,
      opponent: baselineOpponent,
      iterations: scale.tournamentIterations,
      seed,
    }));
  }
  const bestPickOutcomes = openingOutcomes.get('best-pick') ?? [];
  const openingSummaries = openingPolicies.map((policy) => summarizeStrategy(
    policy,
    openingOutcomes.get(policy.id) ?? [],
    policy.id === 'best-pick' ? undefined : bestPickOutcomes
  ));
  const pointsLeader = [...openingSummaries].sort((left, right) =>
    right.starterProjectedPoints.mean - left.starterProjectedPoints.mean
  )[0];
  const robustLeader = [...openingSummaries].sort((left, right) =>
    right.starterProjectedPoints.p10 - left.starterProjectedPoints.p10
  )[0];

  const timingPolicies = (position: CorePosition, rounds: readonly number[]): ExperimentPolicy[] =>
    rounds.map((targetRound) => ({
      id: `${position.toLowerCase()}-round-${String(targetRound)}`,
      label: `${position} in round ${String(targetRound)}`,
      positionTiming: { position, targetRound },
    }));
  const qbPolicies = timingPolicies('QB', [3, 5, 8]);
  const tePolicies = timingPolicies('TE', [2, 5, 8]);
  const summarizeTiming = (policies: readonly ExperimentPolicy[]): StrategySummary[] =>
    policies.map((policy) => summarizeStrategy(
      policy,
      runPolicyBatch({
        experiment,
        policy,
        opponent: baselineOpponent,
        iterations: scale.timingIterations,
        seed: seed + 10_000,
      })
    ));

  const stressProfiles: readonly OpponentProfile[] = [
    baselineOpponent,
    ...CORE_POSITIONS.map((position): OpponentProfile => ({
      id: `${position.toLowerCase()}-run`,
      label: `${position} run`,
      randomness: 0.55,
      historyModel: experiment.historyModel,
      positionPressure: position,
    })),
  ];
  const bestPickPolicy = openingPolicies[0];
  if (!bestPickPolicy) throw new Error('Best Pick policy missing.');
  const stressSummaries = stressProfiles.map((opponent) => summarizeStrategy(
    { id: opponent.id, label: opponent.label },
    runPolicyBatch({
      experiment,
      policy: bestPickPolicy,
      opponent,
      iterations: scale.stressIterations,
      seed: seed + 20_000,
    })
  ));

  const positionOnlyHistory: MockLeagueHistoryModel = {
    positions: experiment.historyModel.positions,
  };
  const sensitivityProfiles: readonly OpponentProfile[] = [
    baselineOpponent,
    { id: 'market-only', label: 'Market only', randomness: 0.55, historyModel: null },
    { id: 'league-no-manager', label: 'League, no manager tendencies', randomness: 0.55, historyModel: positionOnlyHistory },
    { id: 'chalk', label: 'Low-randomness chalk', randomness: 0.2, historyModel: experiment.historyModel },
    { id: 'chaos', label: 'High-randomness room', randomness: 0.9, historyModel: experiment.historyModel },
  ];
  const sensitivitySummaries = sensitivityProfiles.map((opponent) => summarizeStrategy(
    { id: opponent.id, label: opponent.label },
    runPolicyBatch({
      experiment,
      policy: bestPickPolicy,
      opponent,
      iterations: scale.sensitivityIterations,
      seed: seed + 30_000,
    })
  ));
  const sensitivityTopOpenings = sensitivitySummaries.map((summary) =>
    summary.mostCommonOpenings[0]?.positions ?? ''
  );
  const openingMode = topRates(sensitivityTopOpenings, 1)[0];

  const scoringDefinitions = [
    { id: 'standard-ppr', label: 'Standard PPR', rushAttemptBonus: 0, tePremium: 0 },
    { id: 'rush-only', label: 'PPR plus rush-attempt bonus', rushAttemptBonus: 0.2, tePremium: 0 },
    { id: 'te-only', label: 'PPR plus TE premium', rushAttemptBonus: 0, tePremium: 0.5 },
    { id: 'primary-league', label: 'Primary League scoring', rushAttemptBonus: 0.2, tePremium: 0.5 },
  ] as const;
  const scoringPlayers = new Map<string, readonly Player[]>();
  const scoringScenarios = scoringDefinitions.map((definition): ScoringScenarioSummary => {
    const players = definition.id === 'primary-league'
      ? experiment.players
      : buildPlayers(cloneScoringRules(definition));
    scoringPlayers.set(definition.id, players);
    const scoringExperiment = createInputs(players);
    const scoringOpponent: OpponentProfile = {
      ...baselineOpponent,
      historyModel: scoringExperiment.historyModel,
    };
    const outcomes = runPolicyBatch({
      experiment: scoringExperiment,
      policy: bestPickPolicy,
      opponent: scoringOpponent,
      iterations: scale.scoringIterations,
      seed: seed + 40_000,
    });
    return {
      id: definition.id,
      label: definition.label,
      strategy: summarizeStrategy(
        { id: definition.id, label: definition.label },
        outcomes
      ),
      averageFirstFourPositionCounts: averageFirstFourPositionCounts(outcomes),
    };
  });
  const standardPlayersById = new Map(
    (scoringPlayers.get('standard-ppr') ?? []).map((player) => [player.id, player])
  );
  const largestPlayerAdjustments = experiment.players
    .flatMap((player): PlayerScoringAdjustment[] => {
      const standard = standardPlayersById.get(player.id);
      return standard
        ? [{
            playerName: player.name,
            position: player.position,
            primaryLeaguePoints: round(player.projectedPoints),
            standardPprPoints: round(standard.projectedPoints),
            adjustment: round(player.projectedPoints - standard.projectedPoints),
          }]
        : [];
    })
    .sort((left, right) => right.adjustment - left.adjustment || left.playerName.localeCompare(right.playerName))
    .slice(0, 20);

  const waitMapDecisions: TakeWaitDecision[] = [];
  runDraft({
    experiment,
    policy: bestPickPolicy,
    opponent: baselineOpponent,
    seed: seed + 50_000,
    waitMap: {
      iterations: scale.waitMapIterations,
      decisions: waitMapDecisions,
    },
  });

  return {
    generatedAt: new Date().toISOString(),
    experimentVersion: 'primary-league-draft-experiments-v1',
    parameters: {
      seed,
      draftSlot: experiment.config.myPickPosition,
      totalTeams: experiment.config.totalTeams,
      totalRounds: experiment.config.totalRounds,
      keeper: {
        playerName: experiment.myKeeper.playerName,
        position: experiment.myKeeper.position,
        round: experiment.myKeeper.round,
      },
      scale,
    },
    openingPlanTournament: {
      strategies: openingSummaries,
      projectedPointsLeader: pointsLeader?.id ?? 'unknown',
      robustLeader: robustLeader?.id ?? 'unknown',
    },
    takeNowOrWaitMap: {
      representativeSeed: seed + 50_000,
      decisions: waitMapDecisions,
    },
    qbAndTeTiming: {
      qb: summarizeTiming(qbPolicies),
      te: summarizeTiming(tePolicies),
    },
    positionalRunStressTest: { scenarios: stressSummaries },
    opponentModelSensitivity: {
      scenarios: sensitivitySummaries,
      openingAgreementRate: round((openingMode?.rate ?? 0)),
    },
    scoringRuleAblation: {
      scenarios: scoringScenarios,
      largestPlayerAdjustments,
    },
    bestPickAudit: auditBestPick(
      bestPickOutcomes,
      openingOutcomes.get('best-player') ?? []
    ),
    limitations: [
      'The tournament measures current projected roster acquisition, not realized 2026 fantasy points.',
      'Opponent choices come from a calibrated heuristic. Monte Carlo intervals measure room variance, not model uncertainty.',
      'Forced opening and timing plans test position constraints. They do not prove that a named player will be available.',
      'The take-now-or-wait map follows one reproducible Best Pick room state and should be regenerated after rankings, keepers, or draft order change.',
      'Best Pick remains ECR-anchored. These experiments do not promote the separate experimental prediction model.',
    ],
  };
}

export const __testables = {
  summarizeMetric,
};
