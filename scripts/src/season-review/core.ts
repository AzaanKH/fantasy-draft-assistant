/**
 * Pure calculations for the in-season draft retrospective. Nothing here reads files, the network or the clock,
 * so every number in the report can be reproduced from the raw inputs and unit-tested.
 */
import {
  OFFENSIVE_POSITIONS,
  calculateLeagueProjection,
  isPosition,
  type OffensivePosition,
  type ScoringRules,
} from '@fantasy-draft/shared/league';

export type StatLine = Readonly<Record<string, number>>;

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * League-scored fantasy points: the dot product of a raw Sleeper stat line and the league's scoring settings.
 * Sleeper's own `players_points` in matchups equal this sum, so it also scores players nobody rostered.
 */
export function scoreStats(stats: StatLine, scoring: StatLine): number {
  let total = 0;
  for (const [key, value] of Object.entries(stats)) {
    const weight = scoring[key];
    if (weight !== undefined && Number.isFinite(value)) total += value * weight;
  }
  return round2(total);
}

export interface PlayerSeasonLine {
  readonly playerId: string;
  readonly points: number;
  readonly games: number;
  readonly pointsPerGame: number;
  readonly weeklyPoints: readonly number[];
}

/** Season-to-date totals per player. A game counts when Sleeper records `gp > 0` for the week. */
export function aggregateSeason(
  weeks: readonly { readonly week: number; readonly stats: Readonly<Record<string, StatLine>> }[],
  scoring: StatLine
): Map<string, PlayerSeasonLine> {
  const totals = new Map<string, { points: number; games: number; weekly: number[] }>();
  const ordered = [...weeks].sort((a, b) => a.week - b.week);
  ordered.forEach(({ stats }, index) => {
    for (const [playerId, line] of Object.entries(stats)) {
      const points = scoreStats(line, scoring);
      const played = (line['gp'] ?? 0) > 0;
      if (!played && points === 0) continue;
      const entry = totals.get(playerId) ?? { points: 0, games: 0, weekly: new Array<number>(ordered.length).fill(0) };
      entry.points += points;
      if (played) entry.games += 1;
      entry.weekly[index] = points;
      totals.set(playerId, entry);
    }
  });
  return new Map([...totals].map(([playerId, entry]) => [playerId, {
    playerId,
    points: round2(entry.points),
    games: entry.games,
    pointsPerGame: entry.games > 0 ? round2(entry.points / entry.games) : 0,
    weeklyPoints: entry.weekly.map(round2),
  }]));
}

/** 1-based rank of each id within its group, best value first; ties keep input order. */
export function rankWithinGroups<T>(
  items: readonly T[],
  groupOf: (item: T) => string,
  valueOf: (item: T) => number,
  idOf: (item: T) => string
): Map<string, number> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(groupOf(item)) ?? [];
    group.push(item);
    groups.set(groupOf(item), group);
  }
  const ranks = new Map<string, number>();
  for (const group of groups.values()) {
    [...group].sort((a, b) => valueOf(b) - valueOf(a)).forEach((item, index) => ranks.set(idOf(item), index + 1));
  }
  return ranks;
}

export interface StarterSlots {
  readonly fixed: Readonly<Partial<Record<string, number>>>;
  readonly flex: number;
  readonly flexEligible: ReadonlySet<string>;
}

/** Fixed starters per position and FLEX count from Sleeper `roster_positions`. */
export function starterSlotsFromRoster(rosterPositions: readonly string[], flexEligible: readonly string[]): StarterSlots {
  const fixed: Record<string, number> = {};
  for (const slot of rosterPositions) if (isPosition(slot)) fixed[slot] = (fixed[slot] ?? 0) + 1;
  return { fixed, flex: rosterPositions.filter((slot) => slot === 'FLEX').length, flexEligible: new Set(flexEligible) };
}

/**
 * Replacement level per position: the best player left after every team fills its fixed starters and FLEX slots
 * with the highest scorers. Value over replacement (VOR) puts positions on one scale.
 */
export function replacementLevels(
  players: readonly { readonly position: string; readonly points: number }[],
  slots: StarterSlots,
  teams: number
): Map<string, number> {
  const byPosition = new Map<string, number[]>();
  for (const player of players) {
    const list = byPosition.get(player.position) ?? [];
    list.push(player.points);
    byPosition.set(player.position, list);
  }
  for (const list of byPosition.values()) list.sort((a, b) => b - a);
  const used = new Map<string, number>();
  for (const [position, count] of Object.entries(slots.fixed)) used.set(position, (count ?? 0) * teams);
  const flexPool = [...byPosition]
    .filter(([position]) => slots.flexEligible.has(position))
    .flatMap(([position, list]) => list.slice(used.get(position) ?? 0).map((points) => ({ position, points })))
    .sort((a, b) => b.points - a.points)
    .slice(0, slots.flex * teams);
  for (const { position } of flexPool) used.set(position, (used.get(position) ?? 0) + 1);
  const levels = new Map<string, number>();
  for (const [position, list] of byPosition) {
    if (!used.has(position)) continue;
    levels.set(position, list[used.get(position) ?? 0] ?? 0);
  }
  return levels;
}

/**
 * What the room actually got at each pick: the mean VOR of picks within `window` picks either side.
 * A pick's value over draft cost is its own VOR minus this expectation.
 */
export function expectedValueBySlot(
  picks: readonly { readonly pickNo: number; readonly vor: number }[],
  window: number
): Map<number, number> {
  const expected = new Map<number, number>();
  for (const pick of picks) {
    const near = picks.filter((other) => Math.abs(other.pickNo - pick.pickNo) <= window);
    expected.set(pick.pickNo, round2(near.reduce((sum, other) => sum + other.vor, 0) / near.length));
  }
  return expected;
}

function averageRanks(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length).fill(0);
  let start = 0;
  while (start < order.length) {
    let end = start;
    while (end + 1 < order.length && order[end + 1]?.value === order[start]?.value) end += 1;
    const rank = (start + end) / 2 + 1;
    for (let k = start; k <= end; k += 1) ranks[order[k]?.index ?? 0] = rank;
    start = end + 1;
  }
  return ranks;
}

/** Pearson correlation of the average ranks (Spearman's rho). Null below three pairs or with no variance. */
export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const rx = averageRanks(xs);
  const ry = averageRanks(ys);
  const mean = (rx.length + 1) / 2;
  let numerator = 0;
  let sx = 0;
  let sy = 0;
  rx.forEach((value, index) => {
    const dx = value - mean;
    const dy = (ry[index] ?? 0) - mean;
    numerator += dx * dy;
    sx += dx * dx;
    sy += dy * dy;
  });
  if (sx === 0 || sy === 0) return null;
  return Math.round((numerator / Math.sqrt(sx * sy)) * 1000) / 1000;
}

/** Approximate 95% interval for a rank correlation (Fisher z, standard error 1/sqrt(n-3)). */
export function correlationInterval(rho: number, n: number): readonly [number, number] | null {
  if (n < 4) return null;
  const clamped = Math.max(-0.999, Math.min(0.999, rho));
  const z = Math.atanh(clamped);
  const se = 1 / Math.sqrt(n - 3);
  const back = (value: number) => Math.round(Math.tanh(value) * 100) / 100;
  return [back(z - 1.96 * se), back(z + 1.96 * se)];
}

/** Linear-interpolated quantile of finite values; null when empty. */
export function quantile(values: readonly number[], q: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  const lowValue = sorted[low] ?? 0;
  return lowValue + ((sorted[high] ?? lowValue) - lowValue) * (position - low);
}

export function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : round2(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** Mean absolute rank error between a pre-draft ordering and the realized ordering. */
export function meanAbsoluteRankError(predicted: readonly number[], actual: readonly number[]): number | null {
  if (predicted.length === 0 || predicted.length !== actual.length) return null;
  const p = averageRanks(predicted);
  const a = averageRanks(actual);
  return round2(p.reduce((sum, value, index) => sum + Math.abs(value - (a[index] ?? 0)), 0) / p.length);
}

/** Draft slot (1-based) that owns an overall pick in a snake draft. */
export function snakeSlot(pickNo: number, teams: number): number {
  const round = Math.ceil(pickNo / teams);
  const inRound = pickNo - (round - 1) * teams;
  return round % 2 === 1 ? inRound : teams + 1 - inRound;
}

/** The manager's next overall pick after `pickNo` in a snake draft, or null after the last round. */
export function nextSnakePick(pickNo: number, teams: number, rounds: number): number | null {
  const slot = snakeSlot(pickNo, teams);
  for (let candidate = pickNo + 1; candidate <= teams * rounds; candidate += 1) {
    if (snakeSlot(candidate, teams) === slot) return candidate;
  }
  return null;
}

/** Same survival curve the recommendation backtest uses for the Best Pick replay. */
export function conditionalSurvival(marketRank: number, currentPick: number, nextPick: number): number {
  const scale = marketRank <= 60 ? 7 : 11;
  const draftedByCurrent = 1 / (1 + Math.exp(-(currentPick - marketRank) / scale));
  const draftedByNext = 1 / (1 + Math.exp(-(nextPick - marketRank) / scale));
  return Math.max(0.03, Math.min(0.97, (1 - draftedByNext) / Math.max(0.05, 1 - draftedByCurrent)));
}

/** Pick number minus ADP: positive when a player went later than ADP (a value), negative for a reach. */
export function adpDelta(pickNo: number, adp: number | null): number | null {
  return adp === null ? null : round2(pickNo - adp);
}

export type StrategyTag = 'rb-heavy' | 'wr-heavy' | 'balanced' | 'zero-rb' | 'hero-rb' | 'early-qb' | 'early-te';

/**
 * Coarse build labels from the positions a team took in its first `earlyRounds` rounds (keepers included, since they
 * occupy those rounds). Early QB or TE means one taken in the first four rounds.
 */
export function classifyStrategy(positionsByRound: readonly string[], earlyRounds = 5): StrategyTag[] {
  const early = positionsByRound.slice(0, earlyRounds);
  const count = (position: string) => early.filter((value) => value === position).length;
  const tags: StrategyTag[] = [];
  const rb = count('RB');
  const wr = count('WR');
  if (rb === 0) tags.push('zero-rb');
  else if (rb === 1 && positionsByRound[0] === 'RB') tags.push('hero-rb');
  if (rb >= 3) tags.push('rb-heavy');
  else if (wr >= 3) tags.push('wr-heavy');
  else tags.push('balanced');
  const firstFour = positionsByRound.slice(0, 4);
  if (firstFour.includes('QB')) tags.push('early-qb');
  if (firstFour.includes('TE')) tags.push('early-te');
  return tags;
}

/** Letter grade from a team's rank (1 = best) among `teams`. */
export function letterGrade(rank: number, teams: number): string {
  const share = (rank - 1) / Math.max(1, teams - 1);
  if (share <= 0.12) return 'A';
  if (share <= 0.34) return 'B';
  if (share <= 0.67) return 'C';
  if (share <= 0.89) return 'D';
  return 'F';
}

/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((cells) => cells.length > 1 || cells[0] !== '');
}

/** Lowercase, strip punctuation and generational suffixes, so "Travis Etienne Jr." matches "Travis Etienne". */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.'’]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface SportsbookLine { readonly market: string; readonly line: number }
export interface StatProjection {
  readonly passingYards?: number | undefined;
  readonly passingTouchdowns?: number | undefined;
  readonly rushingYards?: number | undefined;
  readonly rushingTouchdowns?: number | undefined;
  readonly receptions?: number | undefined;
  readonly receivingYards?: number | undefined;
  readonly receivingTouchdowns?: number | undefined;
}

const MARKET_STAT_KEYS: Readonly<Record<string, { readonly projection: keyof StatProjection; readonly scoring: string }>> = {
  passingYards: { projection: 'passingYards', scoring: 'pass_yd' },
  passingTouchdowns: { projection: 'passingTouchdowns', scoring: 'pass_td' },
  rushingYards: { projection: 'rushingYards', scoring: 'rush_yd' },
  rushingTouchdowns: { projection: 'rushingTouchdowns', scoring: 'rush_td' },
  receptions: { projection: 'receptions', scoring: 'rec' },
  receivingYards: { projection: 'receivingYards', scoring: 'rec_yd' },
  receivingTouchdowns: { projection: 'receivingTouchdowns', scoring: 'rec_td' },
};

/**
 * Relative gap between sportsbook season lines and the FantasyPros projection, in league points, over only the stat
 * markets the books priced for that player (several books' lines for one market are averaged). Positive means the
 * books are more optimistic. Null when no priced market has a projection.
 */
export function sportsbookProjectionGap(
  lines: readonly SportsbookLine[],
  projection: StatProjection,
  scoring: StatLine
): { readonly gap: number; readonly markets: number } | null {
  const byMarket = new Map<string, number[]>();
  for (const { market, line } of lines) {
    if (!MARKET_STAT_KEYS[market]) continue;
    byMarket.set(market, [...(byMarket.get(market) ?? []), line]);
  }
  let books = 0;
  let projected = 0;
  for (const [market, values] of byMarket) {
    const keys = MARKET_STAT_KEYS[market];
    if (!keys) continue;
    const projectedValue = projection[keys.projection];
    const weight = scoring[keys.scoring] ?? 0;
    if (projectedValue === undefined || weight === 0) continue;
    books += (values.reduce((sum, value) => sum + value, 0) / values.length) * weight;
    projected += projectedValue * weight;
  }
  if (projected <= 0) return null;
  return { gap: Math.round(((books - projected) / projected) * 1000) / 1000, markets: byMarket.size };
}

/** A FantasyPros snapshot projection row: base PPR points plus the stat components league scoring re-weights. */
export interface SnapshotProjection {
  readonly projectedPoints: number;
  readonly baseProjectedPoints?: number | null | undefined;
  readonly projectedRushAttempts?: number | null | undefined;
  readonly projectedReceptions?: number | null | undefined;
  readonly projectedPassingYards?: number | null | undefined;
  readonly projectedPassingTouchdowns?: number | null | undefined;
  readonly projectedRushingYards?: number | null | undefined;
  readonly projectedRushingTouchdowns?: number | null | undefined;
  readonly projectedReceivingYards?: number | null | undefined;
  readonly projectedReceivingTouchdowns?: number | null | undefined;
}

/**
 * League-scored projection through the shared calculator the live board uses: the snapshot's base PPR points,
 * re-weighted per stat component for this league's rules (reception rate, yardage, TDs) plus its bonuses.
 */
export function leagueProjection(projection: SnapshotProjection, position: string, rules: ScoringRules): number | null {
  if (!isPosition(position)) return null;
  return calculateLeagueProjection({
    projectedPoints: projection.projectedPoints,
    baseProjectedPoints: projection.baseProjectedPoints ?? undefined,
    projectedRushAttempts: projection.projectedRushAttempts ?? undefined,
    projectedReceptions: projection.projectedReceptions ?? undefined,
    projectedPassingYards: projection.projectedPassingYards ?? undefined,
    projectedPassingTouchdowns: projection.projectedPassingTouchdowns ?? undefined,
    projectedRushingYards: projection.projectedRushingYards ?? undefined,
    projectedRushingTouchdowns: projection.projectedRushingTouchdowns ?? undefined,
    projectedReceivingYards: projection.projectedReceivingYards ?? undefined,
    projectedReceivingTouchdowns: projection.projectedReceivingTouchdowns ?? undefined,
  }, position, rules).projectedPoints;
}

export type RiskCategory =
  | 'rookie'
  | 'prior-missed-games'
  | 'age-cliff'
  | 'team-change'
  | 'qb-change'
  | 'contract-year'
  | 'expert-disagreement'
  | 'sportsbook-disagreement'
  | 'reach-vs-adp';

export const RISK_CATEGORIES: readonly RiskCategory[] = [
  'rookie', 'prior-missed-games', 'age-cliff', 'team-change', 'qb-change', 'contract-year',
  'expert-disagreement', 'sportsbook-disagreement', 'reach-vs-adp',
];

/** Ages at which the position's historical decline is usually priced in. */
export const AGE_CLIFF: Readonly<Record<OffensivePosition, number>> = { QB: 36, RB: 28, WR: 30, TE: 31 };
export const PRIOR_SEASON_GAMES_THRESHOLD = 12;
export const REACH_THRESHOLD_PICKS = 12;
export const SPORTSBOOK_GAP_THRESHOLD = 0.15;

export interface RiskInput {
  readonly position: string;
  readonly yearsExp: number | null;
  readonly age: number | null;
  readonly priorSeasonGames: number | null;
  readonly priorTeam: string | null;
  readonly draftTeam: string | null;
  readonly teamQbChanged: boolean | null;
  readonly contractYear: boolean;
  readonly expertSpread: number | null;
  readonly expertSpreadThreshold: number | null;
  readonly sportsbookGap: number | null;
  readonly adpDelta: number | null;
  readonly isKeeper: boolean;
}

export function classifyRisks(input: RiskInput): RiskCategory[] {
  const risks: RiskCategory[] = [];
  const offensive = OFFENSIVE_POSITIONS.find((position) => position === input.position);
  if (input.yearsExp === 0) risks.push('rookie');
  if (input.yearsExp !== 0 && input.priorSeasonGames !== null && input.priorSeasonGames < PRIOR_SEASON_GAMES_THRESHOLD) {
    risks.push('prior-missed-games');
  }
  if (offensive && input.age !== null && input.age >= AGE_CLIFF[offensive]) risks.push('age-cliff');
  if (input.yearsExp !== 0 && input.priorTeam && input.draftTeam && input.priorTeam !== input.draftTeam) risks.push('team-change');
  if (input.teamQbChanged === true && input.position !== 'QB') risks.push('qb-change');
  if (input.contractYear) risks.push('contract-year');
  if (input.expertSpread !== null && input.expertSpreadThreshold !== null && input.expertSpread >= input.expertSpreadThreshold) {
    risks.push('expert-disagreement');
  }
  if (input.sportsbookGap !== null && Math.abs(input.sportsbookGap) >= SPORTSBOOK_GAP_THRESHOLD) risks.push('sportsbook-disagreement');
  if (!input.isKeeper && input.adpDelta !== null && input.adpDelta <= -REACH_THRESHOLD_PICKS) risks.push('reach-vs-adp');
  return risks;
}

export type AcquisitionSource = 'draft' | 'waiver' | 'free_agent' | 'trade' | 'other';

export interface RosterAdd {
  readonly week: number;
  readonly created: number;
  readonly rosterId: number;
  readonly playerId: string;
  readonly type: 'waiver' | 'free_agent' | 'trade' | 'commissioner';
  readonly transactionId: string;
  readonly faabBid: number | null;
}

/** The add that put a player on a roster for a given week: the latest one on or before that week. */
export function latestAdd(
  rosterId: number,
  playerId: string,
  week: number,
  addsByRosterPlayer: ReadonlyMap<string, readonly RosterAdd[]>
): RosterAdd | undefined {
  return (addsByRosterPlayer.get(`${String(rosterId)}:${playerId}`) ?? [])
    .filter((add) => add.week <= week)
    .sort((a, b) => b.week - a.week || b.created - a.created)[0];
}

/**
 * How a roster came to hold a player in a given week: the latest add on or before that week, else the draft if this
 * roster drafted the player.
 */
export function acquisitionSource(
  rosterId: number,
  playerId: string,
  week: number,
  addsByRosterPlayer: ReadonlyMap<string, readonly RosterAdd[]>,
  draftedBy: ReadonlyMap<string, number>
): AcquisitionSource {
  const latest = latestAdd(rosterId, playerId, week, addsByRosterPlayer);
  if (latest) return latest.type === 'commissioner' ? 'other' : latest.type;
  return draftedBy.get(playerId) === rosterId ? 'draft' : 'other';
}

export interface PickupStint {
  readonly transactionId: string;
  readonly rosterId: number;
  readonly playerId: string;
  readonly firstWeek: number;
  readonly source: 'waiver' | 'free_agent';
  readonly faabBid: number | null;
  readonly rostered: number;
  readonly started: number;
}

/**
 * Waiver and free-agent pickups, one row per acquiring transaction through `throughWeek`: a player dropped and re-added
 * by the same roster is two stints, each with its own source, FAAB bid and points. A pickup dropped before it appears in
 * any matchup is a zero-point stint; its first week is the add's week, otherwise the first matchup week on the roster.
 */
export function pickupStints(
  matchups: readonly { readonly week: number; readonly rows: readonly {
    readonly roster_id: number;
    readonly starters?: readonly string[] | null | undefined;
    readonly players?: readonly string[] | null | undefined;
    readonly players_points?: Readonly<Record<string, number>> | null | undefined;
  }[] }[],
  addsByRosterPlayer: ReadonlyMap<string, readonly RosterAdd[]>,
  throughWeek: number
): PickupStint[] {
  const stints = new Map<string, PickupStint>();
  const seen = new Set<string>();
  const pickups = [...addsByRosterPlayer.values()].flat()
    .filter((add): add is RosterAdd & { readonly type: 'waiver' | 'free_agent' } => (add.type === 'waiver' || add.type === 'free_agent') && add.week <= throughWeek)
    .sort((a, b) => a.week - b.week || a.created - b.created);
  for (const add of pickups) {
    stints.set(`${add.transactionId}:${add.playerId}`, {
      transactionId: add.transactionId, rosterId: add.rosterId, playerId: add.playerId, firstWeek: add.week, source: add.type,
      faabBid: add.type === 'waiver' ? add.faabBid : null, rostered: 0, started: 0,
    });
  }
  for (const { week, rows } of [...matchups].sort((a, b) => a.week - b.week)) {
    if (week > throughWeek) continue;
    for (const row of rows) {
      const starters = row.starters ?? [];
      for (const playerId of row.players ?? []) {
        const add = latestAdd(row.roster_id, playerId, week, addsByRosterPlayer);
        if (!add || (add.type !== 'waiver' && add.type !== 'free_agent')) continue;
        const points = row.players_points?.[playerId] ?? 0;
        const key = `${add.transactionId}:${playerId}`;
        const entry = stints.get(key);
        if (!entry) continue;
        const firstWeek = seen.has(key) ? entry.firstWeek : week;
        seen.add(key);
        stints.set(key, {
          ...entry,
          firstWeek,
          rostered: round2(entry.rostered + points),
          started: starters.includes(playerId) ? round2(entry.started + points) : entry.started,
        });
      }
    }
  }
  return [...stints.values()];
}
