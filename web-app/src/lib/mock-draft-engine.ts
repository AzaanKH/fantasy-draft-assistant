import type { Player, Position, RosterRequirements } from '@fantasy-draft/shared';

export type MockPickSource = 'manual' | 'cpu' | 'keeper' | 'sync' | 'provisional';

export interface MockDraftPickLike {
  readonly pickNumber: number;
  readonly playerId: string;
  readonly playerName?: string;
  readonly position: Position;
  readonly teamIndex: number;
  readonly source?: MockPickSource;
}

export interface MockKeeperAssignment {
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly teamIndex: number;
  readonly round: number;
}

export interface MockManagerPositionTendency {
  readonly picks: number;
  readonly pickRate: number;
  readonly earlyPickRate: number;
  readonly leaguePickRateDelta?: number;
}

export interface MockManagerTendency {
  readonly managerKey: string;
  readonly draftSlots: readonly number[];
  readonly sampleSize: number;
  readonly positions: Record<Position, MockManagerPositionTendency>;
}

export interface MockLeagueHistoryModel {
  readonly positions?: Partial<Record<Position, {
    readonly top50RateDelta?: number;
    readonly top100RateDelta?: number;
  }>>;
  readonly managerTendencies?: readonly MockManagerTendency[];
}

export interface MockDraftEngineConfig {
  readonly totalTeams: number;
  readonly totalRounds: number;
  readonly myPickPosition: number;
  readonly rosterRequirements: RosterRequirements;
  /** 0 is nearly deterministic and 1 is the widest plausible top-15 sampler. */
  readonly randomness: number;
  readonly seed: number;
}

export interface CpuScoreComponents {
  readonly marketBehavior: number;
  readonly leagueScoredValue: number;
  readonly rosterNeed: number;
  readonly positionalScarcity: number;
  readonly roundTendency: number;
  readonly managerHistory: number;
  readonly runMomentum: number;
}

export interface ScoredCpuCandidate {
  readonly player: Player;
  readonly score: number;
  readonly components: CpuScoreComponents;
}

export interface SelectCpuPlayerInput {
  readonly players: readonly Player[];
  readonly draftedPlayerIds: ReadonlySet<string>;
  readonly history: readonly MockDraftPickLike[];
  readonly keepers: readonly MockKeeperAssignment[];
  readonly currentPick: number;
  readonly config: MockDraftEngineConfig;
  readonly historyModel?: MockLeagueHistoryModel | null;
  /** Keeps Monte Carlo trials independent without changing the visible draft seed. */
  readonly iterationSalt?: number;
}

export interface CpuSelection {
  readonly player: Player;
  readonly shortlist: readonly ScoredCpuCandidate[];
}

export interface SimulatedMockPick extends MockDraftPickLike {
  readonly playerName: string;
  readonly source: 'cpu' | 'keeper';
}

type PositionCounts = Record<Position, number>;

const FLEX_POSITIONS: readonly Position[] = ['RB', 'WR', 'TE'];
const OFFENSIVE_POSITIONS: readonly Position[] = ['QB', 'RB', 'WR', 'TE'];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits: number = 2): number {
  return Number(value.toFixed(digits));
}

function createPositionCounts(): PositionCounts {
  return { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function mixSeed(...values: readonly number[]): number {
  return values.reduce(
    (mixed, value, index) => (
      Math.imul(mixed ^ (value >>> 0), 0x45d9f3b + index * 0x119de1f3)
    ) >>> 0,
    0x9e3779b9
  );
}

export function getTeamIndexForPick(pickNumber: number, totalTeams: number): number {
  const roundNumber = Math.ceil(pickNumber / totalTeams);
  const pickInRound = ((pickNumber - 1) % totalTeams) + 1;
  return roundNumber % 2 === 1
    ? pickInRound - 1
    : totalTeams - pickInRound;
}

export function getPickNumberForTeamRound(
  teamIndex: number,
  roundNumber: number,
  totalTeams: number
): number {
  const pickInRound = roundNumber % 2 === 1
    ? teamIndex + 1
    : totalTeams - teamIndex;
  return (roundNumber - 1) * totalTeams + pickInRound;
}

export function formatRoundPick(pickNumber: number, totalTeams: number): string {
  const roundNumber = Math.ceil(pickNumber / totalTeams);
  const pickInRound = ((pickNumber - 1) % totalTeams) + 1;
  return `${String(roundNumber)}.${String(pickInRound).padStart(2, '0')}`;
}

export function getKeeperAtPick(
  keepers: readonly MockKeeperAssignment[],
  pickNumber: number,
  totalTeams: number
): MockKeeperAssignment | undefined {
  return keepers.find((keeper) =>
    keeper.teamIndex < totalTeams &&
    getPickNumberForTeamRound(keeper.teamIndex, keeper.round, totalTeams) === pickNumber
  );
}

function getRosterCounts(
  teamIndex: number,
  history: readonly MockDraftPickLike[],
  keepers: readonly MockKeeperAssignment[]
): PositionCounts {
  const counts = createPositionCounts();
  const countedPlayerIds = new Set<string>();

  for (const keeper of keepers) {
    if (keeper.teamIndex !== teamIndex || countedPlayerIds.has(keeper.playerId)) continue;
    countedPlayerIds.add(keeper.playerId);
    counts[keeper.position] += 1;
  }

  for (const pick of history) {
    if (pick.teamIndex !== teamIndex || countedPlayerIds.has(pick.playerId)) continue;
    countedPlayerIds.add(pick.playerId);
    counts[pick.position] += 1;
  }

  return counts;
}

function totalRostered(counts: PositionCounts): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

function missingRequiredSlots(
  counts: PositionCounts,
  requirements: RosterRequirements
): number {
  const fixedMissing = OFFENSIVE_POSITIONS.reduce(
    (sum, position) => sum + Math.max(0, requirements[position].starters - counts[position]),
    0
  ) + Math.max(0, requirements.K.starters - counts.K) +
    Math.max(0, requirements.DEF.starters - counts.DEF);
  const fixedFlexBase = requirements.RB.starters + requirements.WR.starters + requirements.TE.starters;
  const flexRostered = counts.RB + counts.WR + counts.TE;
  const flexFilled = Math.max(0, flexRostered - fixedFlexBase);
  return fixedMissing + Math.max(0, requirements.FLEX.starters - flexFilled);
}

function getRemainingFreshSelectionsAfterPick(
  teamIndex: number,
  currentRound: number,
  config: MockDraftEngineConfig,
  keepers: readonly MockKeeperAssignment[]
): number {
  const remainingSelections = Math.max(0, config.totalRounds - currentRound);
  const futureKeeperSelections = keepers.filter((keeper) =>
    keeper.teamIndex === teamIndex && keeper.round > currentRound && keeper.round <= config.totalRounds
  ).length;
  return Math.max(0, remainingSelections - futureKeeperSelections);
}

function isLegalCandidate(
  player: Player,
  counts: PositionCounts,
  teamIndex: number,
  currentRound: number,
  config: MockDraftEngineConfig,
  keepers: readonly MockKeeperAssignment[]
): boolean {
  const requirements = config.rosterRequirements;
  if (counts[player.position] >= requirements[player.position].max) return false;
  if (totalRostered(counts) >= config.totalRounds) return false;

  const remainingFresh = getRemainingFreshSelectionsAfterPick(
    teamIndex,
    currentRound,
    config,
    keepers
  );
  const after = { ...counts, [player.position]: counts[player.position] + 1 };
  if (missingRequiredSlots(after, requirements) > remainingFresh) return false;

  const lateRoundStart = Math.max(1, config.totalRounds - 2);
  if ((player.position === 'K' || player.position === 'DEF') && currentRound < lateRoundStart) {
    return false;
  }
  return true;
}

function getMarketRank(player: Player): number {
  const leagueRank = player.leagueAdjustedMarketRank;
  if (leagueRank !== undefined && Number.isFinite(leagueRank) && leagueRank > 0) {
    return leagueRank;
  }
  if (Number.isFinite(player.marketAdp) && player.marketAdp > 0) return player.marketAdp;
  if (Number.isFinite(player.consensusAdp) && (player.consensusAdp ?? 0) > 0) {
    return player.consensusAdp ?? player.ecrRank;
  }
  return player.ecrRank;
}

function getRosterNeedScore(
  position: Position,
  counts: PositionCounts,
  requirements: RosterRequirements
): number {
  if (counts[position] < requirements[position].starters) {
    return position === 'QB' || position === 'TE' ? 12 : 10;
  }

  const fixedFlexBase = requirements.RB.starters + requirements.WR.starters + requirements.TE.starters;
  const flexTarget = fixedFlexBase + requirements.FLEX.starters;
  const flexRostered = counts.RB + counts.WR + counts.TE;
  if (FLEX_POSITIONS.includes(position) && flexRostered < flexTarget) return 5;

  if (position === 'QB') return counts.QB >= 1 ? -28 - Math.max(0, counts.QB - 1) * 12 : 0;
  if (position === 'TE') return counts.TE >= 1 ? -17 - Math.max(0, counts.TE - 1) * 8 : 0;
  if (position === 'K' || position === 'DEF') return -8;
  return 1.5;
}

function getRoundTendencyScore(player: Player, roundNumber: number): number {
  const position = player.position;
  if (position === 'QB') {
    if (roundNumber === 1) return -16;
    if (roundNumber === 2) return -10;
    if (roundNumber === 3) return 9;
    if (roundNumber === 4) return 10;
    if (roundNumber <= 7) return 5;
    return 0;
  }
  if (position === 'TE') {
    const depthPenalty = player.positionalRank >= 5
      ? -10
      : player.positionalRank >= 3
        ? -2
        : 0;
    if (roundNumber === 1) return -8 + depthPenalty;
    if (roundNumber === 2) return 7 + depthPenalty;
    if (roundNumber === 3) return 6 + depthPenalty;
    if (roundNumber <= 6) return 2 + depthPenalty;
    return 0;
  }
  if (position === 'RB') {
    if (roundNumber <= 2) return 3;
    if (roundNumber <= 7) return 1;
  }
  if (position === 'K' || position === 'DEF') return roundNumber >= 13 ? 4 : -40;
  return 0;
}

function getManagerTendency(
  model: MockLeagueHistoryModel | null | undefined,
  teamIndex: number,
  totalTeams: number
): MockManagerTendency | undefined {
  const slot = teamIndex + 1;
  const eligible = model?.managerTendencies
    ?.filter((manager) => manager.draftSlots.includes(slot))
    .sort((left, right) => right.sampleSize - left.sampleSize ||
      left.managerKey.localeCompare(right.managerKey));
  if (!eligible || eligible.length === 0) return undefined;
  const stableIndex = hashString(`team-${String(teamIndex)}-of-${String(totalTeams)}`) % eligible.length;
  return eligible[stableIndex];
}

function getHistoryScore(
  position: Position,
  roundNumber: number,
  teamIndex: number,
  config: MockDraftEngineConfig,
  model: MockLeagueHistoryModel | null | undefined
): number {
  const league = model?.positions?.[position];
  const leagueDelta = roundNumber <= 5
    ? league?.top50RateDelta ?? 0
    : league?.top100RateDelta ?? 0;
  const manager = getManagerTendency(model, teamIndex, config.totalTeams);
  const managerPosition = manager?.positions[position];
  const managerDelta = managerPosition?.leaguePickRateDelta ?? 0;
  const earlyPreference = roundNumber <= 5 && managerPosition
    ? managerPosition.earlyPickRate - managerPosition.pickRate
    : 0;
  return clamp(leagueDelta * 18 + managerDelta * 22 + earlyPreference * 5, -10, 10);
}

function getRunMomentum(
  position: Position,
  history: readonly MockDraftPickLike[],
  currentPick: number,
  config: MockDraftEngineConfig
): number {
  if (position !== 'QB' && position !== 'TE') return 0;
  const recent = history
    .filter((pick) => pick.pickNumber < currentPick && pick.source !== 'keeper')
    .slice(-6);
  const recentAtPosition = recent.filter((pick) => pick.position === position).length;
  const roundNumber = Math.ceil(currentPick / config.totalTeams);
  const runWindow = position === 'QB'
    ? roundNumber >= 3 && roundNumber <= 6
    : roundNumber >= 2 && roundNumber <= 5;
  const runProfile = createSeededRandom(mixSeed(config.seed, position === 'QB' ? 17 : 29))();
  const profileBoost = runWindow && runProfile > 0.52
    ? (runProfile - 0.52) * 10
    : 0;
  const recentBoost = recentAtPosition >= 3
    ? 9
    : recentAtPosition === 2
      ? 4.5
      : 0;
  return round(profileBoost + recentBoost);
}

function buildScarcityLookup(candidates: readonly Player[]): ReadonlyMap<string, number> {
  const lookup = new Map<string, number>();
  for (const position of OFFENSIVE_POSITIONS) {
    const positionPlayers = candidates
      .filter((player) => player.position === position)
      .sort((left, right) => getMarketRank(left) - getMarketRank(right));
    positionPlayers.forEach((player, index) => {
      const next = positionPlayers[index + 1];
      const marketGap = next
        ? clamp(getMarketRank(next) - getMarketRank(player), 0, 18)
        : 0;
      const tierCliff = clamp(player.tierDropoffScore * 5, 0, 6) +
        clamp((player.tierDropoffPoints ?? 0) * 0.18, 0, 4);
      lookup.set(player.id, round(marketGap * 0.35 + tierCliff));
    });
  }
  return lookup;
}

export function scoreCpuCandidates(input: SelectCpuPlayerInput): ScoredCpuCandidate[] {
  const teamIndex = getTeamIndexForPick(input.currentPick, input.config.totalTeams);
  const roundNumber = Math.ceil(input.currentPick / input.config.totalTeams);
  const rosterCounts = getRosterCounts(teamIndex, input.history, input.keepers);
  const candidates = input.players.filter((player) =>
    !input.draftedPlayerIds.has(player.id) &&
    isLegalCandidate(
      player,
      rosterCounts,
      teamIndex,
      roundNumber,
      input.config,
      input.keepers
    )
  );
  const scarcity = buildScarcityLookup(candidates);

  return candidates.map((player) => {
    const blendedMarketRank = getMarketRank(player) * 0.74 + player.ecrRank * 0.26;
    const customScoringDelta = (player.customProjectedPoints ?? player.projectedPoints) -
      player.projectedPoints;
    const components: CpuScoreComponents = {
      marketBehavior: 150 - blendedMarketRank * 0.82,
      leagueScoredValue:
        clamp(player.valueOverReplacement, -12, 45) * 0.32 +
        clamp(customScoringDelta, -10, 50) * 0.12,
      rosterNeed: getRosterNeedScore(
        player.position,
        rosterCounts,
        input.config.rosterRequirements
      ),
      positionalScarcity: scarcity.get(player.id) ?? 0,
      roundTendency: getRoundTendencyScore(player, roundNumber),
      managerHistory: getHistoryScore(
        player.position,
        roundNumber,
        teamIndex,
        input.config,
        input.historyModel
      ),
      runMomentum: getRunMomentum(
        player.position,
        input.history,
        input.currentPick,
        input.config
      ),
    };
    const score = components.marketBehavior +
      components.leagueScoredValue +
      components.rosterNeed +
      components.positionalScarcity +
      components.roundTendency +
      components.managerHistory +
      components.runMomentum;
    return { player, score: round(score), components };
  }).sort((left, right) => right.score - left.score ||
    getMarketRank(left.player) - getMarketRank(right.player));
}

export function selectCpuPlayer(input: SelectCpuPlayerInput): CpuSelection | undefined {
  const scored = scoreCpuCandidates(input);
  if (scored.length === 0) return undefined;

  const randomness = clamp(input.config.randomness, 0, 1);
  const shortlistSize = Math.min(scored.length, 10 + Math.round(randomness * 5));
  const shortlist = scored.slice(0, shortlistSize);
  const topCandidate = shortlist[0];
  if (!topCandidate) return undefined;
  if (randomness === 0) return { player: topCandidate.player, shortlist };

  const random = createSeededRandom(mixSeed(
    input.config.seed,
    input.currentPick,
    input.iterationSalt ?? 0,
    input.history.length
  ));
  const temperature = 1.8 + randomness * 10;
  const maximumScore = topCandidate.score;
  const weights = shortlist.map((candidate) =>
    Math.exp((candidate.score - maximumScore) / temperature)
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let threshold = random() * totalWeight;
  for (let index = 0; index < shortlist.length; index += 1) {
    threshold -= weights[index] ?? 0;
    if (threshold <= 0) {
      const candidate = shortlist[index];
      return candidate ? { player: candidate.player, shortlist } : undefined;
    }
  }
  const last = shortlist.at(-1);
  return last ? { player: last.player, shortlist } : undefined;
}

function getNextUserPickAfter(
  currentPick: number,
  config: MockDraftEngineConfig
): number | null {
  const totalPicks = config.totalTeams * config.totalRounds;
  for (let pickNumber = currentPick + 1; pickNumber <= totalPicks; pickNumber += 1) {
    if (getTeamIndexForPick(pickNumber, config.totalTeams) === config.myPickPosition - 1) {
      return pickNumber;
    }
  }
  return null;
}

export function estimateMockSurvivalProbabilities(input: {
  readonly players: readonly Player[];
  readonly draftedPlayerIds: ReadonlySet<string>;
  readonly history: readonly MockDraftPickLike[];
  readonly keepers: readonly MockKeeperAssignment[];
  readonly currentPick: number;
  readonly config: MockDraftEngineConfig;
  readonly historyModel?: MockLeagueHistoryModel | null;
  readonly iterations?: number;
  readonly iterationOffset?: number;
}): Readonly<Record<string, number>> {
  const nextUserPick = getNextUserPickAfter(input.currentPick, input.config);
  const availablePlayers = input.players.filter((player) =>
    !input.draftedPlayerIds.has(player.id)
  );
  if (nextUserPick === null || availablePlayers.length === 0) return {};

  const iterations = clamp(Math.round(input.iterations ?? 250), 1, 1000);
  const survived = new Map(availablePlayers.map((player) => [player.id, 0]));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const trial = iteration + (input.iterationOffset ?? 0);
    const drafted = new Set(input.draftedPlayerIds);
    const history: MockDraftPickLike[] = [...input.history];
    for (let pickNumber = input.currentPick; pickNumber < nextUserPick; pickNumber += 1) {
      if (
        pickNumber === input.currentPick &&
        getTeamIndexForPick(pickNumber, input.config.totalTeams) ===
          input.config.myPickPosition - 1
      ) {
        continue;
      }
      const keeper = getKeeperAtPick(input.keepers, pickNumber, input.config.totalTeams);
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
      const selection = selectCpuPlayer({
        players: input.players,
        draftedPlayerIds: drafted,
        history,
        keepers: input.keepers,
        currentPick: pickNumber,
        config: input.config,
        historyModel: input.historyModel,
        iterationSalt: mixSeed(trial + 1, pickNumber),
      });
      if (!selection) continue;
      drafted.add(selection.player.id);
      history.push({
        pickNumber,
        playerId: selection.player.id,
        playerName: selection.player.name,
        position: selection.player.position,
        teamIndex: getTeamIndexForPick(pickNumber, input.config.totalTeams),
        source: 'cpu',
      });
    }

    for (const player of availablePlayers) {
      if (!drafted.has(player.id)) {
        survived.set(player.id, (survived.get(player.id) ?? 0) + 1);
      }
    }
  }

  return Object.fromEntries(
    [...survived.entries()].map(([playerId, count]) => [
      playerId,
      round(count / iterations, 3),
    ])
  );
}

export function simulateCpuDraft(input: {
  readonly players: readonly Player[];
  readonly keepers: readonly MockKeeperAssignment[];
  readonly config: MockDraftEngineConfig;
  readonly historyModel?: MockLeagueHistoryModel | null;
  readonly freshSelectionLimit?: number;
}): readonly SimulatedMockPick[] {
  const drafted = new Set(input.keepers.map((keeper) => keeper.playerId));
  const history: SimulatedMockPick[] = [];
  const totalPicks = input.config.totalTeams * input.config.totalRounds;
  let freshSelections = 0;

  for (let pickNumber = 1; pickNumber <= totalPicks; pickNumber += 1) {
    const keeper = getKeeperAtPick(input.keepers, pickNumber, input.config.totalTeams);
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
    if (
      input.freshSelectionLimit !== undefined &&
      freshSelections >= input.freshSelectionLimit
    ) {
      break;
    }
    const selection = selectCpuPlayer({
      players: input.players,
      draftedPlayerIds: drafted,
      history,
      keepers: input.keepers,
      currentPick: pickNumber,
      config: input.config,
      historyModel: input.historyModel,
    });
    if (!selection) continue;
    drafted.add(selection.player.id);
    history.push({
      pickNumber,
      playerId: selection.player.id,
      playerName: selection.player.name,
      position: selection.player.position,
      teamIndex: getTeamIndexForPick(pickNumber, input.config.totalTeams),
      source: 'cpu',
    });
    freshSelections += 1;
  }

  return history;
}
