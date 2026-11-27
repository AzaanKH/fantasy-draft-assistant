import { optimizeLineupUtility } from '@fantasy-draft/shared/draft';
import { OFFENSIVE_POSITIONS, POSITIONS, isFlexEligible, type Player, type Position, type RosterRequirements } from '@fantasy-draft/shared/league';

/** The player facts the Roster needs tab reads. `Player` satisfies it. */
export type RosterPlayer = Pick<Player, 'id' | 'name' | 'position' | 'projectedPoints' | 'ceilingScore' | 'byeWeek'>;

export type SlotGroup = Position | 'FLEX';

export interface LineupSlot<P extends RosterPlayer = RosterPlayer> {
  /** Stable across candidates: "RB-1", "FLEX-0". */
  readonly key: string;
  /** "QB", "RB1", "FLEX". */
  readonly label: string;
  readonly group: SlotGroup;
  readonly player: P | null;
}

export interface Lineup<P extends RosterPlayer = RosterPlayer> {
  readonly slots: readonly LineupSlot<P>[];
  readonly bench: readonly P[];
  /** Projected season points of the starters, from the shared lineup optimizer. */
  readonly points: number;
}

/** Display order: QB beside TE, then the RB pair, the WR pair, FLEX, and kicker/defense last. */
const SLOT_ORDER: Readonly<Record<Position, number>> = { QB: 0, TE: 1, RB: 2, WR: 3, K: 5, DEF: 6 };
const FLEX_ORDER = 4;

const byPointsDesc = (first: RosterPlayer, second: RosterPlayer): number => second.projectedPoints - first.projectedPoints;

function slotLabel(group: SlotGroup, index: number, count: number): string {
  return count === 1 ? group : `${group}${String(index + 1)}`;
}

/**
 * Seat a roster in the league's starting slots the way `optimizeLineupUtility` scores it: each position's fixed
 * starters by projection, then the best leftover FLEX-eligible players. Everyone else is bench.
 */
export function buildLineup<P extends RosterPlayer>(roster: readonly P[], requirements: RosterRequirements): Lineup<P> {
  const used = new Set<string>();
  const groups: { readonly group: SlotGroup; readonly order: number; readonly players: readonly (P | null)[] }[] = [];
  for (const position of POSITIONS) {
    const count = requirements[position].starters;
    if (count === 0) continue;
    const seated = roster.filter((player) => player.position === position).sort(byPointsDesc).slice(0, count);
    seated.forEach((player) => used.add(player.id));
    groups.push({ group: position, order: SLOT_ORDER[position], players: Array.from({ length: count }, (_, index) => seated[index] ?? null) });
  }
  if (requirements.FLEX.starters > 0) {
    const count = requirements.FLEX.starters;
    const seated = roster.filter((player) => !used.has(player.id) && isFlexEligible(requirements, player.position)).sort(byPointsDesc).slice(0, count);
    seated.forEach((player) => used.add(player.id));
    groups.push({ group: 'FLEX', order: FLEX_ORDER, players: Array.from({ length: count }, (_, index) => seated[index] ?? null) });
  }
  const slots = groups
    .sort((first, second) => first.order - second.order)
    .flatMap(({ group, players }) => players.map((player, index) => ({
      key: `${group}-${String(index)}`,
      label: slotLabel(group, index, players.length),
      group,
      player,
    })));
  return {
    slots,
    bench: roster.filter((player) => !used.has(player.id)).sort(byPointsDesc),
    points: optimizeLineupUtility(roster, requirements),
  };
}

export interface CandidatePreview<P extends RosterPlayer = RosterPlayer> {
  readonly before: Lineup<P>;
  readonly after: Lineup<P>;
  /** The slot the candidate takes, or null when he lands on the bench. */
  readonly slotKey: string | null;
  /** The starter he moves out of that slot, if any (he may slide to FLEX or the bench). */
  readonly displaced: P | null;
  /** Projected starter points added (never negative: the optimizer only seats him when he helps). */
  readonly gain: number;
}

export function previewCandidate<P extends RosterPlayer>(roster: readonly P[], candidate: P, requirements: RosterRequirements): CandidatePreview<P> {
  const before = buildLineup(roster, requirements);
  const after = buildLineup([...roster, candidate], requirements);
  const slot = after.slots.find((item) => item.player?.id === candidate.id) ?? null;
  const displaced = slot ? before.slots.find((item) => item.key === slot.key)?.player ?? null : null;
  return { before, after, slotKey: slot?.key ?? null, displaced, gain: after.points - before.points };
}

export interface PositionLadder {
  readonly position: Position;
  /** 1 is best. Teams with equal points share a rank. */
  readonly now: number;
  readonly after: number;
}

export interface TeamStrength {
  readonly teamIndex: number;
  readonly isMine: boolean;
  /** Projected starter points by position, with FLEX starters counted at their own position. */
  readonly points: Readonly<Partial<Record<Position, number>>>;
}

export interface LeagueRanks {
  readonly teamCount: number;
  readonly ladders: readonly PositionLadder[];
  readonly teams: readonly TeamStrength[];
  /** Your points by position once the candidate is added. */
  readonly myPointsAfter: Readonly<Partial<Record<Position, number>>>;
}

/** Offensive positions this league starts, directly or through FLEX. */
export function rankedPositions(requirements: RosterRequirements): readonly Position[] {
  return OFFENSIVE_POSITIONS.filter((position) => requirements[position].starters > 0 || isFlexEligible(requirements, position));
}

function starterPointsByPosition(lineup: Lineup, positions: readonly Position[]): Partial<Record<Position, number>> {
  const points: Partial<Record<Position, number>> = {};
  for (const position of positions) points[position] = 0;
  for (const slot of lineup.slots) {
    if (slot.player && points[slot.player.position] !== undefined) points[slot.player.position] = (points[slot.player.position] ?? 0) + slot.player.projectedPoints;
  }
  return points;
}

function rankAmong(value: number, others: readonly number[]): number {
  return 1 + others.filter((other) => other > value).length;
}

/**
 * Where your starters rank at each position among the league's real rosters, now and with the candidate added.
 * Null until another team has drafted someone: before that every team ties and a rank would mean nothing.
 */
export function computeLeagueRanks(input: {
  readonly teamRosters: readonly (readonly RosterPlayer[])[];
  readonly myTeamIndex: number;
  readonly candidate: RosterPlayer | null;
  readonly requirements: RosterRequirements;
}): LeagueRanks | null {
  const { teamRosters, myTeamIndex, candidate, requirements } = input;
  const mine = teamRosters[myTeamIndex];
  if (!mine || teamRosters.length < 2) return null;
  const othersDrafted = teamRosters.some((roster, index) => index !== myTeamIndex && roster.length > 0);
  if (!othersDrafted) return null;
  const positions = rankedPositions(requirements);
  const teams = teamRosters.map((roster, teamIndex): TeamStrength => ({
    teamIndex,
    isMine: teamIndex === myTeamIndex,
    points: starterPointsByPosition(buildLineup(roster, requirements), positions),
  }));
  const myPointsAfter = candidate ? starterPointsByPosition(buildLineup([...mine, candidate], requirements), positions) : teams[myTeamIndex]?.points ?? {};
  const ladders = positions.map((position): PositionLadder => {
    const others = teams.filter((team) => !team.isMine).map((team) => team.points[position] ?? 0);
    return {
      position,
      now: rankAmong(teams[myTeamIndex]?.points[position] ?? 0, others),
      after: rankAmong(myPointsAfter[position] ?? 0, others),
    };
  });
  return { teamCount: teamRosters.length, ladders, teams, myPointsAfter };
}

export interface ByeWeek<P extends RosterPlayer = RosterPlayer> {
  readonly week: number;
  /** Starters (after the candidate is added) on bye this week. */
  readonly out: readonly P[];
}

export interface ByeStrip<P extends RosterPlayer = RosterPlayer> {
  readonly weeks: readonly ByeWeek<P>[];
  /** Starters who share the candidate's bye week; empty when he clashes with nobody. */
  readonly clashWith: readonly P[];
  /** The candidate's bye, or null when it is unknown. */
  readonly candidateWeek: number | null;
}

/** The league's bye window, from the earliest to the latest bye week in the player catalog. */
export function byeWindow(players: Iterable<Pick<Player, 'byeWeek'>>): { readonly first: number; readonly last: number } | null {
  let first = Infinity;
  let last = -Infinity;
  for (const { byeWeek } of players) {
    if (!Number.isInteger(byeWeek) || byeWeek <= 0) continue;
    first = Math.min(first, byeWeek);
    last = Math.max(last, byeWeek);
  }
  return Number.isFinite(first) ? { first, last } : null;
}

/** Every week in the bye window with the starters out that week, and who shares the candidate's bye. */
export function buildByeStrip<P extends RosterPlayer>(starters: readonly P[], candidate: P, window: { readonly first: number; readonly last: number }): ByeStrip<P> {
  const weeks: ByeWeek<P>[] = [];
  for (let week = window.first; week <= window.last; week += 1) {
    weeks.push({ week, out: starters.filter((player) => player.byeWeek === week) });
  }
  const candidateWeek = Number.isInteger(candidate.byeWeek) && candidate.byeWeek > 0 ? candidate.byeWeek : null;
  const clashWith = candidateWeek === null ? [] : starters.filter((player) => player.id !== candidate.id && player.byeWeek === candidateWeek);
  return { weeks, clashWith, candidateWeek };
}

export function ordinal(rank: number): string {
  const tens = rank % 100;
  if (tens >= 11 && tens <= 13) return `${String(rank)}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[rank % 10] ?? 'th';
  return `${String(rank)}${suffix}`;
}

/** Left offset, in percent, of a rank on a track from 1st (left) to last (right). */
export function rankOffset(rank: number, teamCount: number): number {
  if (teamCount <= 1) return 0;
  return ((Math.min(Math.max(rank, 1), teamCount) - 1) / (teamCount - 1)) * 100;
}
