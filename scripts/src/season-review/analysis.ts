/**
 * Assembles the season retrospective from decoded inputs. Pure: the entry point owns all I/O.
 */
import {
  FLEX_GROUPS,
  KICKER_DEFENSE_POSITIONS,
  OFFENSIVE_POSITIONS,
  isNFLTeam,
  normalizeSleeperLeagueSettings,
  type OffensivePosition,
  type RosterRequirements,
} from '@fantasy-draft/shared/league';
import { applyPositionTiers, getRecommendations } from '@fantasy-draft/shared/draft';
import { asProbability, asRank, asVor } from '@fantasy-draft/shared/units';
import {
  calculateStarterPoints,
  createOffensiveRoster,
  deriveRosterRules,
  isLegalCandidate,
  missingRequiredSlots,
  POSITION_MAXIMUMS,
  type OffensiveRoster,
  type RosterRules,
} from '../offensive-roster.js';
import { pseudonymizeUserId } from '../import-league-draft-history.js';
import {
  RISK_CATEGORIES,
  acquisitionSource,
  adpDelta,
  aggregateSeason,
  classifyRisks,
  classifyStrategy,
  conditionalSurvival,
  correlationInterval,
  expectedValueBySlot,
  leagueProjection,
  letterGrade,
  mean,
  meanAbsoluteRankError,
  normalizeName,
  pickupStints,
  quantile,
  rankWithinGroups,
  replacementLevels,
  spearman,
  sportsbookProjectionGap,
  starterSlotsFromRoster,
  type AcquisitionSource,
  type StarterSlots,
  type PlayerSeasonLine,
  type RiskCategory,
  type RosterAdd,
  type StatProjection,
  type StrategyTag,
} from './core.js';
import type { SeasonReviewInputs } from './inputs.js';

/** Picks either side of a slot that define what the room got there. */
export const EXPECTED_VALUE_WINDOW = 7;
/** Pre-draft positional ranks treated as "draftable" when scoring expert accuracy. */
export const RELEVANT_POSITION_DEPTH: Readonly<Record<OffensivePosition, number>> = { QB: 24, RB: 48, WR: 60, TE: 24 };
const ROOM_AVERAGE = 'room-average';

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Short UTC date label for a snapshot timestamp, such as "Aug 30"; the raw text when it does not parse. */
export function snapshotDateLabel(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : timestamp;
}
const isOffensive = (position: string): position is OffensivePosition =>
  OFFENSIVE_POSITIONS.some((candidate) => candidate === position);

export interface PredraftPlayer {
  readonly playerId: string;
  readonly fantasyProsId: string;
  readonly name: string;
  readonly position: string;
  readonly team: string | null;
  readonly ecrRank: number;
  readonly ecrPositionRank: number | null;
  readonly bestRank: number | null;
  readonly worstRank: number | null;
  readonly avgRank: number | null;
  readonly adpRank: number | null;
  /** FantasyPros average draft position as a pick number, null without one; the ordinal `adpRank` only orders players. */
  readonly adpPick: number | null;
  readonly projection: number | null;
  readonly projectionStats: StatProjection;
}

export interface DraftedPick {
  readonly pickNo: number;
  readonly round: number;
  readonly roundPick: number;
  readonly draftSlot: number;
  readonly rosterId: number;
  readonly manager: string;
  readonly playerId: string;
  readonly name: string;
  readonly position: string;
  readonly team: string | null;
  readonly isKeeper: boolean;
  readonly ecrRank: number | null;
  readonly ecrPositionRank: number | null;
  readonly adpRank: number | null;
  readonly adpPick: number | null;
  readonly adpDelta: number | null;
  readonly currentEcrRank: number | null;
  readonly points: number;
  readonly games: number;
  readonly pointsPerGame: number;
  readonly positionRank: number | null;
  readonly ppgPositionRank: number | null;
  readonly positionDraftOrder: number;
  readonly returnVsSlot: number | null;
  readonly vor: number;
  readonly expectedVor: number;
  readonly valueOverCost: number;
  readonly risks: readonly RiskCategory[];
}

export interface CounterfactualPick {
  readonly pickNo: number;
  readonly actual: { readonly name: string; readonly position: string; readonly points: number };
  readonly ecr: { readonly name: string; readonly position: string; readonly points: number } | null;
  readonly bestPick: { readonly name: string; readonly position: string; readonly points: number } | null;
}

export interface StrategyTotals {
  readonly totalPoints: number;
  /** Null when the picks cannot fill every required starter: an incomplete lineup has no comparable total. */
  readonly seasonLineupPoints: number | null;
  readonly totalVor: number;
}

export interface TeamSummary {
  readonly rosterId: number;
  readonly manager: string;
  readonly teamName: string | null;
  readonly draftSlot: number;
  readonly isManager: boolean;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly pointsFor: number;
  readonly pointsAgainst: number;
  readonly maxPoints: number;
  readonly standingsRank: number;
  readonly pointsForRank: number;
  readonly positionsByRound: readonly string[];
  readonly strategy: readonly StrategyTag[];
  readonly keepers: readonly string[];
  readonly biggestReach: { readonly name: string; readonly pickNo: number; readonly adpDelta: number } | null;
  readonly biggestValue: { readonly name: string; readonly pickNo: number; readonly adpDelta: number } | null;
  readonly draftValueOverCost: number;
  readonly draftedPoints: number;
  readonly draftGrade: string;
  readonly draftValueRank: number;
  readonly draftValueExKeepers: number;
  readonly draftGradeExKeepers: string;
  readonly draftValueRankExKeepers: number;
  readonly starterPointsBySource: Readonly<Record<AcquisitionSource, number>>;
  readonly transactions: { readonly waiver: number; readonly freeAgent: number; readonly trade: number; readonly faabSpent: number };
  readonly meanAdpDelta: number | null;
  readonly adpDeltaByPosition: Readonly<Record<string, number | null>>;
  readonly firstQbRound: number | null;
  readonly firstTeRound: number | null;
}

export interface CorrelationRow {
  readonly scope: string;
  readonly n: number;
  readonly rho: number | null;
  readonly interval: readonly [number, number] | null;
  readonly meanAbsoluteRankError: number | null;
}

export interface Mover {
  readonly name: string;
  readonly position: string;
  readonly predraftPositionRank: number | null;
  readonly actualPositionRank: number;
  readonly change: number | null;
  readonly points: number;
  readonly games: number;
  readonly drafted: boolean;
}

export interface RiskSummary {
  readonly category: RiskCategory | 'all-drafted';
  readonly n: number;
  readonly hits: number;
  readonly hitRate: number | null;
  readonly meanValueOverCost: number | null;
  readonly meanReturnVsSlot: number | null;
  readonly paidOff: readonly string[];
  readonly didNot: readonly string[];
}

export interface WaiverPickup {
  readonly name: string;
  readonly position: string;
  readonly manager: string;
  readonly firstWeek: number;
  readonly source: 'waiver' | 'free_agent';
  readonly faabBid: number | null;
  readonly rosteredPoints: number;
  readonly startedPoints: number;
}

export interface ManagerTendency {
  readonly userId: string;
  readonly manager: string;
  readonly seasons: readonly number[];
  readonly picks: number;
  readonly meanEcrDelta: number | null;
  readonly ecrDeltaByPosition: Readonly<Record<string, { readonly n: number; readonly mean: number | null }>>;
  readonly meanFirstQbRound: number | null;
  readonly meanFirstTeRound: number | null;
  readonly earlyRbShare: number | null;
}

export interface SeasonReview {
  readonly meta: {
    readonly season: number;
    readonly throughWeek: number;
    readonly standingsThroughWeek: number;
    readonly label: string;
    readonly managerSlot: number;
    readonly managerRosterId: number;
    readonly managerSlotEvidence: readonly string[];
    readonly predraftRankingsAt: string;
    /** Short date of the pre-draft snapshot, such as "Aug 30". */
    readonly predraftRankingsLabel: string;
    readonly currentRankingsAt: string | null;
    readonly currentRankingsAreDraftRankings: boolean;
    readonly unmatchedDraftedPlayers: readonly string[];
    readonly replacementLevels: Readonly<Record<string, number>>;
    readonly caveats: readonly string[];
  };
  readonly picks: readonly DraftedPick[];
  readonly myDraft: {
    readonly picks: readonly DraftedPick[];
    readonly grade: string;
    readonly valueRank: number;
    readonly valueOverCost: number;
    readonly gradeExKeepers: string;
    readonly valueRankExKeepers: number;
    readonly valueOverCostExKeepers: number;
    readonly reaches: readonly DraftedPick[];
    readonly waits: readonly DraftedPick[];
    readonly counterfactual: {
      readonly picks: readonly CounterfactualPick[];
      readonly actual: StrategyTotals;
      readonly ecr: StrategyTotals;
      readonly bestPick: StrategyTotals;
      readonly bestPickMethod: string;
    };
  };
  readonly teams: readonly TeamSummary[];
  readonly strategies: readonly {
    readonly tag: StrategyTag;
    readonly teams: readonly string[];
    readonly meanPointsFor: number | null;
    readonly meanWins: number | null;
    readonly othersMeanPointsFor: number | null;
  }[];
  readonly adpCalibration: { readonly n: number; readonly withinOneRound: number | null; readonly meanAbsoluteDelta: number | null; readonly meanDelta: number | null };
  readonly strategyCorrelations: readonly { readonly measure: string; readonly n: number; readonly rho: number | null; readonly interval: readonly [number, number] | null }[];
  readonly tendencies: { readonly current: readonly ManagerTendency[]; readonly withHistory: readonly ManagerTendency[]; readonly historySeasons: readonly number[] };
  readonly rankings: {
    readonly ecrByPosition: readonly CorrelationRow[];
    readonly ecrPpgByPosition: readonly CorrelationRow[];
    readonly adpVsEcr: readonly { readonly source: string; readonly row: CorrelationRow }[];
    readonly modelVsFantasyPros: readonly { readonly source: string; readonly row: CorrelationRow }[];
    readonly risers: readonly Mover[];
    readonly fallers: readonly Mover[];
    readonly unrankedBreakouts: readonly Mover[];
    readonly fantasyProsMovement: readonly { readonly name: string; readonly position: string; readonly before: number; readonly after: number }[];
  };
  readonly risks: {
    readonly expertSpreadThreshold: number | null;
    readonly summary: readonly RiskSummary[];
    readonly myTeam: readonly { readonly name: string; readonly risks: readonly RiskCategory[]; readonly returnVsSlot: number | null; readonly valueOverCost: number }[];
  };
  readonly returns: {
    readonly topValue: readonly DraftedPick[];
    readonly worstValue: readonly DraftedPick[];
    readonly byRound: readonly { readonly round: number; readonly best: DraftedPick; readonly worst: DraftedPick }[];
    readonly waiverPickups: readonly WaiverPickup[];
  };
}

interface PlayerInfo {
  readonly name: string;
  readonly position: string;
  readonly team: string | null;
  readonly gsisId: string | null;
}

function normalizePosition(position: string | null | undefined): string {
  if (position === 'FB') return 'RB';
  return position ?? '';
}

function buildPlayerInfo(inputs: SeasonReviewInputs): Map<string, PlayerInfo> {
  const info = new Map<string, PlayerInfo>();
  for (const [playerId, player] of Object.entries(inputs.players)) {
    const name = player.full_name ?? [player.first_name, player.last_name].filter(Boolean).join(' ');
    info.set(playerId, {
      name: name || playerId,
      position: normalizePosition(player.position),
      team: player.team ?? null,
      gsisId: player.gsis_id?.trim() || null,
    });
  }
  return info;
}

/** FantasyPros id → Sleeper id through the identity file, then by normalized name and position. */
function buildFantasyProsMap(inputs: SeasonReviewInputs, info: ReadonlyMap<string, PlayerInfo>): Map<string, string> {
  const map = new Map<string, string>();
  for (const player of inputs.identity?.players ?? []) {
    if (player.fantasyProsId && player.sleeperId) map.set(player.fantasyProsId, player.sleeperId);
  }
  const byName = new Map<string, string[]>();
  for (const [playerId, player] of info) {
    const key = `${normalizeName(player.name)}|${player.position}`;
    byName.set(key, [...(byName.get(key) ?? []), playerId]);
  }
  const snapshots = [inputs.predraftFantasyPros, inputs.currentFantasyPros].flatMap((snapshot) => snapshot ? [snapshot] : []);
  for (const snapshot of snapshots) {
    for (const row of [...snapshot.rankings, ...snapshot.adp, ...snapshot.projections]) {
      if (map.has(row.fantasyProsId)) continue;
      const candidates = byName.get(`${normalizeName(row.name)}|${normalizePosition(row.position)}`) ?? [];
      const sameTeam = candidates.filter((id) => info.get(id)?.team === row.team);
      const chosen = sameTeam.length === 1 ? sameTeam[0] : candidates.length === 1 ? candidates[0] : undefined;
      if (chosen) map.set(row.fantasyProsId, chosen);
    }
  }
  return map;
}

export function buildPredraft(inputs: SeasonReviewInputs, fpMap: ReadonlyMap<string, string>): Map<string, PredraftPlayer> {
  const snapshot = inputs.predraftFantasyPros;
  const scoringRules = normalizeSleeperLeagueSettings(inputs.league).scoringRules;
  const adp = new Map(snapshot.adp.map((row) => [row.fantasyProsId, row]));
  const projections = new Map(snapshot.projections.map((row) => [row.fantasyProsId, row]));
  const players = new Map<string, PredraftPlayer>();
  for (const row of snapshot.rankings) {
    const playerId = fpMap.get(row.fantasyProsId);
    if (!playerId || players.has(playerId)) continue;
    const projection = projections.get(row.fantasyProsId);
    const position = normalizePosition(row.position);
    players.set(playerId, {
      playerId,
      fantasyProsId: row.fantasyProsId,
      name: row.name,
      position,
      team: row.team ?? null,
      ecrRank: row.rank,
      ecrPositionRank: row.positionalRank ?? null,
      bestRank: row.bestRank ?? null,
      worstRank: row.worstRank ?? null,
      avgRank: row.avgRank ?? null,
      adpRank: adp.get(row.fantasyProsId)?.rank ?? null,
      adpPick: adp.get(row.fantasyProsId)?.averageRank ?? null,
      projection: projection ? leagueProjection(projection, position, scoringRules) : null,
      projectionStats: {
        passingYards: projection?.projectedPassingYards ?? undefined,
        passingTouchdowns: projection?.projectedPassingTouchdowns ?? undefined,
        rushingYards: projection?.projectedRushingYards ?? undefined,
        rushingTouchdowns: projection?.projectedRushingTouchdowns ?? undefined,
        receptions: projection?.projectedReceptions ?? undefined,
        receivingYards: projection?.projectedReceivingYards ?? undefined,
        receivingTouchdowns: projection?.projectedReceivingTouchdowns ?? undefined,
      },
    });
  }
  return players;
}

function managerNames(inputs: SeasonReviewInputs): Map<string, { name: string; teamName: string | null }> {
  return new Map(inputs.users.map((user) => {
    const teamName = user.metadata?.['team_name'];
    return [user.user_id, {
      name: user.display_name ?? user.user_id,
      teamName: typeof teamName === 'string' && teamName.trim() ? teamName.trim() : null,
    }];
  }));
}

function numberSetting(settings: Readonly<Record<string, unknown>>, key: string): number {
  const value = settings[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function pickRosterId(pick: SeasonReviewInputs['picks'][number]): number | null {
  const raw = pick.roster_id;
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function rosterIdOf(pick: SeasonReviewInputs['picks'][number], slotToRoster: Readonly<Record<string, number>>): number {
  return pickRosterId(pick) ?? slotToRoster[String(pick.draft_slot)] ?? 0;
}

/**
 * The manager's roster: the draft's slot_to_roster_id, else the one roster every pick from that slot names, provided
 * the league has that roster. Anything else is ambiguous and stops the report rather than grading roster 0.
 */
export function resolveManagerRosterId(inputs: Pick<SeasonReviewInputs, 'draft' | 'picks' | 'rosters' | 'managerSlot'>): number {
  const mapped = inputs.draft.slot_to_roster_id?.[String(inputs.managerSlot)];
  const fromPicks = [...new Set(inputs.picks.filter((pick) => pick.draft_slot === inputs.managerSlot).map(pickRosterId))];
  const [only] = fromPicks;
  const rosterId = mapped ?? (fromPicks.length === 1 && only !== null && only !== undefined ? only : null);
  if (rosterId === null || !inputs.rosters.some((roster) => roster.roster_id === rosterId)) {
    throw new Error(`Could not tie draft slot ${String(inputs.managerSlot)} to one league roster: the draft has no slot_to_roster_id for it and its picks name ${fromPicks.length ? fromPicks.map(String).join(', ') : 'no roster'}. Check --manager-slot.`);
  }
  return rosterId;
}

function correlationRow(scope: string, predicted: readonly number[], actual: readonly number[]): CorrelationRow {
  const rho = spearman(predicted, actual);
  return {
    scope,
    n: predicted.length,
    rho,
    interval: rho === null ? null : correlationInterval(rho, predicted.length),
    meanAbsoluteRankError: meanAbsoluteRankError(predicted, actual),
  };
}

type BoardPlayer = Parameters<typeof getRecommendations>[0][number];

interface CandidatePlayer {
  readonly playerId: string;
  readonly position: OffensivePosition;
}

function requirementsFor(rules: RosterRules): RosterRequirements {
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

/** Pick-number market cost: FantasyPros average pick, falling back to expert rank. Ordinal ADP rank only orders players. */
const marketPick = (player: { readonly adpPick: number | null; readonly ecrRank: number }) => player.adpPick ?? player.ecrRank;

/** Return probability for the replay: chance the player survives from this pick to the manager's next one. */
export function nextPickSurvival(player: { readonly adpPick: number | null; readonly ecrRank: number }, pickNo: number, nextPick: number | null): number {
  return nextPick === null ? 0 : conditionalSurvival(marketPick(player), pickNo, nextPick);
}

/** Live next-pick inputs for one replay pick; the Best Pick draft-timing factor scores zero without `nextPickNumber`. */
export function replayTiming(
  player: { readonly adpPick: number | null; readonly ecrRank: number }, pickNo: number, nextPick: number | null, teams: number
): Pick<BoardPlayer, 'nextPickSurvivalProbability' | 'nextPickNumber' | 'nextPickLabel' | 'picksUntilNextPick'> {
  const nextPickSurvivalProbability = asProbability(nextPickSurvival(player, pickNo, nextPick));
  if (nextPick === null) return { nextPickSurvivalProbability };
  const pickInRound = ((nextPick - 1) % teams) + 1;
  return {
    nextPickSurvivalProbability,
    nextPickNumber: nextPick,
    nextPickLabel: `${String(Math.ceil(nextPick / teams))}.${String(pickInRound).padStart(2, '0')}`,
    picksUntilNextPick: nextPick - pickNo,
  };
}

/**
 * The shipped Best Pick rule on the pre-draft board, built the way the recommendation backtest builds historical
 * boards: expert rank, league-scored projection and its VOR, FantasyPros ADP as market cost, and neutral live inputs.
 */
export function buildBestPickBoard(predraft: ReadonlyMap<string, PredraftPlayer>, projectionReplacement: ReadonlyMap<string, number>): Map<string, BoardPlayer> {
  const players = [...predraft.values()]
    .sort((a, b) => a.ecrRank - b.ecrRank)
    .flatMap((player): BoardPlayer[] => {
      const position = player.position;
      if (!isOffensive(position)) return [];
      const market = marketPick(player);
      const projected = player.projection ?? 0;
      return [{
        id: player.playerId,
        name: player.name,
        position,
        team: isNFLTeam(player.team) ? player.team : 'ARI',
        byeWeek: 0,
        ecrRank: asRank(player.ecrRank),
        positionalRank: asRank(player.ecrPositionRank ?? player.ecrRank),
        sleeperAdp: market,
        valueScore: 0,
        marketRank: player.adpRank ?? player.ecrRank,
        marketAdp: market,
        marketAdpTrend: 0,
        isContractYear: false,
        offensiveEnvironmentScore: 5,
        projectedPoints: projected,
        valueOverReplacement: asVor(round2(projected - (projectionReplacement.get(position) ?? 0))),
        tier: 1,
        tierDropoffScore: 0,
        nextPickSurvivalProbability: asProbability(0.5),
        ceilingScore: 5,
        floorScore: 5,
        upsideScore: 5,
        uncertaintyScore: 3,
        injuryRiskScore: 2,
        predictionSource: 'heuristic',
        newsStatus: 'healthy',
        stackPartnerTeam: 'ARI',
        highlightLevel: 'neutral',
      }];
    });
  return new Map(applyPositionTiers(players).map((player) => [player.id, player]));
}

interface StrategyState {
  readonly roster: OffensiveRoster<CandidatePlayer>;
  readonly selected: Set<string>;
  readonly picks: (string | null)[];
}

function newStrategy(): StrategyState {
  return { roster: createOffensiveRoster<CandidatePlayer>(), selected: new Set(), picks: [] };
}

function addToStrategy(state: StrategyState, player: CandidatePlayer): void {
  state.roster[player.position].push(player);
  state.selected.add(player.playerId);
  state.picks.push(player.playerId);
}

function strategyTotals(
  ids: readonly (string | null)[],
  positionOf: (playerId: string) => string,
  lines: ReadonlyMap<string, PlayerSeasonLine>,
  vorOf: (playerId: string) => number,
  rules: RosterRules,
  slots: StarterSlots
): StrategyTotals {
  const roster = createOffensiveRoster<CandidatePlayer>();
  const special = new Map<string, number[]>();
  let totalPoints = 0;
  let totalVor = 0;
  for (const id of ids) {
    if (!id) continue;
    const points = lines.get(id)?.points ?? 0;
    totalPoints += points;
    totalVor += vorOf(id);
    const position = positionOf(id);
    if (isOffensive(position)) roster[position].push({ playerId: id, position });
    else special.set(position, [...(special.get(position) ?? []), points]);
  }
  // A legal lineup also starts every configured K and DEF slot.
  const specialStarters = KICKER_DEFENSE_POSITIONS.reduce((sum, position) => sum + [...(special.get(position) ?? [])]
    .sort((a, b) => b - a).slice(0, slots.fixed[position] ?? 0).reduce((total, points) => total + points, 0), 0);
  const complete = missingRequiredSlots(roster, rules) === 0
    && KICKER_DEFENSE_POSITIONS.every((position) => (special.get(position)?.length ?? 0) >= (slots.fixed[position] ?? 0));
  return {
    totalPoints: round2(totalPoints),
    totalVor: round2(totalVor),
    seasonLineupPoints: !complete ? null : round2(calculateStarterPoints(roster, rules, (player) => player.playerId,
      (player) => lines.get(player.playerId)?.points ?? 0) + specialStarters),
  };
}

function positionTally(values: readonly { position: string; value: number }[]): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  for (const position of OFFENSIVE_POSITIONS) {
    result[position] = mean(values.filter((value) => value.position === position).map((value) => value.value));
  }
  return result;
}

function firstRoundOf(positionsByRound: readonly string[], position: string): number | null {
  const index = positionsByRound.indexOf(position);
  return index === -1 ? null : index + 1;
}

export function buildSeasonReview(inputs: SeasonReviewInputs): SeasonReview {
  const teams = inputs.league.total_rosters;
  const rounds = numberSetting(inputs.draft.settings, 'rounds') || inputs.league.roster_positions.length;
  const scoring = inputs.league.scoring_settings;
  const info = buildPlayerInfo(inputs);
  const fpMap = buildFantasyProsMap(inputs, info);
  const predraft = buildPredraft(inputs, fpMap);
  const names = managerNames(inputs);
  const slotToRoster = inputs.draft.slot_to_roster_id ?? {};
  const managerRosterId = resolveManagerRosterId(inputs);
  const rosterOwner = new Map(inputs.rosters.map((roster) => [roster.roster_id, roster.owner_id ?? '']));
  const managerOf = (rosterId: number) => names.get(rosterOwner.get(rosterId) ?? '')?.name ?? `Roster ${String(rosterId)}`;

  // One position per player for ranking, VOR and the draft row: the live directory, else the draft pick's metadata.
  const draftPosition = new Map(inputs.picks.flatMap((pick) =>
    typeof pick.metadata?.['position'] === 'string' && pick.metadata['position'] ? [[pick.player_id, normalizePosition(pick.metadata['position'])] as const] : []));
  const positionOf = (playerId: string) => info.get(playerId)?.position || draftPosition.get(playerId) || '';

  const lines = aggregateSeason(inputs.weeklyStats, scoring);
  const lineOf = (playerId: string) => lines.get(playerId);
  const scoredPositions = new Set<string>([...OFFENSIVE_POSITIONS, ...KICKER_DEFENSE_POSITIONS]);
  const universe = [...lines.values()].flatMap((line) => {
    const position = positionOf(line.playerId);
    return scoredPositions.has(position) ? [{ ...line, position }] : [];
  });
  // Drafted players with no stat line yet still hold a rank: last at their position on zero points.
  for (const playerId of new Set(inputs.picks.map((pick) => pick.player_id))) {
    const position = positionOf(playerId);
    if (lines.has(playerId) || !scoredPositions.has(position)) continue;
    universe.push({ playerId, points: 0, games: 0, pointsPerGame: 0, weeklyPoints: [], position });
  }
  const slots = starterSlotsFromRoster(inputs.league.roster_positions, FLEX_GROUPS.standard);
  const replacement = replacementLevels(universe, slots, teams);
  // Floored at zero: a player below replacement is a free waiver swap, so a late bust costs the pick, not more.
  const vorOf = (playerId: string) => {
    const position = positionOf(playerId);
    return Math.max(0, round2((lineOf(playerId)?.points ?? 0) - (replacement.get(position) ?? 0)));
  };
  const positionRanks = rankWithinGroups(universe, (line) => line.position, (line) => line.points, (line) => line.playerId);
  const minGames = Math.max(3, Math.floor(inputs.throughWeek * 0.4));
  const ppgUniverse = universe.filter((line) => line.games >= minGames);
  const ppgRanks = rankWithinGroups(ppgUniverse, (line) => line.position, (line) => line.pointsPerGame, (line) => line.playerId);

  const currentEcr = new Map<string, number>();
  for (const row of inputs.currentFantasyPros?.rankings ?? []) {
    const playerId = fpMap.get(row.fantasyProsId);
    if (playerId && !currentEcr.has(playerId)) currentEcr.set(playerId, row.rank);
  }

  // Risk context.
  const predraftSleeper = new Map((inputs.predraftSleeper?.players ?? []).map((player) => [player.playerId, player]));
  const priorByGsis = new Map(inputs.priorSeasonRows.map((row) => [row.gsisId, row]));
  const priorStarterByTeam = new Map<string, { gsisId: string; attempts: number }>();
  for (const row of inputs.priorSeasonRows) {
    if (row.position !== 'QB') continue;
    const current = priorStarterByTeam.get(row.team);
    if (!current || row.passAttempts > current.attempts) priorStarterByTeam.set(row.team, { gsisId: row.gsisId, attempts: row.passAttempts });
  }
  const predraftStarterByTeam = new Map<string, string>();
  for (const player of [...predraft.values()].sort((a, b) => a.ecrRank - b.ecrRank)) {
    if (player.position === 'QB' && player.team && !predraftStarterByTeam.has(player.team)) predraftStarterByTeam.set(player.team, player.playerId);
  }
  const contractYear = new Set((inputs.contracts?.players ?? []).filter((player) => player.isContractYear).map((player) => player.playerId));
  const sportsbookByName = new Map<string, { market: string; line: number }[]>();
  for (const row of inputs.sportsbook?.overUnder ?? []) {
    const key = normalizeName(row.playerName);
    sportsbookByName.set(key, [...(sportsbookByName.get(key) ?? []), { market: row.market, line: row.line }]);
  }

  // Draft table.
  const orderedPicks = [...inputs.picks].sort((a, b) => a.pick_no - b.pick_no);
  const draftedBy = new Map<string, number>();
  const positionOrder = new Map<string, number>();
  const expected = expectedValueBySlot(orderedPicks.map((pick) => ({ pickNo: pick.pick_no, vor: vorOf(pick.player_id) })), EXPECTED_VALUE_WINDOW);
  const draftedSpreads = orderedPicks.flatMap((pick) => {
    const player = predraft.get(pick.player_id);
    return player?.worstRank != null && player.bestRank != null && player.avgRank ? [(player.worstRank - player.bestRank) / player.avgRank] : [];
  });
  const spreadThreshold = quantile(draftedSpreads, 0.75);
  const unmatched: string[] = [];
  const picks: DraftedPick[] = orderedPicks.map((pick) => {
    const rosterId = rosterIdOf(pick, slotToRoster);
    draftedBy.set(pick.player_id, rosterId);
    const player = info.get(pick.player_id);
    const position = positionOf(pick.player_id);
    const metadataTeam = typeof pick.metadata?.['team'] === 'string' && pick.metadata['team'] ? pick.metadata['team'] : null;
    const pre = predraft.get(pick.player_id);
    if (!pre && isOffensive(position)) unmatched.push(player?.name ?? pick.player_id);
    const order = (positionOrder.get(position) ?? 0) + 1;
    positionOrder.set(position, order);
    const line = lineOf(pick.player_id);
    const positionRank = positionRanks.get(pick.player_id) ?? null;
    const vor = vorOf(pick.player_id);
    const expectedVor = expected.get(pick.pick_no) ?? 0;
    // Descriptive pick cost may fall back to the ordinal ADP rank; the Best Pick replay never does.
    const costPick = pre?.adpPick ?? pre?.adpRank ?? null;
    const delta = adpDelta(pick.pick_no, costPick);
    const gsis = player?.gsisId ?? null;
    const prior = gsis ? priorByGsis.get(gsis) : undefined;
    const draftTeam = metadataTeam ?? pre?.team ?? player?.team ?? null;
    const priorStarter = draftTeam ? priorStarterByTeam.get(draftTeam)?.gsisId : undefined;
    const predraftStarter = draftTeam ? predraftStarterByTeam.get(draftTeam) : undefined;
    const predraftStarterGsis = predraftStarter ? info.get(predraftStarter)?.gsisId : undefined;
    const sleeperPre = predraftSleeper.get(pick.player_id);
    const book = pre ? sportsbookProjectionGap(sportsbookByName.get(normalizeName(pre.name)) ?? [], pre.projectionStats, scoring) : null;
    const isKeeper = pick.is_keeper === true;
    return {
      pickNo: pick.pick_no,
      round: pick.round,
      roundPick: pick.pick_no - (pick.round - 1) * teams,
      draftSlot: pick.draft_slot,
      rosterId,
      manager: managerOf(rosterId),
      playerId: pick.player_id,
      name: player?.name ?? pick.player_id,
      position,
      team: draftTeam,
      isKeeper,
      ecrRank: pre?.ecrRank ?? null,
      ecrPositionRank: pre?.ecrPositionRank ?? null,
      adpRank: pre?.adpRank ?? null,
      adpPick: costPick,
      adpDelta: delta,
      currentEcrRank: currentEcr.get(pick.player_id) ?? null,
      points: line?.points ?? 0,
      games: line?.games ?? 0,
      pointsPerGame: line?.pointsPerGame ?? 0,
      positionRank,
      ppgPositionRank: ppgRanks.get(pick.player_id) ?? null,
      positionDraftOrder: order,
      returnVsSlot: positionRank === null ? null : order - positionRank,
      vor,
      expectedVor,
      valueOverCost: round2(vor - expectedVor),
      risks: isOffensive(position) ? classifyRisks({
        position,
        yearsExp: sleeperPre?.yearsExp ?? inputs.players[pick.player_id]?.years_exp ?? null,
        age: sleeperPre?.age ?? inputs.players[pick.player_id]?.age ?? null,
        priorSeasonGames: prior?.games ?? inputs.priorSeasonSleeperGames.get(pick.player_id) ?? null,
        priorTeam: prior?.team ?? null,
        draftTeam,
        teamQbChanged: priorStarter && predraftStarterGsis ? priorStarter !== predraftStarterGsis : null,
        contractYear: contractYear.has(pick.player_id),
        expertSpread: pre?.worstRank != null && pre.bestRank != null && pre.avgRank ? (pre.worstRank - pre.bestRank) / pre.avgRank : null,
        expertSpreadThreshold: spreadThreshold,
        sportsbookGap: book?.gap ?? null,
        adpDelta: delta,
        isKeeper,
      }) : [],
    };
  });

  // Counterfactual for the manager's picks.
  const rules = deriveRosterRules(inputs.league.roster_positions);
  const projectionUniverse = [...predraft.values()].flatMap((player) => player.projection === null ? [] : [{ position: player.position, points: player.projection }]);
  const projectionReplacement = replacementLevels(projectionUniverse, slots, teams);
  const board = buildBestPickBoard(predraft, projectionReplacement);
  const keeperIds = new Set(picks.filter((pick) => pick.isKeeper).map((pick) => pick.playerId));
  const ecrState = newStrategy();
  const bestPickState = newStrategy();
  const actualIds: string[] = [];
  const counterfactualPicks: CounterfactualPick[] = [];
  const takenByOthers = new Set<string>();
  const summary = (playerId: string | null) => playerId
    ? { name: info.get(playerId)?.name ?? playerId, position: positionOf(playerId), points: lineOf(playerId)?.points ?? 0 }
    : null;
  // Keepers are known before pick 1: both replays start with them rostered and count them once.
  const managerPicks = picks.filter((pick) => pick.rosterId === managerRosterId);
  for (const keeper of managerPicks.filter((pick) => pick.isKeeper)) {
    for (const state of [ecrState, bestPickState]) {
      if (isOffensive(keeper.position)) addToStrategy(state, { playerId: keeper.playerId, position: keeper.position });
      else state.picks.push(keeper.playerId);
    }
  }
  // Only the manager's own non-keeper offensive picks are replayed; selections left and the next pick come from them.
  const replayable = managerPicks.filter((pick) => !pick.isKeeper && isOffensive(pick.position)).map((pick) => pick.pickNo);
  for (const pick of picks) {
    if (pick.rosterId !== managerRosterId) {
      takenByOthers.add(pick.playerId);
      continue;
    }
    actualIds.push(pick.playerId);
    if (pick.isKeeper || !isOffensive(pick.position)) {
      if (!pick.isKeeper) { ecrState.picks.push(pick.playerId); bestPickState.picks.push(pick.playerId); }
      counterfactualPicks.push({ pickNo: pick.pickNo, actual: { name: pick.name, position: pick.position, points: pick.points }, ecr: summary(pick.playerId), bestPick: summary(pick.playerId) });
      continue;
    }
    const available = (state: StrategyState) => [...predraft.values()].flatMap((player) => {
      const position = player.position;
      if (!isOffensive(position) || takenByOthers.has(player.playerId) || keeperIds.has(player.playerId) || state.selected.has(player.playerId)) return [];
      return [{ playerId: player.playerId, position, ecrRank: player.ecrRank, adpPick: player.adpPick }];
    });
    const replayIndex = replayable.indexOf(pick.pickNo);
    const selectionsLeft = replayable.length - replayIndex;
    const remaining = (state: StrategyState) => Math.min(selectionsLeft,
      rules.totalOffensiveSlots - OFFENSIVE_POSITIONS.reduce((sum, position) => sum + state.roster[position].length, 0));

    const ecrChoice = available(ecrState)
      .filter((player) => isLegalCandidate(player, ecrState.roster, rules, remaining(ecrState)))
      .sort((a, b) => a.ecrRank - b.ecrRank)[0];
    if (ecrChoice) addToStrategy(ecrState, ecrChoice); else ecrState.picks.push(null);

    const legal = available(bestPickState).filter((player) => isLegalCandidate(player, bestPickState.roster, rules, remaining(bestPickState)));
    const nextPick = replayable[replayIndex + 1] ?? null;
    const boardPlayers = legal.flatMap((player) => {
      const boardPlayer = board.get(player.playerId);
      return boardPlayer ? [{
        ...boardPlayer,
        ...replayTiming(player, pick.pickNo, nextPick, teams),
      }] : [];
    });
    const result = getRecommendations(boardPlayers, [], 1, {
      currentPick: pick.pickNo,
      totalPicks: teams * rounds,
      totalTeams: teams,
      isMyTurn: true,
      requirements: requirementsFor(rules),
      rosterPlayers: OFFENSIVE_POSITIONS.flatMap((position) => bestPickState.roster[position].map((player) => ({
        id: player.playerId,
        position: player.position,
        projectedPoints: board.get(player.playerId)?.projectedPoints ?? 0,
        ceilingScore: 5,
      }))),
      rosterCounts: {
        QB: bestPickState.roster.QB.length,
        RB: bestPickState.roster.RB.length,
        WR: bestPickState.roster.WR.length,
        TE: bestPickState.roster.TE.length,
      },
      selectionsRemaining: remaining(bestPickState),
    });
    const bestChoice = legal.find((player) => player.playerId === result.selection.preferredPlayerId);
    if (bestChoice) addToStrategy(bestPickState, bestChoice); else bestPickState.picks.push(null);
    counterfactualPicks.push({
      pickNo: pick.pickNo,
      actual: { name: pick.name, position: pick.position, points: pick.points },
      ecr: summary(ecrChoice?.playerId ?? null),
      bestPick: summary(bestChoice?.playerId ?? null),
    });
  }

  // Team summaries.
  const rosterSettings = new Map(inputs.rosters.map((roster) => [roster.roster_id, roster.settings]));
  const addsByRosterPlayer = new Map<string, RosterAdd[]>();
  const transactionCounts = new Map<number, { waiver: number; freeAgent: number; trade: number; faabSpent: number }>();
  for (const { week, rows } of inputs.transactions) {
    if (week > inputs.throughWeek) continue;
    for (const transaction of rows) {
      if (transaction.status !== 'complete') continue;
      const type = transaction.type;
      for (const rosterId of transaction.roster_ids ?? []) {
        const counts = transactionCounts.get(rosterId) ?? { waiver: 0, freeAgent: 0, trade: 0, faabSpent: 0 };
        if (type === 'waiver') {
          counts.waiver += 1;
          const bid = transaction.settings?.['waiver_bid'];
          if (typeof bid === 'number') counts.faabSpent += bid;
        } else if (type === 'free_agent') counts.freeAgent += 1;
        else if (type === 'trade') counts.trade += 1;
        transactionCounts.set(rosterId, counts);
      }
      for (const [playerId, rosterId] of Object.entries(transaction.adds ?? {})) {
        const addType = type === 'waiver' || type === 'free_agent' || type === 'trade' ? type : 'commissioner';
        const key = `${String(rosterId)}:${playerId}`;
        const bid = transaction.settings?.['waiver_bid'];
        addsByRosterPlayer.set(key, [...(addsByRosterPlayer.get(key) ?? []), {
          week, created: transaction.created ?? 0, rosterId, playerId, type: addType,
          transactionId: transaction.transaction_id, faabBid: typeof bid === 'number' ? bid : null,
        }]);
      }
    }
  }

  const sourceTotals = new Map<number, Record<AcquisitionSource, number>>();
  for (const { week, rows } of inputs.matchups) {
    if (week > inputs.throughWeek) continue;
    for (const row of rows) {
      const totals = sourceTotals.get(row.roster_id) ?? { draft: 0, waiver: 0, free_agent: 0, trade: 0, other: 0 };
      const starters = row.starters ?? [];
      starters.forEach((playerId, index) => {
        if (playerId === '0') return;
        const source = acquisitionSource(row.roster_id, playerId, week, addsByRosterPlayer, draftedBy);
        totals[source] = round2(totals[source] + (row.starters_points?.[index] ?? 0));
      });
      sourceTotals.set(row.roster_id, totals);
    }
  }

  const rosterIds = [...new Set(picks.map((pick) => pick.rosterId))].sort((a, b) => a - b);
  const draftValue = new Map(rosterIds.map((rosterId) => [rosterId, round2(picks.filter((pick) => pick.rosterId === rosterId).reduce((sum, pick) => sum + pick.valueOverCost, 0))]));
  const valueRank = new Map([...draftValue].sort((a, b) => b[1] - a[1]).map(([rosterId], index) => [rosterId, index + 1]));
  const draftValueExKeepers = new Map(rosterIds.map((rosterId) => [rosterId, round2(picks.filter((pick) => pick.rosterId === rosterId && !pick.isKeeper).reduce((sum, pick) => sum + pick.valueOverCost, 0))]));
  const valueRankExKeepers = new Map([...draftValueExKeepers].sort((a, b) => b[1] - a[1]).map(([rosterId], index) => [rosterId, index + 1]));
  const pointsFor = (rosterId: number) => {
    const settings = rosterSettings.get(rosterId) ?? {};
    return round2(numberSetting(settings, 'fpts') + numberSetting(settings, 'fpts_decimal') / 100);
  };
  const pointsAgainst = (rosterId: number) => {
    const settings = rosterSettings.get(rosterId) ?? {};
    return round2(numberSetting(settings, 'fpts_against') + numberSetting(settings, 'fpts_against_decimal') / 100);
  };
  // Sleeper's default order: record, then points for, then points against (higher first).
  const standingsOrder = [...rosterIds].sort((a, b) => {
    const sa = rosterSettings.get(a) ?? {};
    const sb = rosterSettings.get(b) ?? {};
    return numberSetting(sb, 'wins') - numberSetting(sa, 'wins') || numberSetting(sa, 'losses') - numberSetting(sb, 'losses')
      || pointsFor(b) - pointsFor(a) || pointsAgainst(b) - pointsAgainst(a);
  });
  const pfOrder = [...rosterIds].sort((a, b) => pointsFor(b) - pointsFor(a));
  const slotOfRoster = new Map(Object.entries(slotToRoster).map(([slot, rosterId]) => [rosterId, Number(slot)]));
  const teamSummaries: TeamSummary[] = rosterIds.map((rosterId) => {
    const teamPicks = picks.filter((pick) => pick.rosterId === rosterId).sort((a, b) => a.round - b.round || a.pickNo - b.pickNo);
    const positionsByRound = teamPicks.map((pick) => pick.position);
    const fresh = teamPicks.filter((pick) => !pick.isKeeper && pick.adpDelta !== null);
    const reach = [...fresh].sort((a, b) => (a.adpDelta ?? 0) - (b.adpDelta ?? 0))[0];
    const value = [...fresh].sort((a, b) => (b.adpDelta ?? 0) - (a.adpDelta ?? 0))[0];
    const settings = rosterSettings.get(rosterId) ?? {};
    const owner = rosterOwner.get(rosterId) ?? '';
    return {
      rosterId,
      manager: managerOf(rosterId),
      teamName: names.get(owner)?.teamName ?? null,
      draftSlot: slotOfRoster.get(rosterId) ?? 0,
      isManager: rosterId === managerRosterId,
      wins: numberSetting(settings, 'wins'),
      losses: numberSetting(settings, 'losses'),
      ties: numberSetting(settings, 'ties'),
      pointsFor: pointsFor(rosterId),
      pointsAgainst: pointsAgainst(rosterId),
      maxPoints: round2(numberSetting(settings, 'ppts') + numberSetting(settings, 'ppts_decimal') / 100),
      standingsRank: standingsOrder.indexOf(rosterId) + 1,
      pointsForRank: pfOrder.indexOf(rosterId) + 1,
      positionsByRound,
      strategy: classifyStrategy(positionsByRound),
      keepers: teamPicks.filter((pick) => pick.isKeeper).map((pick) => `${pick.name} (R${String(pick.round)})`),
      biggestReach: reach && (reach.adpDelta ?? 0) < 0 ? { name: reach.name, pickNo: reach.pickNo, adpDelta: reach.adpDelta ?? 0 } : null,
      biggestValue: value && (value.adpDelta ?? 0) > 0 ? { name: value.name, pickNo: value.pickNo, adpDelta: value.adpDelta ?? 0 } : null,
      draftValueOverCost: draftValue.get(rosterId) ?? 0,
      draftedPoints: round2(teamPicks.reduce((sum, pick) => sum + pick.points, 0)),
      draftGrade: letterGrade(valueRank.get(rosterId) ?? teams, teams),
      draftValueRank: valueRank.get(rosterId) ?? teams,
      draftValueExKeepers: draftValueExKeepers.get(rosterId) ?? 0,
      draftGradeExKeepers: letterGrade(valueRankExKeepers.get(rosterId) ?? teams, teams),
      draftValueRankExKeepers: valueRankExKeepers.get(rosterId) ?? teams,
      starterPointsBySource: sourceTotals.get(rosterId) ?? { draft: 0, waiver: 0, free_agent: 0, trade: 0, other: 0 },
      transactions: transactionCounts.get(rosterId) ?? { waiver: 0, freeAgent: 0, trade: 0, faabSpent: 0 },
      meanAdpDelta: mean(fresh.map((pick) => pick.adpDelta ?? 0)),
      adpDeltaByPosition: positionTally(fresh.map((pick) => ({ position: pick.position, value: pick.adpDelta ?? 0 }))),
      firstQbRound: firstRoundOf(positionsByRound, 'QB'),
      firstTeRound: firstRoundOf(positionsByRound, 'TE'),
    };
  });

  const allTags = [...new Set(teamSummaries.flatMap((team) => team.strategy))].sort();
  const strategies = allTags.map((tag) => {
    const members = teamSummaries.filter((team) => team.strategy.includes(tag));
    const others = teamSummaries.filter((team) => !team.strategy.includes(tag));
    return {
      tag,
      teams: members.map((team) => team.manager),
      meanPointsFor: mean(members.map((team) => team.pointsFor)),
      meanWins: mean(members.map((team) => team.wins)),
      othersMeanPointsFor: mean(others.map((team) => team.pointsFor)),
    };
  });
  const earlyCount = (team: TeamSummary, position: string) => team.positionsByRound.slice(0, 5).filter((value) => value === position).length;
  const strategyCorrelations = [
    { measure: 'RBs in rounds 1-5 vs points for', values: teamSummaries.map((team) => earlyCount(team, 'RB')) },
    { measure: 'WRs in rounds 1-5 vs points for', values: teamSummaries.map((team) => earlyCount(team, 'WR')) },
    { measure: 'Draft value over cost vs points for', values: teamSummaries.map((team) => team.draftValueOverCost) },
    { measure: 'Waiver+FA starter points vs points for', values: teamSummaries.map((team) => team.starterPointsBySource.waiver + team.starterPointsBySource.free_agent) },
    { measure: 'Transactions vs points for', values: teamSummaries.map((team) => team.transactions.waiver + team.transactions.freeAgent + team.transactions.trade) },
  ].map(({ measure, values }) => {
    const rho = spearman(values, teamSummaries.map((team) => team.pointsFor));
    return { measure, n: values.length, rho, interval: rho === null ? null : correlationInterval(rho, values.length) };
  });

  // Manager tendencies: this season's picks against ECR, plus history against pre-draft ECR.
  const tendencyRows: { season: number; userId: string; originalUserId: string; manager: string; position: string; round: number; ecrDelta: number | null; isKeeper: boolean }[] = [];
  for (const pick of picks) {
    tendencyRows.push({
      season: inputs.season, userId: rosterOwner.get(pick.rosterId) ?? '', originalUserId: rosterOwner.get(pick.rosterId) ?? '', manager: pick.manager, position: pick.position,
      round: pick.round, ecrDelta: adpDelta(pick.pickNo, pick.ecrRank), isKeeper: pick.isKeeper,
    });
  }
  // The history importer stores pseudonymized user ids; map them back to this league's live ids to join.
  const liveUserId = new Map(inputs.users.map((user) => [pseudonymizeUserId(user.user_id), user.user_id]));
  for (const history of inputs.history) {
    const historyNames = new Map(history.users.map((user) => [user.user_id, user.display_name ?? user.user_id]));
    for (const pick of history.picks) {
      const recordedId = pick.picked_by ?? '';
      const userId = liveUserId.get(recordedId) ?? recordedId;
      const ecr = inputs.historyEcr.get(`${String(history.season)}:${pick.player_id}`);
      const position = normalizePosition(typeof pick.metadata?.['position'] === 'string' ? pick.metadata['position'] : '');
      tendencyRows.push({
        season: history.season, userId, originalUserId: userId, manager: names.get(userId)?.name ?? historyNames.get(recordedId) ?? userId, position,
        round: pick.round, ecrDelta: adpDelta(pick.pick_no, ecr ?? null), isKeeper: pick.is_keeper === true,
      });
    }
  }
  // Individual rows come from `rows`; the room-average benchmark from every manager in `roomSource`, departed ones too.
  const tendencies = (rows: typeof tendencyRows, roomSource: typeof tendencyRows = rows): ManagerTendency[] => {
    const byUser = new Map<string, typeof tendencyRows>();
    for (const row of rows) if (row.userId) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
    const roomRows = roomSource.filter((row) => row.userId).map((row) => ({ ...row, userId: ROOM_AVERAGE, manager: 'Room average' }));
    return [...byUser, [ROOM_AVERAGE, roomRows] as const].map(([userId, userRows]) => {
      const fresh = userRows.filter((row) => !row.isKeeper && isOffensive(row.position));
      const seasons = [...new Set(userRows.map((row) => row.season))].sort();
      const owners = (season: number) => [...new Set(userRows.filter((row) => row.season === season).map((row) => row.originalUserId))];
      const firstRound = (position: string) => mean(seasons.flatMap((season) => owners(season).flatMap((owner) => {
        const rounds = userRows.filter((row) => row.season === season && row.originalUserId === owner && row.position === position).map((row) => row.round);
        return rounds.length ? [Math.min(...rounds)] : [];
      })));
      const early = userRows.filter((row) => row.round <= 4 && isOffensive(row.position));
      const byPosition: Record<string, { n: number; mean: number | null }> = {};
      for (const position of OFFENSIVE_POSITIONS) {
        const values = fresh.filter((row) => row.position === position && row.ecrDelta !== null).map((row) => row.ecrDelta ?? 0);
        byPosition[position] = { n: values.length, mean: mean(values) };
      }
      const withEcr = fresh.filter((row) => row.ecrDelta !== null);
      return {
        userId,
        manager: userRows[userRows.length - 1]?.manager ?? userId,
        seasons,
        picks: withEcr.length,
        meanEcrDelta: mean(withEcr.map((row) => row.ecrDelta ?? 0)),
        ecrDeltaByPosition: byPosition,
        meanFirstQbRound: firstRound('QB'),
        meanFirstTeRound: firstRound('TE'),
        earlyRbShare: early.length ? round2(early.filter((row) => row.position === 'RB').length / early.length) : null,
      };
    }).sort((a, b) => Number(a.userId === ROOM_AVERAGE) - Number(b.userId === ROOM_AVERAGE) || a.manager.localeCompare(b.manager));
  };
  const currentUsers = new Set(inputs.users.map((user) => user.user_id));
  const historyRows = tendencyRows.filter((row) => currentUsers.has(row.userId));
  const historySeasons = [...new Set(historyRows.map((row) => row.season).filter((season) => season !== inputs.season))].sort();

  // Rankings accuracy and movement.
  const relevant = [...predraft.values()].filter((player) => {
    if (!isOffensive(player.position) || player.ecrPositionRank === null) return false;
    return player.ecrPositionRank <= RELEVANT_POSITION_DEPTH[player.position];
  });
  const actualRank = (playerId: string, position: string) => positionRanks.get(playerId) ?? universe.filter((line) => line.position === position).length + 1;
  const ecrByPosition = OFFENSIVE_POSITIONS.map((position) => {
    const group = relevant.filter((player) => player.position === position);
    return correlationRow(position, group.map((player) => player.ecrPositionRank ?? 0), group.map((player) => actualRank(player.playerId, position)));
  });
  const ecrPpgByPosition = OFFENSIVE_POSITIONS.map((position) => {
    const group = relevant.filter((player) => player.position === position && ppgRanks.has(player.playerId));
    return correlationRow(`${position} (≥${String(minGames)} games)`, group.map((player) => player.ecrPositionRank ?? 0), group.map((player) => ppgRanks.get(player.playerId) ?? 0));
  });
  const rawVor = (line: { playerId: string; position: string; points: number }) => line.points - (replacement.get(line.position) ?? 0);
  const overallVorRank = new Map([...universe].filter((line) => isOffensive(line.position)).sort((a, b) => rawVor(b) - rawVor(a)).map((line, index) => [line.playerId, index + 1]));
  const marketSet = [...predraft.values()].filter((player) => isOffensive(player.position) && player.adpRank !== null && player.adpRank <= 150);
  const actualOverall = marketSet.map((player) => overallVorRank.get(player.playerId) ?? overallVorRank.size + 1);
  const predraftLabel = snapshotDateLabel(inputs.predraftFantasyPros.metadata.refreshedAt);
  const adpVsEcr = [
    { source: `FantasyPros ADP (${predraftLabel})`, row: correlationRow('ADP top 150', marketSet.map((player) => player.adpRank ?? 0), actualOverall) },
    { source: `FantasyPros ECR (${predraftLabel})`, row: correlationRow('ADP top 150', marketSet.map((player) => player.ecrRank), actualOverall) },
    ...(inputs.predraftSleeper ? [{
      source: `Sleeper search rank (${snapshotDateLabel(inputs.predraftSleeper.fetchedAt)})`,
      row: (() => {
        const sleeperRank = new Map(inputs.predraftSleeper.players.map((player) => [player.playerId, player.sleeperAdp]));
        const subset = marketSet.filter((player) => sleeperRank.has(player.playerId));
        return correlationRow('ADP top 150 with Sleeper rank', subset.map((player) => sleeperRank.get(player.playerId) ?? 0), subset.map((player) => overallVorRank.get(player.playerId) ?? overallVorRank.size + 1));
      })(),
    }] : []),
  ];
  const predictionPoints = new Map((inputs.predraftPredictions?.players ?? []).map((player) => [player.playerId, player.projectedPoints]));
  const modelVsFantasyPros = inputs.predraftPredictions ? OFFENSIVE_POSITIONS.flatMap((position) => {
    const group = relevant.filter((player) => player.position === position && player.projection !== null && predictionPoints.has(player.playerId));
    const actual = group.map((player) => -(lineOf(player.playerId)?.points ?? 0));
    return [
      { source: `FantasyPros projection ${position}`, row: correlationRow(position, group.map((player) => -(player.projection ?? 0)), actual) },
      { source: `Shadow model ${position}`, row: correlationRow(position, group.map((player) => -(predictionPoints.get(player.playerId) ?? 0)), actual) },
    ];
  }) : [];
  const draftedIds = new Set(picks.map((pick) => pick.playerId));
  const mover = (playerId: string, position: string, predraftRank: number | null): Mover => {
    const actual = actualRank(playerId, position);
    return {
      name: info.get(playerId)?.name ?? predraft.get(playerId)?.name ?? playerId,
      position,
      predraftPositionRank: predraftRank,
      actualPositionRank: actual,
      change: predraftRank === null ? null : predraftRank - actual,
      points: lineOf(playerId)?.points ?? 0,
      games: lineOf(playerId)?.games ?? 0,
      drafted: draftedIds.has(playerId),
    };
  };
  const movers = relevant.map((player) => mover(player.playerId, player.position, player.ecrPositionRank));
  const risers = movers.filter((row) => (row.change ?? 0) > 0).sort((a, b) => (b.change ?? 0) - (a.change ?? 0)).slice(0, 15);
  const fallers = movers
    .filter((row) => row.predraftPositionRank !== null && isOffensive(row.position) && row.predraftPositionRank <= RELEVANT_POSITION_DEPTH[row.position] / 2)
    .sort((a, b) => (a.change ?? 0) - (b.change ?? 0)).slice(0, 15);
  const unrankedBreakouts = universe
    .filter((line) => isOffensive(line.position))
    .filter((line) => {
      const pre = predraft.get(line.playerId);
      const depth = isOffensive(line.position) ? RELEVANT_POSITION_DEPTH[line.position] : 0;
      return (positionRanks.get(line.playerId) ?? Infinity) <= depth / 2 && (!pre || pre.ecrPositionRank === null || pre.ecrPositionRank > depth);
    })
    .map((line) => mover(line.playerId, line.position, predraft.get(line.playerId)?.ecrPositionRank ?? null))
    .sort((a, b) => a.actualPositionRank - b.actualPositionRank)
    .slice(0, 15);
  const fantasyProsMovement = [...predraft.values()]
    .filter((player) => player.ecrRank <= 200 && currentEcr.has(player.playerId))
    .map((player) => ({ name: player.name, position: player.position, before: player.ecrRank, after: currentEcr.get(player.playerId) ?? 0 }))
    .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))
    .slice(0, 15);
  const currentRankingsAreDraftRankings = (() => {
    const shared = [...predraft.values()].filter((player) => player.ecrRank <= 50 && currentEcr.has(player.playerId));
    const moved = shared.filter((player) => Math.abs((currentEcr.get(player.playerId) ?? 0) - player.ecrRank) > 10);
    return shared.length > 0 && moved.length / shared.length < 0.2;
  })();

  // Risk outcomes.
  const offensivePicks = picks.filter((pick) => isOffensive(pick.position));
  const summarize = (category: RiskCategory | 'all-drafted', members: readonly DraftedPick[]): RiskSummary => {
    const scored = members.filter((pick) => pick.returnVsSlot !== null);
    const hits = scored.filter((pick) => (pick.returnVsSlot ?? 0) >= 0);
    return {
      category,
      n: members.length,
      hits: hits.length,
      hitRate: members.length ? round2(hits.length / members.length) : null,
      meanValueOverCost: mean(members.map((pick) => pick.valueOverCost)),
      meanReturnVsSlot: mean(scored.map((pick) => pick.returnVsSlot ?? 0)),
      paidOff: hits.sort((a, b) => b.valueOverCost - a.valueOverCost).map((pick) => pick.name),
      didNot: members.filter((pick) => !hits.includes(pick)).sort((a, b) => a.valueOverCost - b.valueOverCost).map((pick) => pick.name),
    };
  };
  const riskSummary = [
    summarize('all-drafted', offensivePicks),
    ...RISK_CATEGORIES.map((category) => summarize(category, offensivePicks.filter((pick) => pick.risks.includes(category)))),
  ];

  const myPicks = picks.filter((pick) => pick.rosterId === managerRosterId);
  const byRound = [...new Set(picks.map((pick) => pick.round))].sort((a, b) => a - b).flatMap((roundNo) => {
    const inRound = picks.filter((pick) => pick.round === roundNo).sort((a, b) => b.valueOverCost - a.valueOverCost);
    const best = inRound[0];
    const worst = inRound[inRound.length - 1];
    return best && worst ? [{ round: roundNo, best, worst }] : [];
  });
  const waiverPickups: WaiverPickup[] = pickupStints(inputs.matchups, addsByRosterPlayer, inputs.throughWeek)
    .sort((a, b) => b.started - a.started || b.rostered - a.rostered)
    .slice(0, 15)
    .map((entry) => ({
      name: info.get(entry.playerId)?.name ?? entry.playerId,
      position: positionOf(entry.playerId),
      manager: managerOf(entry.rosterId),
      firstWeek: entry.firstWeek,
      source: entry.source,
      faabBid: entry.faabBid,
      rosteredPoints: entry.rostered,
      startedPoints: entry.started,
    }));

  const myTeam = teamSummaries.find((team) => team.isManager);
  return {
    meta: {
      season: inputs.season,
      throughWeek: inputs.throughWeek,
      standingsThroughWeek: inputs.standingsThroughWeek,
      label: `through week ${String(inputs.throughWeek)}`,
      managerSlot: inputs.managerSlot,
      managerRosterId,
      managerSlotEvidence: inputs.managerSlotEvidence,
      predraftRankingsAt: inputs.predraftFantasyPros.metadata.refreshedAt,
      predraftRankingsLabel: predraftLabel,
      currentRankingsAt: inputs.currentFantasyPros?.metadata.refreshedAt ?? null,
      currentRankingsAreDraftRankings,
      unmatchedDraftedPlayers: unmatched,
      replacementLevels: Object.fromEntries(replacement),
      caveats: [
        `Season-to-date only: ${String(inputs.throughWeek)} scored weeks; playoffs and late-season injuries can reorder everything.`,
        ...(inputs.standingsThroughWeek < inputs.throughWeek ? [`Standings, W-L and points for/against are the league's totals through week ${String(inputs.standingsThroughWeek)} (its last scored week); player stats run through week ${String(inputs.throughWeek)}.`] : []),
        ...inputs.omittedInputs,
        `n = ${String(teams)} teams and one draft; team-level strategy comparisons are anecdotes, not evidence.`,
        'Points are league-scored from Sleeper weekly stats (verified equal to Sleeper matchup players_points for rostered players).',
        'Counterfactuals hold opponents\' picks fixed; a player a strategy takes early is not replaced on the opponent\'s roster.',
        'Value over cost compares each pick\'s VOR (points over positional replacement, floored at 0 because a sub-replacement player is a free waiver swap) with the mean VOR the room realized within ±' + String(EXPECTED_VALUE_WINDOW) + ' picks, so it is relative to this draft, not to a perfect-hindsight draft.',
      ],
    },
    picks,
    myDraft: {
      picks: myPicks,
      grade: myTeam?.draftGrade ?? 'n/a',
      valueRank: myTeam?.draftValueRank ?? 0,
      valueOverCost: myTeam?.draftValueOverCost ?? 0,
      gradeExKeepers: myTeam?.draftGradeExKeepers ?? 'n/a',
      valueRankExKeepers: myTeam?.draftValueRankExKeepers ?? 0,
      valueOverCostExKeepers: myTeam?.draftValueExKeepers ?? 0,
      reaches: myPicks.filter((pick) => !pick.isKeeper && (pick.adpDelta ?? 0) <= -6).sort((a, b) => (a.adpDelta ?? 0) - (b.adpDelta ?? 0)),
      waits: myPicks.filter((pick) => !pick.isKeeper && (pick.adpDelta ?? 0) >= 6).sort((a, b) => (b.adpDelta ?? 0) - (a.adpDelta ?? 0)),
      counterfactual: {
        picks: counterfactualPicks,
        actual: strategyTotals(actualIds, positionOf, lines, vorOf, rules, slots),
        ecr: strategyTotals(ecrState.picks, positionOf, lines, vorOf, rules, slots),
        bestPick: strategyTotals(bestPickState.picks, positionOf, lines, vorOf, rules, slots),
        bestPickMethod: `Current shipped Best Pick rule (shared getRecommendations, best-pick-policy) replayed on the ${predraftLabel} FantasyPros board with league-scored projections, VOR, FantasyPros average pick as market cost (ECR without one) and the backtest survival curve; live-only inputs (news, bye weeks, contracts, environment, league-history survival) are neutral. The draft-day app also used live Fantasy Football Calculator ADP and the league survival model, which cannot be replayed exactly. A replayed roster that cannot fill every required starter has no best-lineup total.`,
      },
    },
    teams: teamSummaries,
    strategies,
    adpCalibration: (() => {
      const deltas = picks.filter((pick) => !pick.isKeeper && pick.adpDelta !== null).map((pick) => pick.adpDelta ?? 0);
      return {
        n: deltas.length,
        withinOneRound: deltas.length ? round2(deltas.filter((delta) => Math.abs(delta) <= teams).length / deltas.length) : null,
        meanAbsoluteDelta: mean(deltas.map(Math.abs)),
        meanDelta: mean(deltas),
      };
    })(),
    strategyCorrelations,
    tendencies: {
      current: tendencies(tendencyRows.filter((row) => row.season === inputs.season)),
      withHistory: tendencies(historyRows, tendencyRows.filter((row) => row.season === inputs.season || historySeasons.includes(row.season))),
      historySeasons,
    },
    rankings: { ecrByPosition, ecrPpgByPosition, adpVsEcr, modelVsFantasyPros, risers, fallers, unrankedBreakouts, fantasyProsMovement },
    risks: {
      expertSpreadThreshold: spreadThreshold === null ? null : round2(spreadThreshold),
      summary: riskSummary,
      myTeam: myPicks.map((pick) => ({ name: pick.name, risks: pick.risks, returnVsSlot: pick.returnVsSlot, valueOverCost: pick.valueOverCost })),
    },
    returns: {
      topValue: [...picks].sort((a, b) => b.valueOverCost - a.valueOverCost).slice(0, 15),
      worstValue: [...picks].sort((a, b) => a.valueOverCost - b.valueOverCost).slice(0, 10),
      byRound,
      waiverPickups,
    },
  };
}
