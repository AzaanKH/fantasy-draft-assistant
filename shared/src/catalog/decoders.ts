import type { DataShape } from './data-shape.js';
import { Schema } from 'effect';
import { LIVE_RECOMMENDATION_ARCHITECTURE } from '../recommendation-policy.js';
import { isPosition, NFL_TEAMS, POSITIONS, NEWS_STATUSES, PREDICTION_SOURCES } from '../player.js';

function openStruct<const Fields extends Schema.Struct.Fields>(fields: Fields) {
  return /* @__PURE__ */ Schema.StructWithRest(/* @__PURE__ */ Schema.Struct(fields), [/* @__PURE__ */ Schema.Record(Schema.String, Schema.Unknown)]);
}

const position = /* @__PURE__ */ Schema.Literals(POSITIONS);
const team = /* @__PURE__ */ Schema.Literals(NFL_TEAMS);
const optionalString = /* @__PURE__ */ Schema.optional(Schema.String);
const optionalNumber = /* @__PURE__ */ Schema.optional(Schema.Finite);
const namedPlayer = { name: Schema.String, position, team };
const nonEmptyString = /* @__PURE__ */ Schema.String.check(/* @__PURE__ */ Schema.makeFilter((value) => value.trim().length > 0));
const playerIdentity = /* @__PURE__ */ openStruct({
  canonicalId: nonEmptyString,
  sleeperId: /* @__PURE__ */ Schema.optional(nonEmptyString),
  fantasyProsId: /* @__PURE__ */ Schema.optional(nonEmptyString),
  name: nonEmptyString,
  aliases: /* @__PURE__ */ Schema.Array(nonEmptyString), position, team,
});
const playerIdentityFile = /* @__PURE__ */ openStruct({
  generatedAt: Schema.String, season: Schema.Finite,
  coverage: /* @__PURE__ */ openStruct({ fantasyProsRankingMatchRate: Schema.Finite, matchedDefenses: Schema.Finite }),
  players: /* @__PURE__ */ Schema.Array(playerIdentity),
});
const sleeperPlayer = /* @__PURE__ */ openStruct({
  ...namedPlayer, playerId: Schema.String, sleeperAdp: Schema.Finite,
  age: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ Schema.NullOr(Schema.Finite)),
  yearsExp: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ Schema.NullOr(Schema.Finite)),
  status: optionalString,
});
const ecrPlayer = /* @__PURE__ */ openStruct({
  ...namedPlayer, fantasyProsId: optionalString, fantasyProsTier: optionalNumber,
  rank: Schema.Finite, byeWeek: Schema.Finite, positionalRank: Schema.Finite,
  bestRank: Schema.Finite, worstRank: Schema.Finite, avgRank: Schema.Finite,
});
const fantasyProsProjection = /* @__PURE__ */ openStruct({
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
  ceilingPoints: optionalNumber, floorPoints: optionalNumber,
}).check(/* @__PURE__ */ Schema.makeFilter((row) => Object.entries(row).every(([key, value]) =>
  !key.startsWith('projected') || value === undefined || Number.isFinite(value)
)));
const fantasyProsNewsItem = /* @__PURE__ */ openStruct({
  ...namedPlayer, fantasyProsId: optionalString, status: /* @__PURE__ */ Schema.Literals(NEWS_STATUSES),
  headline: Schema.String, categories: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ Schema.Array(Schema.String)),
  description: optionalString, impact: optionalString, link: optionalString, updatedAt: optionalString,
});
const fantasyProsAdpPlayer = /* @__PURE__ */ openStruct({
  ...namedPlayer, fantasyProsId: optionalString, rank: Schema.Finite,
  positionalRank: Schema.Finite, bestRank: Schema.Finite, worstRank: Schema.Finite, averageRank: Schema.Finite,
});
const fantasyProsSnapshotMetadata = /* @__PURE__ */ openStruct({
  season: Schema.Finite, sourceType: /* @__PURE__ */ Schema.Literals(['manual-refresh', 'fixture', 'api']),
  source: Schema.String, refreshedAt: Schema.String, projectionRefreshedAt: optionalString,
  projectionSource: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ Schema.Literals(['api', 'preserved-cache'])),
  rankingCount: Schema.Finite, adpCount: Schema.Finite, projectionCount: Schema.Finite, newsCount: Schema.Finite,
});
const fantasyProsSnapshot = /* @__PURE__ */ openStruct({
  metadata: fantasyProsSnapshotMetadata,
  rankings: /* @__PURE__ */ Schema.Array(ecrPlayer), adp: /* @__PURE__ */ Schema.Array(fantasyProsAdpPlayer),
  projections: /* @__PURE__ */ Schema.Array(fantasyProsProjection), news: /* @__PURE__ */ Schema.Array(fantasyProsNewsItem),
});

export type PlayerIdentityData = DataShape<typeof playerIdentity.Type>;
export type SleeperADPPlayer = DataShape<typeof sleeperPlayer.Type>;
export type PlayerIdentityFile = DataShape<typeof playerIdentityFile.Type>;
export type SleeperDataFile = Omit<DataShape<ReturnType<typeof decodeSleeperEnvelope>>, 'players'> & { readonly players: readonly SleeperADPPlayer[] };
export type ECRPlayer = DataShape<typeof ecrPlayer.Type>;
export type FantasyProsProjection = DataShape<typeof fantasyProsProjection.Type>;
export type FantasyProsNewsItem = DataShape<typeof fantasyProsNewsItem.Type>;
export type FantasyProsAdpPlayer = DataShape<typeof fantasyProsAdpPlayer.Type>;
export type FantasyProsSnapshot = DataShape<typeof fantasyProsSnapshot.Type>;

export const decodePlayerIdentityFile = /* @__PURE__ */ Schema.decodeUnknownSync(playerIdentityFile);
const decodeSleeperEnvelope = /* @__PURE__ */ Schema.decodeUnknownSync(/* @__PURE__ */ openStruct({
  fetchedAt: Schema.String, source: Schema.String, playerCount: Schema.Finite, players: /* @__PURE__ */ Schema.Array(Schema.Unknown),
}).check(/* @__PURE__ */ Schema.makeFilter(value => value.playerCount === value.players.length)));
const decodeSleeperPlayer = /* @__PURE__ */ Schema.decodeUnknownSync(sleeperPlayer);
export function decodeSleeperDataFile(value: unknown, options: DecodeOptions = {}): SleeperDataFile {
  const envelope = decodeSleeperEnvelope(value);
  const players = decodeRows(envelope.players, decodeSleeperPlayer, 'Sleeper', options);
  return { ...envelope, players, playerCount: players.length };
}
export const decodeFantasyProsSnapshot = /* @__PURE__ */ Schema.decodeUnknownSync(fantasyProsSnapshot);

const positiveInteger = /* @__PURE__ */ Schema.Number.check(/* @__PURE__ */ Schema.makeFilter(value => Number.isInteger(value) && value >= 1));
const keeperFile = /* @__PURE__ */ openStruct({
  updatedAt: /* @__PURE__ */ Schema.NullOr(Schema.String), season: Schema.Finite,
  keepers: /* @__PURE__ */ Schema.Array(/* @__PURE__ */ openStruct({
    playerId: optionalString, playerName: Schema.String, position,
    team: positiveInteger,
    round: positiveInteger,
    isMyKeeper: /* @__PURE__ */ Schema.optional(Schema.Boolean),
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
const prediction = /* @__PURE__ */ openStruct({
  ...namedPlayer, playerId: optionalString,
  source: /* @__PURE__ */ Schema.Literals(PREDICTION_SOURCES),
  /** Position model that produced the common prediction outputs. */
  modelFamily: optionalString, modelVersion: optionalString,
  projectedPoints: Schema.Finite,
  /** Base PPR projection before league-specific bonuses. */
  baseProjectedPoints: optionalNumber,
  /** Leakage-safe position-specific opportunity and efficiency residual. */
  usageEfficiencyAdjustment: optionalNumber,
  /** Rush-attempt and TE-premium points added for this league. */
  customScoringAdjustment: optionalNumber,
  /** Projection after league-specific bonuses. */
  customProjectedPoints: optionalNumber,
  /** Low outcome from the model's league-scored point distribution. */
  floorProjectedPoints: optionalNumber,
  /** High outcome from the model's league-scored point distribution. */
  ceilingProjectedPoints: optionalNumber,
  /** Percentile of projected points within the player's position (0-100). */
  positionPercentile: optionalNumber, valueOverReplacement: optionalNumber,
  ceilingScore: optionalNumber, floorScore: optionalNumber, uncertaintyScore: optionalNumber,
  riskScore: optionalNumber, injuryRiskScore: optionalNumber,
});
const predictionsEnvelope = /* @__PURE__ */ openStruct({
  generatedAt: /* @__PURE__ */ Schema.NullOr(Schema.String),
  modelVersion: /* @__PURE__ */ Schema.String.check(/* @__PURE__ */ Schema.makeFilter(value => value.length > 0)),
  players: /* @__PURE__ */ Schema.Array(Schema.Unknown),
});
const decodePredictionsEnvelope = /* @__PURE__ */ Schema.decodeUnknownSync(predictionsEnvelope);
const decodePrediction = /* @__PURE__ */ Schema.decodeUnknownSync(prediction);

export type PlayerPrediction = DataShape<typeof prediction.Type>;

export type KeeperFile = DataShape<typeof keeperFile.Type>;
export type PredictionsDataFile = Omit<DataShape<typeof predictionsEnvelope.Type>, 'players'> & { readonly players: DataShape<typeof prediction.Type>[] };
export const decodeKeeperFile = /* @__PURE__ */ Schema.decodeUnknownSync(keeperFile);
export const decodePrimaryLeagueSettingsFile = /* @__PURE__ */ Schema.decodeUnknownSync(primaryLeagueSettingsFile);

export interface DecodeOptions {
  readonly onWarning?: (message: string) => void;
}

export function decodePredictionsDataFile(value: unknown, options: DecodeOptions = {}): PredictionsDataFile {
  const envelope = decodePredictionsEnvelope(value);
  const players = decodeRows(envelope.players, decodePrediction, 'prediction', options);
  return { ...envelope, players };
}

export function decodeOrNull<A>(decode: (value: unknown) => A, value: unknown): A | null {
  try { return decode(value); } catch { return null; }
}


function decodeRows<A>(rows: readonly unknown[], decode: (row: unknown) => A, label: string, options: DecodeOptions): A[] {
  const retained: A[] = [];
  for (const row of rows) {
    try { retained.push(decode(row)); } catch { /* Report one bounded warning per collection. */ }
  }
  if (retained.length !== rows.length) options.onWarning?.(`Dropped ${rows.length - retained.length} invalid ${label} rows.`);
  return retained;
}

const teamEnvironment = /* @__PURE__ */ openStruct({
  team, name: Schema.String,
  /** Composite offensive score on a 1-10 scale. */
  offenseScore: Schema.Finite,
  /** Pass-attempt volume classification. */
  passVolume: /* @__PURE__ */ Schema.Literals(['high', 'medium', 'low']),
  /** Rush-attempt volume classification. */
  rushVolume: /* @__PURE__ */ Schema.Literals(['high', 'medium', 'low']),
  /** Points scored rank, 1-32. A rank of 1 is the most points. */
  pointsRank: Schema.Finite,
  /** Pass attempts rank, 1-32. A rank of 1 is the most attempts. */
  passAttemptsRank: Schema.Finite,
  /** Rush attempts rank, 1-32. A rank of 1 is the most attempts. */
  rushAttemptsRank: Schema.Finite,
  /** Whether the coaching staff is stable from the previous year. */
  coachingStability: Schema.Boolean,
});
const teamEnvEnvelope = /* @__PURE__ */ openStruct({
  generatedAt: Schema.String, season: Schema.Finite, teamCount: Schema.Finite,
  teams: /* @__PURE__ */ Schema.Record(Schema.String, Schema.Unknown),
}).check(/* @__PURE__ */ Schema.makeFilter(value => value.teamCount === NFL_TEAMS.length && NFL_TEAMS.every(key => Object.hasOwn(value.teams, key))));
const decodeTeamEnvEnvelope = /* @__PURE__ */ Schema.decodeUnknownSync(teamEnvEnvelope);
const decodeTeamEnvironment = /* @__PURE__ */ Schema.decodeUnknownSync(teamEnvironment);
export type TeamEnvironment = DataShape<typeof teamEnvironment.Type>;
export type VolumeLevel = TeamEnvironment['passVolume'];
export const isTeamEnvironment = /* @__PURE__ */ Schema.is(teamEnvironment);
export type TeamEnvDataFile = Omit<DataShape<typeof teamEnvEnvelope.Type>, 'teams'> & { readonly teams: Partial<Record<typeof team.Type, TeamEnvironment>> };
export function decodeTeamEnvDataFile(value: unknown, options: DecodeOptions = {}): TeamEnvDataFile {
  const envelope = decodeTeamEnvEnvelope(value);
  const teams: TeamEnvDataFile['teams'] = {};
  let dropped = 0;
  for (const [key, row] of Object.entries(envelope.teams)) {
    try {
      const environment = decodeTeamEnvironment(row);
      if (key !== environment.team) throw new Error('Team key does not match its row');
      teams[environment.team] = environment;
    } catch { dropped++; }
  }
  if (dropped) options.onWarning?.(`Dropped ${dropped} invalid team environment rows.`);
  return { ...envelope, teams, teamCount: Object.keys(teams).length };
}

const contractPlayer = /* @__PURE__ */ openStruct({ ...namedPlayer, contractEndYear: Schema.Finite, isContractYear: Schema.Boolean });
const contractEnvelope = /* @__PURE__ */ openStruct({
  generatedAt: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ Schema.NullOr(Schema.String)), scrapedAt: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ Schema.NullOr(Schema.String)),
  contractYear: Schema.Finite, playerCount: Schema.Finite, players: /* @__PURE__ */ Schema.Array(Schema.Unknown),
});
const decodeContractEnvelope = /* @__PURE__ */ Schema.decodeUnknownSync(contractEnvelope);
const decodeContractPlayer = /* @__PURE__ */ Schema.decodeUnknownSync(contractPlayer);
export type ContractPlayerData = DataShape<typeof contractPlayer.Type>;
export type ContractDataFile = Omit<DataShape<typeof contractEnvelope.Type>, 'players'> & { readonly players: readonly ContractPlayerData[] };
export function decodeContractDataFile(value: unknown, options: DecodeOptions = {}): ContractDataFile {
  const envelope = decodeContractEnvelope(value);
  const players = decodeRows(envelope.players, decodeContractPlayer, 'contract', options);
  return { ...envelope, players, playerCount: players.length };
}

const recommendationPolicy = /* @__PURE__ */ openStruct({
  generatedAt: Schema.String, recommendationArchitecture: /* @__PURE__ */ Schema.Literal(LIVE_RECOMMENDATION_ARCHITECTURE),
  modelPredictionsEnabled: Schema.Boolean, contractSignalEnabled: Schema.Boolean,
  fallback: /* @__PURE__ */ Schema.Literals(['model', 'fantasypros-ecr-market']),
  shadowLogging: /* @__PURE__ */ openStruct({ enabled: Schema.Boolean, season: Schema.Finite, endpoint: Schema.String }), reason: Schema.String,
});
export type RecommendationPolicyFile = DataShape<typeof recommendationPolicy.Type>;
export const decodeRecommendationPolicyFile = /* @__PURE__ */ Schema.decodeUnknownSync(recommendationPolicy);
export const isRecommendationPolicyFile = /* @__PURE__ */ Schema.is(recommendationPolicy);

const marketAdpFormat = /* @__PURE__ */ Schema.Literals(['standard', 'half-ppr', 'ppr']);
const marketAdpPlayer = /* @__PURE__ */ openStruct({ externalId: Schema.String, name: Schema.String, position,
  team: /* @__PURE__ */ Schema.NullOr(team), adp: /* @__PURE__ */ Schema.Finite.check(/* @__PURE__ */ Schema.makeFilter(value => value > 0)),
});
const marketAdpFields = {
  source: /* @__PURE__ */ Schema.Literal('fantasy-football-calculator'), format: marketAdpFormat, teams: Schema.Finite, season: Schema.Finite,
  refreshedAt: Schema.String, draftCount: /* @__PURE__ */ Schema.NullOr(Schema.Finite), players: /* @__PURE__ */ Schema.Array(Schema.Unknown),
  warnings: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ Schema.Array(Schema.String)),
};
const marketAdpEnvelope = /* @__PURE__ */ openStruct(marketAdpFields);
const decodeMarketAdpEnvelope = /* @__PURE__ */ Schema.decodeUnknownSync(marketAdpEnvelope);
const decodeMarketAdpPlayer = /* @__PURE__ */ Schema.decodeUnknownSync(marketAdpPlayer);
export type MarketAdpFormat = typeof marketAdpFormat.Type;
export type MarketAdpPlayer = DataShape<typeof marketAdpPlayer.Type>;
export type MarketAdpSnapshot = Omit<DataShape<typeof marketAdpEnvelope.Type>, 'players'> & { readonly players: readonly MarketAdpPlayer[] };
export const isMarketAdpFormat = /* @__PURE__ */ Schema.is(marketAdpFormat);
export const isMarketAdpSnapshot = /* @__PURE__ */ Schema.is(/* @__PURE__ */ openStruct({ ...marketAdpFields, players: /* @__PURE__ */ Schema.Array(marketAdpPlayer) }));
export function decodeMarketAdpSnapshot(value: unknown, options: DecodeOptions = {}): MarketAdpSnapshot {
  const envelope = decodeMarketAdpEnvelope(value);
  return { ...envelope, players: decodeRows(envelope.players, decodeMarketAdpPlayer, 'market ADP', options) };
}

const sportsbook = /* @__PURE__ */ Schema.Literals(['draftkings', 'fanduel']);
const sportsbookMarket = /* @__PURE__ */ Schema.Literals(['passingYards', 'passingTouchdowns', 'rushingYards', 'rushingTouchdowns', 'receivingYards', 'receivingTouchdowns', 'receptions']);
const sportsbookLine = { sportsbook, playerName: Schema.String, market: sportsbookMarket, sourceFile: Schema.String };
const overUnderLine = /* @__PURE__ */ openStruct({ ...sportsbookLine, line: Schema.Finite, overOdds: Schema.Finite, underOdds: Schema.Finite });
const milestoneLine = /* @__PURE__ */ openStruct({ ...sportsbookLine, threshold: Schema.Finite, americanOdds: Schema.Finite });
const sportsbookFields = {
  metadata: /* @__PURE__ */ openStruct({ season: Schema.Finite, capturedAt: Schema.String, importedAt: Schema.String, sourceDirectory: Schema.String,
    overUnderCount: Schema.Finite, milestoneCount: Schema.Finite }),
  overUnder: /* @__PURE__ */ Schema.Array(Schema.Unknown), milestones: /* @__PURE__ */ Schema.Array(Schema.Unknown), warnings: /* @__PURE__ */ Schema.Array(Schema.String),
  decodeWarnings: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ Schema.Array(Schema.String)),
};
const sportsbookEnvelope = /* @__PURE__ */ openStruct(sportsbookFields);
const decodeSportsbookEnvelope = /* @__PURE__ */ Schema.decodeUnknownSync(sportsbookEnvelope);
const decodeOverUnderLine = /* @__PURE__ */ Schema.decodeUnknownSync(overUnderLine);
const decodeMilestoneLine = /* @__PURE__ */ Schema.decodeUnknownSync(milestoneLine);
export type SportsbookOverUnderLine = DataShape<typeof overUnderLine.Type>;
export type SportsbookSnapshot = Omit<DataShape<typeof sportsbookEnvelope.Type>, 'overUnder' | 'milestones'> & {
  readonly overUnder: readonly SportsbookOverUnderLine[]; readonly milestones: readonly DataShape<typeof milestoneLine.Type>[];
};
export const isSportsbookSnapshot = /* @__PURE__ */ Schema.is(/* @__PURE__ */ openStruct({ ...sportsbookFields,
  overUnder: /* @__PURE__ */ Schema.Array(overUnderLine), milestones: /* @__PURE__ */ Schema.Array(milestoneLine),
}));
export function decodeSportsbookSnapshot(value: unknown, options: DecodeOptions = {}): SportsbookSnapshot {
  const envelope = decodeSportsbookEnvelope(value);
  const overUnder = decodeRows(envelope.overUnder, decodeOverUnderLine, 'sportsbook over/under', options);
  const milestones = decodeRows(envelope.milestones, decodeMilestoneLine, 'sportsbook milestone', options);
  return { ...envelope, metadata: { ...envelope.metadata, overUnderCount: overUnder.length, milestoneCount: milestones.length }, overUnder, milestones };
}

const survivalSummary = /* @__PURE__ */ openStruct({ position, leagueMedianPick: Schema.Finite, sleeperMedianPick: Schema.Finite,
  pickPremium: Schema.Finite, top50RateDelta: Schema.Finite, top100RateDelta: Schema.Finite, sampleSize: Schema.Finite });
const survivalBucket = /* @__PURE__ */ openStruct({ label: Schema.String, minPick: Schema.Finite, maxPick: Schema.Finite,
  positions: /* @__PURE__ */ Schema.Record(position, /* @__PURE__ */ openStruct({ leaguePickRate: Schema.Finite, sleeperPickRate: Schema.Finite, rateDelta: Schema.Finite })),
});
const survivalManager = /* @__PURE__ */ openStruct({ managerKey: Schema.String, draftSlots: /* @__PURE__ */ Schema.Array(Schema.Finite), sampleSize: Schema.Finite,
  positions: /* @__PURE__ */ Schema.Record(position, /* @__PURE__ */ openStruct({ picks: Schema.Finite, pickRate: Schema.Finite, earlyPickRate: Schema.Finite,
    leaguePickRateDelta: optionalNumber })),
});
const survivalFields = {
  generatedAt: Schema.String, modelVersion: Schema.String, leagueName: Schema.String,
  seasons: /* @__PURE__ */ Schema.Array(Schema.Finite), sampleSize: Schema.Finite,
  positions: /* @__PURE__ */ Schema.Record(Schema.String, Schema.Unknown),
  historicalPickNumbers: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ Schema.Record(Schema.String, Schema.Unknown)),
  adpBuckets: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ Schema.Array(Schema.Unknown)), managerTendencies: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ Schema.Array(Schema.Unknown)),
};
const survivalEnvelope = /* @__PURE__ */ openStruct(survivalFields);
const decodeSurvivalEnvelope = /* @__PURE__ */ Schema.decodeUnknownSync(survivalEnvelope);
const decodeSurvivalSummary = /* @__PURE__ */ Schema.decodeUnknownSync(survivalSummary);
const decodeHistoricalPicks = /* @__PURE__ */ Schema.decodeUnknownSync(/* @__PURE__ */ Schema.Array(Schema.Finite));
const decodeSurvivalBucket = /* @__PURE__ */ Schema.decodeUnknownSync(survivalBucket);
const decodeSurvivalManager = /* @__PURE__ */ Schema.decodeUnknownSync(survivalManager);
export type LeagueSurvivalPositionSummary = DataShape<typeof survivalSummary.Type>;
export type LeagueSurvivalModel = Omit<DataShape<typeof survivalEnvelope.Type>, 'positions' | 'historicalPickNumbers' | 'adpBuckets' | 'managerTendencies'> & {
  readonly positions: Partial<Record<typeof position.Type, LeagueSurvivalPositionSummary>>;
  /** Empirical overall pick numbers for each position across Primary League seasons. */
  readonly historicalPickNumbers?: Partial<Record<typeof position.Type, readonly number[]>>;
  readonly adpBuckets?: readonly DataShape<typeof survivalBucket.Type>[];
  readonly managerTendencies?: readonly DataShape<typeof survivalManager.Type>[];
};
export const isLeagueSurvivalModel = /* @__PURE__ */ Schema.is(/* @__PURE__ */ openStruct({ ...survivalFields,
  positions: /* @__PURE__ */ Schema.Record(Schema.String, survivalSummary), historicalPickNumbers: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ Schema.Record(Schema.String, /* @__PURE__ */ Schema.Array(Schema.Finite))),
  adpBuckets: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ Schema.Array(survivalBucket)), managerTendencies: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ Schema.Array(survivalManager)),
}));
export function decodeLeagueSurvivalModel(value: unknown, options: DecodeOptions = {}): LeagueSurvivalModel {
  const envelope = decodeSurvivalEnvelope(value);
  for (const [rows, label] of [[envelope.positions, 'survival position'], [envelope.historicalPickNumbers, 'historical position']] as const) {
    const dropped = Object.keys(rows ?? {}).filter(key => !isPosition(key)).length;
    if (dropped) options.onWarning?.(`Dropped ${dropped} invalid ${label} rows.`);
  }
  const positions: LeagueSurvivalModel['positions'] = {};
  const historicalPickNumbers: NonNullable<LeagueSurvivalModel['historicalPickNumbers']> = {};
  for (const key of POSITIONS) {
    const rows = decodeRows([envelope.positions[key]], decodeSurvivalSummary, `survival ${key}`, options);
    const row = rows[0];
    if (row) positions[key] = row;
    if (envelope.historicalPickNumbers?.[key] !== undefined) {
      const samples = decodeRows([envelope.historicalPickNumbers[key]], decodeHistoricalPicks, `historical ${key}`, options)[0];
      if (samples) historicalPickNumbers[key] = samples;
    }
  }
  const { historicalPickNumbers: _rawPicks, adpBuckets: _rawBuckets, managerTendencies: _rawManagers, ...metadata } = envelope;
  return { ...metadata, positions,
    ...(envelope.historicalPickNumbers === undefined ? {} : { historicalPickNumbers }),
    ...(envelope.adpBuckets === undefined ? {} : { adpBuckets: decodeRows(envelope.adpBuckets, decodeSurvivalBucket, 'survival bucket', options) }),
    ...(envelope.managerTendencies === undefined ? {} : { managerTendencies: decodeRows(envelope.managerTendencies, decodeSurvivalManager, 'survival manager', options) }),
  };
}
