import { Schema } from 'effect';
import { NFL_TEAMS, POSITIONS, NEWS_STATUSES, PREDICTION_SOURCES } from '../player.js';

function openStruct<const Fields extends Schema.Struct.Fields>(fields: Fields) {
  return Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)]);
}

const position = Schema.Literals(POSITIONS);
const team = Schema.Literals(NFL_TEAMS);
const optionalString = Schema.optional(Schema.String);
const optionalNumber = Schema.optional(Schema.Finite);
const namedPlayer = { name: Schema.String, position, team };
const nonEmptyString = Schema.String.check(Schema.makeFilter((value) => value.trim().length > 0));
const playerIdentity = openStruct({
  canonicalId: nonEmptyString,
  sleeperId: Schema.optional(nonEmptyString),
  fantasyProsId: Schema.optional(nonEmptyString),
  name: nonEmptyString,
  aliases: Schema.Array(nonEmptyString), position, team,
});
const playerIdentityFile = openStruct({
  generatedAt: Schema.String, season: Schema.Finite,
  coverage: openStruct({ fantasyProsRankingMatchRate: Schema.Finite, matchedDefenses: Schema.Finite }),
  players: Schema.Array(playerIdentity),
});
const sleeperPlayer = openStruct({
  ...namedPlayer, playerId: Schema.String, sleeperAdp: Schema.Finite,
  age: Schema.optional(Schema.NullOr(Schema.Finite)),
  yearsExp: Schema.optional(Schema.NullOr(Schema.Finite)),
  status: optionalString,
});
const sleeperDataFile = openStruct({
  fetchedAt: Schema.String, source: Schema.String, playerCount: Schema.Finite,
  players: Schema.Array(sleeperPlayer),
}).check(Schema.makeFilter((value) => value.playerCount === value.players.length));
const ecrPlayer = openStruct({
  ...namedPlayer, fantasyProsId: optionalString, fantasyProsTier: optionalNumber,
  rank: Schema.Finite, byeWeek: Schema.Finite, positionalRank: Schema.Finite,
  bestRank: Schema.Finite, worstRank: Schema.Finite, avgRank: Schema.Finite,
});
const fantasyProsProjection = openStruct({
  ...namedPlayer, fantasyProsId: optionalString, projectedPoints: Schema.Finite,
  /** FantasyPros PPR points before league scoring bonuses. */
  baseProjectedPoints: optionalNumber,
  /** Rushing attempts used for the league's points-per-attempt bonus. */
  projectedRushAttempts: optionalNumber,
  /** Receptions used for the league's TE reception premium. */
  projectedReceptions: optionalNumber, projectedPassingYards: optionalNumber,
  projectedPassingTouchdowns: optionalNumber, projectedRushingYards: optionalNumber,
  projectedRushingTouchdowns: optionalNumber, projectedReceivingYards: optionalNumber,
  projectedReceivingTouchdowns: optionalNumber,
  /** @deprecated Consumers calculate scoring adjustments locally. */
  customScoringAdjustment: optionalNumber,
  /** @deprecated Consumers rescore projectedPoints locally. */
  leagueProjectedPoints: optionalNumber, ceilingPoints: optionalNumber, floorPoints: optionalNumber,
}).check(Schema.makeFilter((row) => Object.entries(row).every(([key, value]) =>
  !key.startsWith('projected') || value === undefined || Number.isFinite(value)
)));
const fantasyProsNewsItem = openStruct({
  ...namedPlayer, fantasyProsId: optionalString, status: Schema.Literals(NEWS_STATUSES),
  headline: Schema.String, categories: Schema.optional(Schema.Array(Schema.String)),
  description: optionalString, impact: optionalString, link: optionalString, updatedAt: optionalString,
});
const fantasyProsAdpPlayer = openStruct({
  ...namedPlayer, fantasyProsId: optionalString, rank: Schema.Finite,
  positionalRank: Schema.Finite, bestRank: Schema.Finite, worstRank: Schema.Finite, averageRank: Schema.Finite,
});
const fantasyProsSnapshotMetadata = openStruct({
  season: Schema.Finite, sourceType: Schema.Literals(['manual-refresh', 'fixture', 'api']),
  source: Schema.String, refreshedAt: Schema.String, projectionRefreshedAt: optionalString,
  projectionSource: Schema.optional(Schema.Literals(['api', 'preserved-cache'])),
  rankingCount: Schema.Finite, adpCount: Schema.Finite, projectionCount: Schema.Finite, newsCount: Schema.Finite,
});
const fantasyProsSnapshot = openStruct({
  metadata: fantasyProsSnapshotMetadata,
  rankings: Schema.Array(ecrPlayer), adp: Schema.Array(fantasyProsAdpPlayer),
  projections: Schema.Array(fantasyProsProjection), news: Schema.Array(fantasyProsNewsItem),
});

type DataShape<A> = A extends readonly unknown[]
  ? { [K in keyof A]: DataShape<A[K]> }
  : A extends object
    ? { [K in keyof A as string extends K ? never : K]: DataShape<A[K]> }
    : A;

export type PlayerIdentityData = DataShape<typeof playerIdentity.Type>;
export type SleeperADPPlayer = DataShape<typeof sleeperPlayer.Type>;
export type PlayerIdentityFile = DataShape<typeof playerIdentityFile.Type>;
export type SleeperDataFile = DataShape<typeof sleeperDataFile.Type>;
export type ECRPlayer = DataShape<typeof ecrPlayer.Type>;
export type FantasyProsProjection = DataShape<typeof fantasyProsProjection.Type>;
export type FantasyProsNewsItem = DataShape<typeof fantasyProsNewsItem.Type>;
export type FantasyProsAdpPlayer = DataShape<typeof fantasyProsAdpPlayer.Type>;
export type FantasyProsSnapshot = DataShape<typeof fantasyProsSnapshot.Type>;

export const decodePlayerIdentityFile = Schema.decodeUnknownSync(playerIdentityFile);
export const decodeSleeperDataFile = Schema.decodeUnknownSync(sleeperDataFile);
export const decodeFantasyProsSnapshot = Schema.decodeUnknownSync(fantasyProsSnapshot);

const positiveInteger = Schema.Number.check(Schema.makeFilter(value => Number.isInteger(value) && value >= 1));
const keeperFile = openStruct({
  updatedAt: Schema.NullOr(Schema.String), season: Schema.Finite,
  keepers: Schema.Array(openStruct({
    playerId: optionalString, playerName: Schema.String, position,
    team: positiveInteger,
    round: positiveInteger,
    isMyKeeper: Schema.optional(Schema.Boolean),
  })),
});
const primaryLeagueSettingsFile = /* @__PURE__ */ openStruct({
  season: Schema.Finite, leagueName: Schema.String,
  source: /* @__PURE__ */ Schema.Literals(['sleeper', 'manual-confirmation']),
  confirmedAt: Schema.String,
  totalTeams: Schema.Finite, totalRounds: Schema.Finite,
  scoring: /* @__PURE__ */ openStruct({ passingTouchdown: Schema.Finite, reception: Schema.Finite,
    tightEndReceptionPremium: Schema.Finite, rushAttemptBonus: Schema.Finite }),
  roster: /* @__PURE__ */ openStruct({ QB: Schema.Finite, RB: Schema.Finite, WR: Schema.Finite,
    TE: Schema.Finite, FLEX: Schema.Finite, K: Schema.Finite, DEF: Schema.Finite, BENCH: Schema.Finite }),
});
const prediction = openStruct({
  ...namedPlayer, playerId: optionalString,
  source: Schema.Literals(PREDICTION_SOURCES),
  modelFamily: optionalString, modelVersion: optionalString,
  projectedPoints: Schema.Finite,
  baseProjectedPoints: optionalNumber, usageEfficiencyAdjustment: optionalNumber,
  customScoringAdjustment: optionalNumber, customProjectedPoints: optionalNumber,
  floorProjectedPoints: optionalNumber, ceilingProjectedPoints: optionalNumber,
  positionPercentile: optionalNumber, valueOverReplacement: optionalNumber,
  ceilingScore: optionalNumber, floorScore: optionalNumber, uncertaintyScore: optionalNumber,
  riskScore: optionalNumber, injuryRiskScore: optionalNumber,
});
const predictionsEnvelope = openStruct({
  generatedAt: Schema.NullOr(Schema.String),
  modelVersion: Schema.String.check(Schema.makeFilter(value => value.length > 0)),
  players: Schema.Array(Schema.Unknown),
});
const decodePredictionsEnvelope = Schema.decodeUnknownSync(predictionsEnvelope);
const decodePrediction = Schema.decodeUnknownSync(prediction);

export type KeeperFile = DataShape<typeof keeperFile.Type>;
export type PredictionsDataFile = Omit<DataShape<typeof predictionsEnvelope.Type>, 'players'> & { readonly players: DataShape<typeof prediction.Type>[] };
export const decodeKeeperFile = Schema.decodeUnknownSync(keeperFile);
export const decodePrimaryLeagueSettingsFile = /* @__PURE__ */ Schema.decodeUnknownSync(primaryLeagueSettingsFile);

export interface DecodeOptions {
  readonly onWarning?: (message: string) => void;
}

export function decodePredictionsDataFile(value: unknown, options: DecodeOptions = {}): PredictionsDataFile {
  const envelope = decodePredictionsEnvelope(value);
  const players: (typeof prediction.Type)[] = [];
  let droppedRows = 0;
  for (const row of envelope.players) {
    try { players.push(decodePrediction(row)); }
    catch { droppedRows++; }
  }
  if (droppedRows) options.onWarning?.(`Dropped ${droppedRows} invalid prediction rows.`);
  return { ...envelope, players };
}

export function decodeOrNull<A>(decode: (value: unknown) => A, value: unknown): A | null {
  try { return decode(value); } catch { return null; }
}
