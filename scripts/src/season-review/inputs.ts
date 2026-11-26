/** Decoders and plain types for every season-review input. Unknown JSON is decoded here, at the I/O boundary. */
import { Schema } from 'effect';

const num = Schema.Finite;
const optNum = Schema.optional(Schema.NullOr(Schema.Finite));
const optStr = Schema.optional(Schema.NullOr(Schema.String));

export const decodeSleeperState = Schema.decodeUnknownSync(Schema.Struct({
  week: num, season: Schema.String, season_type: Schema.String,
}));

export const decodeSleeperLeague = Schema.decodeUnknownSync(Schema.Struct({
  league_id: Schema.String,
  season: Schema.String,
  total_rosters: num,
  roster_positions: Schema.Array(Schema.String),
  scoring_settings: Schema.Record(Schema.String, num),
  settings: Schema.Record(Schema.String, Schema.Unknown),
}));

export const decodeSleeperUsers = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({
  user_id: Schema.String,
  display_name: optStr,
  metadata: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
})));

export const decodeSleeperRosters = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({
  roster_id: num,
  owner_id: optStr,
  co_owners: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  settings: Schema.Record(Schema.String, Schema.Unknown),
})));

export const decodeSleeperDraft = Schema.decodeUnknownSync(Schema.Struct({
  draft_id: Schema.String,
  status: Schema.String,
  type: Schema.String,
  start_time: optNum,
  settings: Schema.Record(Schema.String, Schema.Unknown),
  draft_order: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, num))),
  slot_to_roster_id: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, num))),
}));

const sleeperPick = Schema.Struct({
  pick_no: num,
  round: num,
  draft_slot: num,
  roster_id: Schema.optional(Schema.NullOr(Schema.Union([num, Schema.String]))),
  picked_by: optStr,
  player_id: Schema.String,
  is_keeper: Schema.optional(Schema.NullOr(Schema.Boolean)),
  metadata: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
});
export const decodeSleeperPicks = Schema.decodeUnknownSync(Schema.Array(sleeperPick));

export const decodeSleeperMatchups = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({
  roster_id: num,
  matchup_id: optNum,
  points: optNum,
  starters: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  starters_points: Schema.optional(Schema.NullOr(Schema.Array(num))),
  players: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  players_points: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, num))),
})));

export const decodeSleeperTransactions = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({
  transaction_id: Schema.String,
  type: Schema.String,
  status: Schema.String,
  created: optNum,
  leg: optNum,
  roster_ids: Schema.optional(Schema.NullOr(Schema.Array(num))),
  adds: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, num))),
  drops: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, num))),
  settings: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
})));

export const decodeSleeperStats = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)));

export const decodeSleeperPlayers = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Struct({
  full_name: optStr,
  first_name: optStr,
  last_name: optStr,
  position: optStr,
  team: optStr,
  age: optNum,
  years_exp: optNum,
  gsis_id: optStr,
})));

const fpRanking = Schema.Struct({
  fantasyProsId: Schema.String, rank: num, name: Schema.String, position: Schema.String, team: optStr,
  positionalRank: optNum, bestRank: optNum, worstRank: optNum, avgRank: optNum,
});
const fpAdp = Schema.Struct({
  fantasyProsId: Schema.String, rank: num, name: Schema.String, position: Schema.String, team: optStr,
  averageRank: optNum,
});
const fpProjection = Schema.Struct({
  fantasyProsId: Schema.String, name: Schema.String, position: Schema.String, team: optStr,
  projectedPoints: num, baseProjectedPoints: optNum,
  projectedRushAttempts: optNum, projectedPassingYards: optNum, projectedPassingTouchdowns: optNum,
  projectedRushingYards: optNum, projectedRushingTouchdowns: optNum, projectedReceptions: optNum,
  projectedReceivingYards: optNum, projectedReceivingTouchdowns: optNum,
});
export const decodeFantasyProsSnapshot = Schema.decodeUnknownSync(Schema.Struct({
  metadata: Schema.Struct({ season: num, refreshedAt: Schema.String }),
  rankings: Schema.Array(fpRanking),
  adp: Schema.Array(fpAdp),
  projections: Schema.Array(fpProjection),
}));
export type FantasyProsSnapshot = ReturnType<typeof decodeFantasyProsSnapshot>;

export const decodePlayerIdentity = Schema.decodeUnknownSync(Schema.Struct({
  players: Schema.Array(Schema.Struct({ sleeperId: optStr, fantasyProsId: optStr, name: Schema.String, position: optStr })),
}));

export const decodeSleeperAdpFile = Schema.decodeUnknownSync(Schema.Struct({
  fetchedAt: Schema.String,
  players: Schema.Array(Schema.Struct({
    playerId: Schema.String, name: Schema.String, position: Schema.String, team: optStr,
    sleeperAdp: num, age: optNum, yearsExp: optNum,
  })),
}));

export const decodeContracts = Schema.decodeUnknownSync(Schema.Struct({
  contractYear: num,
  players: Schema.Array(Schema.Struct({ playerId: Schema.String, isContractYear: Schema.Boolean })),
}));

export const decodeSportsbook = Schema.decodeUnknownSync(Schema.Struct({
  metadata: Schema.Struct({ season: num, capturedAt: Schema.String }),
  overUnder: Schema.Array(Schema.Struct({ playerName: Schema.String, market: Schema.String, line: num, sportsbook: Schema.String })),
}));

export const decodePredictions = Schema.decodeUnknownSync(Schema.Struct({
  generatedAt: Schema.String,
  modelVersion: Schema.optional(Schema.String),
  players: Schema.Array(Schema.Struct({ playerId: Schema.String, position: Schema.String, projectedPoints: num })),
}));

export const decodePrimaryLeagueSettings = Schema.decodeUnknownSync(Schema.Struct({
  season: num, leagueId: Schema.String, draftId: Schema.String,
}));

export const decodeCurrentKeepers = Schema.decodeUnknownSync(Schema.Struct({
  season: num,
  keepers: Schema.Array(Schema.Struct({
    playerName: Schema.String, position: Schema.String, team: num, round: num,
    isMyKeeper: Schema.optional(Schema.Boolean),
  })),
}));

export const decodeRehearsalReport = Schema.decodeUnknownSync(Schema.Struct({
  draftId: Schema.String, managerDraftSlot: optNum,
}));

export const decodeHistoryEcrRows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({
  season: num, sleeper_player_id: Schema.String, predraft_ecr: num,
})));

export type SleeperLeague = ReturnType<typeof decodeSleeperLeague>;
export type SleeperUsers = ReturnType<typeof decodeSleeperUsers>;
export type SleeperRosters = ReturnType<typeof decodeSleeperRosters>;
export type SleeperDraft = ReturnType<typeof decodeSleeperDraft>;
export type SleeperPicks = ReturnType<typeof decodeSleeperPicks>;
export type SleeperMatchups = ReturnType<typeof decodeSleeperMatchups>;
export type SleeperTransactions = ReturnType<typeof decodeSleeperTransactions>;
export type SleeperPlayers = ReturnType<typeof decodeSleeperPlayers>;
export type SleeperAdpFile = ReturnType<typeof decodeSleeperAdpFile>;
export type Contracts = ReturnType<typeof decodeContracts>;
export type Sportsbook = ReturnType<typeof decodeSportsbook>;
export type Predictions = ReturnType<typeof decodePredictions>;
export type PlayerIdentity = ReturnType<typeof decodePlayerIdentity>;

/** Prior-season nflverse player totals needed for availability, team and starting-QB context. */
export interface PriorSeasonRow {
  readonly gsisId: string;
  readonly name: string;
  readonly position: string;
  readonly team: string;
  readonly games: number;
  readonly passAttempts: number;
}

export interface HistorySeason {
  readonly season: number;
  readonly teams: number;
  readonly picks: SleeperPicks;
  readonly users: SleeperUsers;
}

/** Everything the analysis reads, already decoded. */
export interface SeasonReviewInputs {
  readonly season: number;
  readonly throughWeek: number;
  /** Week the live standings reflect; `throughWeek` (player stats) may run past it, never before. */
  readonly standingsThroughWeek: number;
  readonly managerSlot: number;
  readonly managerSlotEvidence: readonly string[];
  readonly league: SleeperLeague;
  readonly users: SleeperUsers;
  readonly rosters: SleeperRosters;
  readonly draft: SleeperDraft;
  readonly picks: SleeperPicks;
  readonly weeklyStats: readonly { readonly week: number; readonly stats: Readonly<Record<string, Readonly<Record<string, number>>>> }[];
  readonly matchups: readonly { readonly week: number; readonly rows: SleeperMatchups }[];
  readonly transactions: readonly { readonly week: number; readonly rows: SleeperTransactions }[];
  readonly players: SleeperPlayers;
  readonly priorSeasonSleeperGames: ReadonlyMap<string, number>;
  readonly priorSeasonRows: readonly PriorSeasonRow[];
  readonly predraftFantasyPros: FantasyProsSnapshot;
  readonly currentFantasyPros: FantasyProsSnapshot | null;
  readonly identity: PlayerIdentity | null;
  readonly predraftSleeper: SleeperAdpFile | null;
  readonly contracts: Contracts | null;
  readonly sportsbook: Sportsbook | null;
  /** Optional inputs left out because they are for another season, each as a reader-facing sentence. */
  readonly omittedInputs: readonly string[];
  readonly predraftPredictions: Predictions | null;
  readonly history: readonly HistorySeason[];
  readonly historyEcr: ReadonlyMap<string, number>;
}
