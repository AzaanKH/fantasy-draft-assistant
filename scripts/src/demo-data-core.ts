import type {
  ECRPlayer,
  FantasyProsAdpPlayer,
  FantasyProsProjection,
  FantasyProsSnapshot,
  NFLTeam,
  Position,
} from '@fantasy-draft/shared';

/**
 * The public demo ships real players with rankings from the FantasyPros-free
 * model blended with Sleeper's platform order. These helpers are pure so the
 * blend and the leak checks can be tested without the local data files.
 */

export const DEMO_ID_PREFIX = 'demo-';
export const DEMO_RANKING_COUNT = 400;
export const DEMO_LEAGUE_NAME = 'Demo League';
export const DEMO_SNAPSHOT_SOURCE =
  'Demo: FantasyPros-free projection model blended with Sleeper search rank';

export interface DemoPredictionPlayer {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
  /** Full-PPR total before this league's bonuses. */
  readonly baseProjectedPoints: number;
  readonly projectedPoints: number;
  readonly valueOverReplacement: number;
  readonly uncertaintyScore: number;
}

/** Per-game averages over the player's last three regular seasons. */
export interface DemoStatHistory {
  readonly passingYards: number;
  readonly passingTouchdowns: number;
  readonly rushingYards: number;
  readonly rushingTouchdowns: number;
  readonly receivingYards: number;
  readonly receivingTouchdowns: number;
}

/** The model's own volume inputs, used for this league's bonuses. */
export interface DemoVolume {
  readonly projectedRushAttempts: number;
  readonly projectedReceptions: number;
}

export interface DemoSleeperPlayer {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam | null;
  readonly sleeperAdp: number;
}

export interface DemoRankedPlayer {
  readonly sleeperId: string;
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
  /** Overall demo ranking, from 1. */
  readonly rank: number;
  /** Overall market rank: Sleeper's order within the position, placed in this position's demo slots. */
  readonly adpRank: number;
  readonly prediction: DemoPredictionPlayer | null;
}

/**
 * Kickers and defenses go in the late rounds, at their Sleeper rank but never
 * before this pick. Every one stays in the pool, even past the ranking count.
 */
export const LATE_ROUND_START = 150;
const LATE_ROUND_POSITIONS: ReadonlySet<Position> = new Set<Position>(['K', 'DEF']);
const UNRANKED_SLEEPER_ADP = 999;

/**
 * The model gets more weight when it is confident. Uncertainty runs from 1 to
 * 10, so rookies and thin histories lean on Sleeper's order instead.
 */
export function modelWeight(uncertaintyScore: number): number {
  return Math.min(0.6, Math.max(0.15, 0.65 - 0.05 * uncertaintyScore));
}

const round = (value: number, digits = 2): number => Number(value.toFixed(digits));

export function demoPlayerId(sleeperId: string): string {
  return `${DEMO_ID_PREFIX}${sleeperId}`;
}

interface PositionSlot {
  readonly player: DemoSleeperPlayer & { readonly team: NFLTeam };
  readonly prediction: DemoPredictionPlayer | null;
  readonly sleeperRank: number;
  /** Comparable across positions: the model's value over replacement for this positional rank. */
  readonly value: number;
}

/**
 * Sleeper's search_rank over-ranks quarterbacks, so ranks are blended within
 * each position. The model's value-over-replacement curve then compares the
 * k-th player at one position with the k-th at another.
 */
function positionSlots(
  position: Position,
  predictions: readonly DemoPredictionPlayer[],
  sleeperOrder: readonly (DemoSleeperPlayer & { readonly team: NFLTeam })[]
): readonly PositionSlot[] {
  const positionPredictions = predictions.filter((player) => player.position === position);
  const byPlayer = new Map(positionPredictions.map((player) => [player.playerId, player]));
  const modelRanks = new Map(
    [...positionPredictions]
      .sort((left, right) => right.projectedPoints - left.projectedPoints)
      .map((player, index) => [player.playerId, index + 1])
  );
  const valueCurve = positionPredictions
    .map((player) => player.valueOverReplacement)
    .sort((left, right) => right - left);
  return sleeperOrder
    .filter((player) => player.position === position)
    .map((player, index) => {
      const prediction = byPlayer.get(player.playerId) ?? null;
      const modelRank = modelRanks.get(player.playerId);
      const weight = prediction ? modelWeight(prediction.uncertaintyScore) : 0;
      const sleeperRank = sleeperOrder.indexOf(player) + 1;
      // Sleeper leaves defenses unranked, so only the model can order them.
      const unranked = player.sleeperAdp >= UNRANKED_SLEEPER_ADP;
      return {
        player,
        prediction,
        sleeperRank,
        positionalSleeperRank: index + 1,
        blended: modelRank === undefined
          ? index + 1
          : unranked ? modelRank : weight * modelRank + (1 - weight) * (index + 1),
      };
    })
    .sort((left, right) => left.blended - right.blended || left.positionalSleeperRank - right.positionalSleeperRank)
    .map((slot, index) => ({
      player: slot.player,
      prediction: slot.prediction,
      sleeperRank: slot.sleeperRank,
      value: valueCurve[index] ?? Number.NEGATIVE_INFINITY,
    }));
}

export function blendDemoRankings(
  predictions: readonly DemoPredictionPlayer[],
  sleeperPlayers: readonly DemoSleeperPlayer[],
  count: number = DEMO_RANKING_COUNT
): readonly DemoRankedPlayer[] {
  const projected = new Set(predictions.map((player) => player.playerId));
  const sleeperOrder = sleeperPlayers
    .filter((player): player is DemoSleeperPlayer & { readonly team: NFLTeam } =>
      player.team !== null && Number.isFinite(player.sleeperAdp) && player.sleeperAdp > 0 &&
      (player.sleeperAdp < UNRANKED_SLEEPER_ADP ||
        (LATE_ROUND_POSITIONS.has(player.position) && projected.has(player.playerId))))
    .sort((left, right) => left.sleeperAdp - right.sleeperAdp);
  const positions = [...new Set(sleeperOrder.map((player) => player.position))];
  const slotsByPosition = new Map(positions.map((position) =>
    [position, positionSlots(position, predictions, sleeperOrder)] as const));
  const skill = positions
    .filter((position) => !LATE_ROUND_POSITIONS.has(position))
    .flatMap((position) => slotsByPosition.get(position) ?? [])
    .sort((left, right) => right.value - left.value || left.sleeperRank - right.sleeperRank);
  // Each position keeps its blended order; Sleeper's ranks for that position
  // only decide when its k-th player is due.
  const lateRound = positions
    .filter((position) => LATE_ROUND_POSITIONS.has(position))
    .flatMap((position) => {
      const slots = slotsByPosition.get(position) ?? [];
      const dueRanks = slots.map((slot) => slot.sleeperRank).sort((left, right) => left - right);
      return slots.map((slot, index) => ({ ...slot, sleeperRank: dueRanks[index] ?? slot.sleeperRank }));
    })
    .sort((left, right) => left.sleeperRank - right.sleeperRank);

  const ordered: PositionSlot[] = [];
  let skillIndex = 0;
  let lateIndex = 0;
  while (ordered.length < count && (skillIndex < skill.length || lateIndex < lateRound.length)) {
    const late = lateRound[lateIndex];
    const lateIsDue = late !== undefined &&
      Math.max(LATE_ROUND_START, late.sleeperRank) <= ordered.length + 1;
    const next = lateIsDue || skillIndex >= skill.length ? lateRound[lateIndex++] : skill[skillIndex++];
    if (next) ordered.push(next);
  }
  ordered.push(...lateRound.slice(lateIndex));

  // The market keeps Sleeper's order within each position in this ranking's slots.
  const adpRanks = new Map<string, number>();
  for (const position of positions) {
    const demoSlots = ordered
      .map((slot, index) => ({ slot, rank: index + 1 }))
      .filter(({ slot }) => slot.player.position === position);
    const marketOrder = demoSlots
      .map(({ slot }) => slot)
      .sort((left, right) => left.sleeperRank - right.sleeperRank);
    marketOrder.forEach((slot, index) => {
      adpRanks.set(slot.player.playerId, demoSlots[index]?.rank ?? index + 1);
    });
  }

  return ordered.map((slot, index) => ({
    sleeperId: slot.player.playerId,
    name: slot.player.name,
    position: slot.player.position,
    team: slot.player.team,
    rank: index + 1,
    adpRank: adpRanks.get(slot.player.playerId) ?? index + 1,
    prediction: slot.prediction,
  }));
}

/** Full-PPR rates; the components below reproduce the neutral total under them. */
const PPR_YARD_TOUCHDOWN_POINTS: Readonly<Record<keyof DemoStatHistory, number>> = {
  passingYards: 0.04,
  passingTouchdowns: 4,
  rushingYards: 0.1,
  rushingTouchdowns: 6,
  receivingYards: 0.1,
  receivingTouchdowns: 6,
};

/**
 * The model projects totals, not yards and touchdowns. Receptions and rush
 * attempts are the model's own inputs; the rest of the full-PPR total is split
 * across yards and touchdowns in the player's recent per-game mix, so the
 * components add back up to the neutral total under full-PPR rules.
 */
export function demoProjection(
  player: DemoRankedPlayer,
  prediction: DemoPredictionPlayer,
  volume: DemoVolume | undefined,
  history: DemoStatHistory | undefined
): FantasyProsProjection {
  const base = prediction.baseProjectedPoints;
  const receptions = volume?.projectedReceptions ?? 0;
  // Net-negative yardage counts as zero.
  const perGame = (stat: keyof DemoStatHistory): number => Math.max(0, history?.[stat] ?? 0);
  const historyPoints = (Object.keys(PPR_YARD_TOUCHDOWN_POINTS) as (keyof DemoStatHistory)[])
    .reduce((sum, stat) => sum + perGame(stat) * PPR_YARD_TOUCHDOWN_POINTS[stat], 0);
  const scale = history && historyPoints > 0 && base > receptions
    ? (base - receptions) / historyPoints
    : null;
  const component = (stat: keyof DemoStatHistory): number =>
    round(perGame(stat) * (scale ?? 0), 3);
  // Like FantasyPros, no floor or ceiling: the app derives both from the re-scored total.
  return {
    fantasyProsId: demoPlayerId(player.sleeperId),
    name: player.name,
    position: player.position,
    team: player.team,
    projectedPoints: base,
    baseProjectedPoints: base,
    ...(volume
      ? {
          projectedRushAttempts: round(volume.projectedRushAttempts, 3),
          projectedReceptions: round(receptions, 3),
        }
      : {}),
    ...(scale === null
      ? {}
      : {
          projectedPassingYards: component('passingYards'),
          projectedPassingTouchdowns: component('passingTouchdowns'),
          projectedRushingYards: component('rushingYards'),
          projectedRushingTouchdowns: component('rushingTouchdowns'),
          projectedReceivingYards: component('receivingYards'),
          projectedReceivingTouchdowns: component('receivingTouchdowns'),
        }),
  };
}

export function buildDemoSnapshot(
  ranked: readonly DemoRankedPlayer[],
  byeWeeks: Readonly<Partial<Record<NFLTeam, number>>>,
  season: number,
  refreshedAt: string,
  volumes: ReadonlyMap<string, DemoVolume> = new Map(),
  histories: ReadonlyMap<string, DemoStatHistory> = new Map()
): FantasyProsSnapshot {
  const positionCounts = new Map<Position, number>();
  const rankings: ECRPlayer[] = ranked.map((player) => {
    const positionalRank = (positionCounts.get(player.position) ?? 0) + 1;
    positionCounts.set(player.position, positionalRank);
    return {
      fantasyProsId: demoPlayerId(player.sleeperId),
      rank: player.rank,
      name: player.name,
      position: player.position,
      team: player.team,
      byeWeek: byeWeeks[player.team] ?? 0,
      positionalRank,
      bestRank: Math.min(player.rank, player.adpRank),
      worstRank: Math.max(player.rank, player.adpRank),
      avgRank: round((player.rank + player.adpRank) / 2),
    };
  });

  const adpCounts = new Map<Position, number>();
  const adp: FantasyProsAdpPlayer[] = [...ranked]
    .sort((left, right) => left.adpRank - right.adpRank)
    .map((player) => {
      const positionalRank = (adpCounts.get(player.position) ?? 0) + 1;
      adpCounts.set(player.position, positionalRank);
      return {
        fantasyProsId: demoPlayerId(player.sleeperId),
        rank: player.adpRank,
        name: player.name,
        position: player.position,
        team: player.team,
        positionalRank,
        bestRank: player.adpRank,
        worstRank: player.adpRank,
        averageRank: player.adpRank,
      };
    });

  // Totals are neutral full PPR with stat components, so the app re-scores
  // them for whatever scoring rules the visitor selects.
  const projections: FantasyProsProjection[] = ranked.flatMap((player) => player.prediction
    ? [demoProjection(
        player,
        player.prediction,
        volumes.get(player.sleeperId),
        histories.get(player.sleeperId)
      )]
    : []);

  return {
    metadata: {
      season,
      sourceType: 'fixture',
      source: DEMO_SNAPSHOT_SOURCE,
      refreshedAt,
      rankingCount: rankings.length,
      adpCount: adp.length,
      projectionCount: projections.length,
      newsCount: 0,
    },
    rankings,
    adp,
    projections,
    news: [],
  };
}

export interface DemoIdentity {
  readonly canonicalId: string;
  readonly sleeperId: string;
  readonly fantasyProsId: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly position: Position;
  readonly team: NFLTeam;
  readonly matchMethod: 'demo-sleeper-id';
}

export function buildDemoIdentities(
  sleeperPlayers: readonly DemoSleeperPlayer[]
): readonly DemoIdentity[] {
  return sleeperPlayers.flatMap((player) => player.team === null ? [] : [{
    canonicalId: player.playerId,
    sleeperId: player.playerId,
    fantasyProsId: demoPlayerId(player.playerId),
    name: player.name,
    aliases: [player.name],
    position: player.position,
    team: player.team,
    matchMethod: 'demo-sleeper-id' as const,
  }]);
}

interface SurvivalModelLike {
  readonly leagueName?: unknown;
  readonly sourceResponsibilities?: unknown;
  readonly managerTendencies?: readonly Readonly<Record<string, unknown>>[];
  readonly [key: string]: unknown;
}

/** Keeps the league's aggregate draft behavior but drops its name and member IDs. */
export function anonymizeSurvivalModel(model: SurvivalModelLike): SurvivalModelLike {
  return {
    ...model,
    leagueName: DEMO_LEAGUE_NAME,
    sourceResponsibilities: {
      ...(typeof model.sourceResponsibilities === 'object' ? model.sourceResponsibilities : {}),
      currentConsensusMarket:
        'The demo ranking maps current players into the historical distribution.',
    },
    managerTendencies: (model.managerTendencies ?? []).map((tendency, index) => ({
      ...tendency,
      managerKey: `demo-manager-${String(index + 1)}`,
    })),
  };
}

const LEAK_PATTERNS: readonly (readonly [label: string, pattern: RegExp])[] = [
  ['the real league name', /ummati/i],
  ['a FantasyPros URL', /fantasypros\.com/i],
  ['a Sleeper user ID', /\buser_[0-9a-f]{6,}/i],
  ['a Sleeper league or draft ID', /\b\d{17,20}\b/],
];

/**
 * A fantasyProsId set to a string or number literal, in JSON, compiled
 * JavaScript (unquoted or single-quoted keys), or escaped inside a source map.
 * Assignments from variables, such as `fantasyProsId:t.id`, are not literals.
 */
const FANTASYPROS_ID_LITERAL =
  /fantasyProsId\\*["'`]?\s*:\s*(?:\\*["'`]([^"'`\\$]*)\\*["'`]|(\d+)\b)/g;

/** Returns a description of each leak found in one published file. */
export function findDemoDataLeaks(fileName: string, content: string): readonly string[] {
  const leaks = LEAK_PATTERNS.flatMap(([label, pattern]) =>
    pattern.test(content) ? [`${fileName} contains ${label}`] : []);
  for (const match of content.matchAll(FANTASYPROS_ID_LITERAL)) {
    const id = match[1] ?? match[2] ?? '';
    if (!id.startsWith(DEMO_ID_PREFIX)) {
      leaks.push(`${fileName} contains a FantasyPros player ID (${id})`);
      break;
    }
  }
  return leaks;
}
