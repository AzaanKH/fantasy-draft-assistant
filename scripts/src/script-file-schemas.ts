import { Schema } from 'effect';
import { decodePredictionsDataFile } from '@fantasy-draft/shared/catalog';
import { POSITIONS } from '@fantasy-draft/shared/league';

function openStruct<const Fields extends Schema.Struct.Fields>(fields: Fields) {
  return Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)]);
}

const modelPosition = openStruct({
  modelFamily: Schema.String,
  candidateSetVersion: Schema.String,
  specificationId: Schema.String,
  featureNames: Schema.Array(Schema.String),
  volumeThreshold: Schema.Finite,
  ridgeLambda: Schema.Finite,
  selectedWithTrainingSeasons: Schema.Array(Schema.Finite),
  innerValidationSeason: Schema.NullOr(Schema.Finite),
  trainingRows: Schema.Finite,
  trainedThroughSeason: Schema.NullOr(Schema.Finite),
});
const modelReport = openStruct({
  generatedAt: Schema.String,
  modelVersion: Schema.String,
  seasons: Schema.Array(Schema.Finite),
  currentSeason: Schema.Finite,
  positionResidualModels: Schema.Struct({ QB: modelPosition, RB: modelPosition, WR: modelPosition, TE: modelPosition }),
  counts: Schema.Array(openStruct({ tableName: Schema.String, rowCount: Schema.Finite })),
});
const historicalSnapshotReport = openStruct({
  generatedAt: Schema.String,
  seasons: Schema.Array(openStruct({
    season: Schema.Finite, draftId: Schema.String, draftTimestamp: Schema.String,
    players: Schema.Finite, cutoffViolations: Schema.Finite,
  })),
});
const sourceMap = openStruct({
  sources: Schema.optional(Schema.Array(Schema.String)),
  sourcesContent: Schema.optional(Schema.Array(Schema.NullOr(Schema.String))),
});
const pick = openStruct({
  pickNo: Schema.Finite, round: Schema.Finite, playerName: Schema.String,
  position: Schema.Literals(POSITIONS), isKeeper: Schema.Boolean,
});
const leagueHistory = openStruct({
  leagueName: Schema.String,
  seasons: Schema.Array(openStruct({
    season: Schema.Finite, userSlot: Schema.Finite,
    picks: Schema.Array(pick), userPicks: Schema.Array(pick),
  })),
});
const failure = openStruct({ key: Schema.String, label: Schema.String, message: Schema.String });
const readinessEvidence = openStruct({
  generatedAt: Schema.String,
  status: Schema.Literals(['ready', 'blocked']),
  productBlockingFailures: Schema.Array(failure),
  actionableWarnings: Schema.Array(failure),
  optionalSignalDegradations: Schema.Array(failure),
});
const rehearsalEvidence = openStruct({
  generatedAt: Schema.String, status: Schema.Literals(['passed', 'failed']),
  configuration: openStruct({ totalTeams: Schema.Finite, totalRounds: Schema.Finite, totalPicks: Schema.Finite, keeperCount: Schema.Finite }),
  transitions: openStruct({ observed: Schema.Finite, recommendationChecks: Schema.Finite }),
  reconciliation: openStruct({ confirmations: Schema.Finite, corrections: Schema.Finite, removals: Schema.Finite }),
  completion: openStruct({ canonicalPicks: Schema.Finite, providerPicks: Schema.Finite, keeperPicks: Schema.Finite }),
  failures: Schema.Array(Schema.String),
});
const operationalEvidence = openStruct({
  season: Schema.optional(Schema.Finite), provider: Schema.optional(Schema.String),
  draftId: Schema.optional(Schema.String), leagueId: Schema.optional(Schema.String),
  recordedAt: Schema.optional(Schema.String), scheduledStartAt: Schema.optional(Schema.String),
  timezone: Schema.optional(Schema.String), pickTimerSeconds: Schema.optional(Schema.Finite),
  providerStatus: Schema.optional(Schema.String),
  realProviderRehearsal: Schema.optional(openStruct({
    status: Schema.optional(Schema.String), completedAt: Schema.optional(Schema.NullOr(Schema.String)),
    notes: Schema.optional(Schema.String),
  })),
});

export const decodeModelReport = Schema.decodeUnknownSync(modelReport);
export const decodeHistoricalSnapshotReport = Schema.decodeUnknownSync(historicalSnapshotReport);
export const decodeSourceMap = Schema.decodeUnknownSync(sourceMap);
export const decodeLeagueHistory = Schema.decodeUnknownSync(leagueHistory);
export const decodeReadinessEvidence = Schema.decodeUnknownSync(readinessEvidence);
export const decodeRehearsalEvidence = Schema.decodeUnknownSync(rehearsalEvidence);
export const decodeOperationalEvidence = Schema.decodeUnknownSync(operationalEvidence);

const backtestLeagueHistory = openStruct({
  seasons: Schema.Array(openStruct({
    season: Schema.Finite,
    rosterPositions: Schema.Array(Schema.String),
    rosterIdToOwner: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
    picks: Schema.Array(openStruct({
      pickNo: Schema.Finite, round: Schema.Finite, rosterId: Schema.Finite,
      playerId: Schema.String, playerName: Schema.String, position: Schema.Literals(POSITIONS),
      isUserPick: Schema.Boolean, isKeeper: Schema.Boolean,
    })),
  })),
});
const survivalHistoryPick = openStruct({
  pickNo: Schema.Finite, draftSlot: Schema.Finite,
  pickedByDisplayName: Schema.String, position: Schema.Literals(POSITIONS),
});
const survivalHistory = openStruct({
  leagueName: Schema.String,
  seasons: Schema.Array(openStruct({
    season: Schema.Finite, leagueName: Schema.String, picks: Schema.Array(survivalHistoryPick),
  })),
});
const teamStatRow = Schema.Struct({
  team: Schema.String, pass_attempts: Schema.Finite, rush_attempts: Schema.Finite,
  total_yards: Schema.Finite, offensive_tds: Schema.Finite,
  passing_epa: Schema.Finite, rushing_epa: Schema.Finite,
});
const historicalDraft = Schema.Struct({
  draft_id: Schema.String, league_id: Schema.String,
  season: Schema.String.check(Schema.makeFilter(value => Number.isInteger(Number(value)))),
  start_time: Schema.Finite,
});
const demoPredictionInputs = Schema.Struct({
  playerId: Schema.String, baseProjectedPoints: Schema.Finite,
  valueOverReplacement: Schema.Finite, uncertaintyScore: Schema.Finite,
});
const hasDemoPredictionInputs = Schema.is(demoPredictionInputs);

export const decodeBacktestLeagueHistory = Schema.decodeUnknownSync(backtestLeagueHistory);
export const decodeSurvivalHistory = Schema.decodeUnknownSync(survivalHistory);
export type SurvivalHistoryPick = typeof survivalHistoryPick.Type;
export const decodeTeamStatRows = Schema.decodeUnknownSync(Schema.Array(teamStatRow));
export const decodeHistoricalDraft = Schema.decodeUnknownSync(historicalDraft);

export function decodeDemoPredictions(value: unknown, onWarning: (message: string) => void): Omit<ReturnType<typeof decodePredictionsDataFile>, 'generatedAt' | 'players'> & { readonly generatedAt: string; readonly players: readonly (ReturnType<typeof decodePredictionsDataFile>['players'][number] & typeof demoPredictionInputs.Type)[] } {
  const decoded = decodePredictionsDataFile(value, { onWarning });
  if (decoded.generatedAt === null) throw new Error('Demo model predictions require generatedAt.');
  const players = decoded.players.flatMap(player => hasDemoPredictionInputs(player) ? [player] : []);
  const dropped = decoded.players.length - players.length;
  if (dropped > 0) onWarning(`Dropped ${dropped} prediction rows without required demo model inputs.`);
  return { ...decoded, generatedAt: decoded.generatedAt, players };
}
