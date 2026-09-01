import {
  calculateStarterPoints as calculateSharedStarterPoints,
  createOffensiveRoster,
  deriveRosterRules,
  isLegalCandidate as isLegalOffensiveCandidate,
  rosterAdjustedValue,
  type OffensiveRoster,
  type RosterRules,
} from './offensive-roster.js';

export const SIMULATED_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;

export type SimulatedPosition = (typeof SIMULATED_POSITIONS)[number];
export type CounterfactualStrategy = 'ecr' | 'model';

export interface CounterfactualPlayer {
  readonly id: string;
  readonly name: string;
  readonly position: SimulatedPosition;
  /** Historical pre-draft market rank. This is the ADP proxy used by the sampler. */
  readonly marketRank: number;
  readonly modelValue: number;
  readonly actualPoints: number;
  readonly actualVor: number;
}

export interface CounterfactualPick {
  readonly pickNo: number;
  readonly round: number;
  readonly rosterId: number;
  readonly playerId: string;
  readonly position: string;
  readonly isUserPick: boolean;
  readonly isKeeper: boolean;
}

export interface CounterfactualSeason {
  readonly season: number;
  readonly rosterPositions: readonly string[];
  readonly rosterIdToOwner: Readonly<Record<string, string>>;
  readonly picks: readonly CounterfactualPick[];
}

type SimulatedRoster = OffensiveRoster<CounterfactualPlayer>;

interface PositionCounts {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
}

interface TendencyBucket {
  readonly total: number;
  readonly positions: PositionCounts;
}

interface OpponentTendencies {
  readonly league: ReadonlyMap<string, TendencyBucket>;
  readonly managers: ReadonlyMap<string, TendencyBucket>;
}

export interface CounterfactualDraftMetrics {
  readonly evaluatedPicks: number;
  readonly vorCaptured: number;
  readonly starterPoints: number;
  readonly averageRegret: number;
  readonly userPlayerIds: readonly string[];
  readonly opponentPlayerIds: readonly string[];
}

export interface MetricEstimate {
  readonly mean: number;
  readonly confidenceInterval: {
    readonly level: 0.95;
    readonly lower: number;
    readonly upper: number;
  };
}

export interface CounterfactualSimulationSummary {
  readonly iterations: number;
  readonly evaluatedPicks: MetricEstimate;
  readonly expectedStarterPoints: MetricEstimate;
  readonly expectedVorCaptured: MetricEstimate;
  readonly expectedAverageRegret: MetricEstimate;
}

const TENDENCY_PRIOR_PICKS = 8;

function round(value: number, digits: number = 2): number {
  return Number(value.toFixed(digits));
}

function isSimulatedPosition(position: string): position is SimulatedPosition {
  return SIMULATED_POSITIONS.includes(position as SimulatedPosition);
}

function emptyCounts(): PositionCounts {
  return { QB: 0, RB: 0, WR: 0, TE: 0 };
}

function createRoster(): SimulatedRoster {
  return createOffensiveRoster<CounterfactualPlayer>();
}

function isLegalCandidate(
  player: CounterfactualPlayer,
  roster: SimulatedRoster,
  rules: RosterRules,
  remainingOffensivePicks: number
): boolean {
  return isLegalOffensiveCandidate(player, roster, rules, remainingOffensivePicks);
}

function phase(roundNumber: number): string {
  if (roundNumber <= 4) return 'early';
  if (roundNumber <= 8) return 'middle';
  return 'late';
}

function addTendency(
  map: Map<string, { total: number; positions: PositionCounts }>,
  key: string,
  position: SimulatedPosition
): void {
  const current = map.get(key) ?? { total: 0, positions: emptyCounts() };
  current.total += 1;
  current.positions[position] += 1;
  map.set(key, current);
}

export function buildOpponentTendencies(
  historicalSeasons: readonly CounterfactualSeason[]
): OpponentTendencies {
  const league = new Map<string, { total: number; positions: PositionCounts }>();
  const managers = new Map<string, { total: number; positions: PositionCounts }>();
  for (const season of historicalSeasons) {
    for (const pick of season.picks) {
      if (pick.isKeeper || !isSimulatedPosition(pick.position)) continue;
      const pickPhase = phase(pick.round);
      addTendency(league, pickPhase, pick.position);
      const owner = season.rosterIdToOwner[String(pick.rosterId)];
      if (owner) addTendency(managers, `${owner}|${pickPhase}`, pick.position);
    }
  }
  return { league, managers };
}

function tendencyMultiplier(
  tendencies: OpponentTendencies,
  owner: string | undefined,
  roundNumber: number,
  position: SimulatedPosition
): number {
  const pickPhase = phase(roundNumber);
  const league = tendencies.league.get(pickPhase);
  const manager = owner ? tendencies.managers.get(`${owner}|${pickPhase}`) : undefined;
  const leagueRate = league && league.total > 0
    ? league.positions[position] / league.total
    : 0.25;
  if (!manager || manager.total === 0) return 1;
  const shrunkRate = (
    manager.positions[position] + TENDENCY_PRIOR_PICKS * leagueRate
  ) / (manager.total + TENDENCY_PRIOR_PICKS);
  return Math.max(0.45, Math.min(2.2, shrunkRate / Math.max(0.04, leagueRate)));
}

function rosterNeedMultiplier(
  position: SimulatedPosition,
  roster: SimulatedRoster,
  rules: RosterRules
): number {
  if (roster[position].length < rules.fixedStarters[position]) return 2.4;
  const flexCount = roster.RB.length + roster.WR.length + roster.TE.length;
  const flexTarget = rules.fixedStarters.RB + rules.fixedStarters.WR +
    rules.fixedStarters.TE + rules.flexStarters;
  if (position !== 'QB' && flexCount < flexTarget) return 1.35;
  if (position === 'QB' && roster.QB.length >= Math.max(1, rules.fixedStarters.QB)) return 0.35;
  if (position === 'TE' && roster.TE.length >= Math.max(1, rules.fixedStarters.TE)) return 0.55;
  return 0.9;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function mixSeed(seed: number, season: number, iteration: number): number {
  return (
    Math.imul(seed ^ season, 0x45d9f3b) ^ Math.imul(iteration + 1, 0x119de1f3)
  ) >>> 0;
}

function weightedOpponentPick(
  candidates: readonly CounterfactualPlayer[],
  roster: SimulatedRoster,
  rules: RosterRules,
  remainingOffensivePicks: number,
  pick: CounterfactualPick,
  owner: string | undefined,
  tendencies: OpponentTendencies,
  random: () => number
): CounterfactualPlayer | undefined {
  const legal = candidates
    .filter((player) => isLegalCandidate(player, roster, rules, remainingOffensivePicks))
    .sort((a, b) => a.marketRank - b.marketRank)
    .slice(0, 60);
  if (legal.length === 0) return undefined;
  const weights = legal.map((player) => {
    const futureCost = Math.max(0, player.marketRank - pick.pickNo) / 14;
    const marketWeight = Math.exp(-futureCost - player.marketRank / 350);
    return marketWeight *
      rosterNeedMultiplier(player.position, roster, rules) *
      tendencyMultiplier(tendencies, owner, pick.round, player.position);
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let threshold = random() * totalWeight;
  for (let index = 0; index < legal.length; index += 1) {
    threshold -= weights[index] ?? 0;
    if (threshold <= 0) return legal[index];
  }
  return legal.at(-1);
}

function modelRosterScore(
  player: CounterfactualPlayer,
  roster: SimulatedRoster,
  rules: RosterRules
): number {
  return rosterAdjustedValue(player, player.modelValue, roster, rules);
}

function chooseUserPlayer(
  candidates: readonly CounterfactualPlayer[],
  roster: SimulatedRoster,
  rules: RosterRules,
  remainingOffensivePicks: number,
  strategy: CounterfactualStrategy
): CounterfactualPlayer | undefined {
  const legal = candidates.filter((player) =>
    isLegalCandidate(player, roster, rules, remainingOffensivePicks)
  );
  return legal.sort((a, b) => strategy === 'ecr'
    ? a.marketRank - b.marketRank
    : modelRosterScore(b, roster, rules) - modelRosterScore(a, roster, rules) ||
      a.marketRank - b.marketRank
  )[0];
}

function calculateStarterPoints(roster: SimulatedRoster, rules: RosterRules): number {
  return calculateSharedStarterPoints(
    roster,
    rules,
    (player) => player.id,
    (player) => player.actualPoints
  );
}

function remainingOffensiveTurns(
  picks: readonly CounterfactualPick[],
  fromIndex: number,
  rosterId: number
): number {
  return picks.slice(fromIndex).filter((pick) =>
    pick.rosterId === rosterId && !pick.isKeeper && isSimulatedPosition(pick.position)
  ).length;
}

export function runCounterfactualDraft(input: {
  readonly season: CounterfactualSeason;
  readonly priorSeasons: readonly CounterfactualSeason[];
  readonly players: readonly CounterfactualPlayer[];
  readonly strategy: CounterfactualStrategy;
  readonly seed: number;
}): CounterfactualDraftMetrics {
  const rules = deriveRosterRules(input.season.rosterPositions);
  const tendencies = buildOpponentTendencies(input.priorSeasons);
  const random = mulberry32(input.seed);
  const playersById = new Map(input.players.map((player) => [player.id, player]));
  const available = new Map(input.players.map((player) => [player.id, player]));
  const rosters = new Map<number, SimulatedRoster>();
  const getRoster = (rosterId: number): SimulatedRoster => {
    const existing = rosters.get(rosterId);
    if (existing) return existing;
    const roster = createRoster();
    rosters.set(rosterId, roster);
    return roster;
  };
  const sortedPicks = [...input.season.picks].sort((a, b) => a.pickNo - b.pickNo);
  const keepers = sortedPicks.filter((pick) => pick.isKeeper);
  for (const keeper of keepers) {
    available.delete(keeper.playerId);
    const player = playersById.get(keeper.playerId);
    if (player) getRoster(keeper.rosterId)[player.position].push(player);
  }

  const userRows: CounterfactualPlayer[] = [];
  const regrets: number[] = [];
  const opponentPlayerIds: string[] = [];
  const userRosterId = sortedPicks.find((pick) => pick.isUserPick)?.rosterId;
  if (userRosterId === undefined) {
    return {
      evaluatedPicks: 0,
      vorCaptured: 0,
      starterPoints: 0,
      averageRegret: 0,
      userPlayerIds: [],
      opponentPlayerIds: [],
    };
  }

  for (let index = 0; index < sortedPicks.length; index += 1) {
    const pick = sortedPicks[index];
    if (!pick || pick.isKeeper || !isSimulatedPosition(pick.position)) continue;
    const roster = getRoster(pick.rosterId);
    const remainingTurns = remainingOffensiveTurns(sortedPicks, index, pick.rosterId);
    const candidates = [...available.values()];
    if (pick.isUserPick) {
      const selected = chooseUserPlayer(candidates, roster, rules, remainingTurns, input.strategy);
      if (!selected) continue;
      const bestLegal = candidates
        .filter((player) => isLegalCandidate(player, roster, rules, remainingTurns))
        .sort((a, b) => b.actualVor - a.actualVor)[0];
      available.delete(selected.id);
      roster[selected.position].push(selected);
      userRows.push(selected);
      regrets.push(Math.max(0, (bestLegal?.actualVor ?? 0) - selected.actualVor));
      continue;
    }
    const owner = input.season.rosterIdToOwner[String(pick.rosterId)];
    const selected = weightedOpponentPick(
      candidates,
      roster,
      rules,
      remainingTurns,
      pick,
      owner,
      tendencies,
      random
    );
    if (!selected) continue;
    available.delete(selected.id);
    roster[selected.position].push(selected);
    opponentPlayerIds.push(selected.id);
  }

  const userRoster = getRoster(userRosterId);
  return {
    evaluatedPicks: userRows.length,
    vorCaptured: round(userRows.reduce((sum, player) => sum + player.actualVor, 0)),
    starterPoints: calculateStarterPoints(userRoster, rules),
    averageRegret: round(
      regrets.reduce((sum, regret) => sum + regret, 0) / Math.max(1, regrets.length)
    ),
    userPlayerIds: userRows.map((player) => player.id),
    opponentPlayerIds,
  };
}

function percentile(sorted: readonly number[], probability: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  return lower + (upper - lower) * (index - lowerIndex);
}

export function estimateMetric(values: readonly number[]): MetricEstimate {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)),
    confidenceInterval: {
      level: 0.95,
      lower: round(percentile(sorted, 0.025)),
      upper: round(percentile(sorted, 0.975)),
    },
  };
}

export function summarizeCounterfactualIterations(
  iterations: readonly CounterfactualDraftMetrics[]
): CounterfactualSimulationSummary {
  return {
    iterations: iterations.length,
    evaluatedPicks: estimateMetric(iterations.map((row) => row.evaluatedPicks)),
    expectedStarterPoints: estimateMetric(iterations.map((row) => row.starterPoints)),
    expectedVorCaptured: estimateMetric(iterations.map((row) => row.vorCaptured)),
    expectedAverageRegret: estimateMetric(iterations.map((row) => row.averageRegret)),
  };
}

export function simulateCounterfactualSeason(input: {
  readonly season: CounterfactualSeason;
  readonly priorSeasons: readonly CounterfactualSeason[];
  readonly players: readonly CounterfactualPlayer[];
  readonly strategy: CounterfactualStrategy;
  readonly iterations: number;
  readonly seed: number;
}): {
  readonly summary: CounterfactualSimulationSummary;
  readonly iterations: readonly CounterfactualDraftMetrics[];
} {
  const results = Array.from({ length: input.iterations }, (_, iteration) =>
    runCounterfactualDraft({
      season: input.season,
      priorSeasons: input.priorSeasons,
      players: input.players,
      strategy: input.strategy,
      seed: mixSeed(input.seed, input.season.season, iteration),
    })
  );
  return { summary: summarizeCounterfactualIterations(results), iterations: results };
}

export function aggregateCounterfactualSeasons(
  seasonIterations: readonly (readonly CounterfactualDraftMetrics[])[]
): CounterfactualSimulationSummary {
  const iterationCount = Math.min(...seasonIterations.map((rows) => rows.length));
  const aggregated = Array.from({ length: iterationCount }, (_, iteration) => {
    const rows = seasonIterations.map((season) => season[iteration]).filter(
      (row): row is CounterfactualDraftMetrics => Boolean(row)
    );
    const evaluatedPicks = rows.reduce((sum, row) => sum + row.evaluatedPicks, 0);
    return {
      evaluatedPicks,
      vorCaptured: rows.reduce((sum, row) => sum + row.vorCaptured, 0),
      starterPoints: rows.reduce((sum, row) => sum + row.starterPoints, 0),
      averageRegret: rows.reduce(
        (sum, row) => sum + row.averageRegret * row.evaluatedPicks,
        0
      ) / Math.max(1, evaluatedPicks),
      userPlayerIds: rows.flatMap((row) => row.userPlayerIds),
      opponentPlayerIds: rows.flatMap((row) => row.opponentPlayerIds),
    };
  });
  return summarizeCounterfactualIterations(aggregated);
}
