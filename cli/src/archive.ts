import { Effect, Schema } from 'effect';
import {
  isPlayer,
  POSITIONS,
} from '@fantasy-draft/shared/league';
import {
  CORE_DRAFT_DATA_KEYS,
  OPTIONAL_SIGNAL_KEYS,
  type DraftReadinessReport,
} from '@fantasy-draft/shared/catalog';
import type { DraftSyncSnapshot } from '@fantasy-draft/shared/sync';
import { decodeDraftSyncSnapshot } from '@fantasy-draft/shared/catalog';
import { isRecommendationPolicyFile, isLeagueSurvivalModel } from '@fantasy-draft/shared/catalog';
import { getKeeperPickNumber } from '@fantasy-draft/shared/draft';
import { createSessionContext } from './context';
import { parseSession } from './arguments';
import type { DraftData } from './data';
import { readBoundedJson, writePrivateJson } from './files';
import { CliError, required } from './errors';

type ArchivedDraftData = Omit<DraftData, 'keeperStatus'> & {
  readonly keeperStatus: Omit<DraftData['keeperStatus'], 'error'> & { readonly error: string | null };
};
export interface SessionArchive {
  readonly schemaVersion: 1;
  readonly kind: 'fantasy-draft-session';
  readonly capturedAt: string;
  readonly session: string;
  readonly slot: number | null;
  readonly snapshot: DraftSyncSnapshot;
  readonly data: ArchivedDraftData;
  readonly readiness: DraftReadinessReport;
  readonly warnings: readonly string[];
}

const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;

function openStruct<const Fields extends Schema.Struct.Fields>(fields: Fields) {
  return Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)]);
}

const count = Schema.Finite.check(Schema.makeFilter(value => Number.isInteger(value) && value >= 0 && value <= 5000));
const timestamp = Schema.String.check(Schema.makeFilter(value => Number.isFinite(Date.parse(value))));
const strings = Schema.Array(Schema.String).check(Schema.makeFilter(value => value.length <= 5000));
const readinessItem = openStruct({
  key: Schema.Literals([...CORE_DRAFT_DATA_KEYS, ...OPTIONAL_SIGNAL_KEYS]),
  label: Schema.String, classification: Schema.Literals(['core-draft-data', 'optional-signal']),
  sourceLabel: Schema.String, timestampLabel: Schema.String, correctiveAction: Schema.String,
  status: Schema.Literals(['ready', 'blocking', 'degraded']),
  problem: Schema.NullOr(Schema.Literals(['missing', 'invalid', 'stale', 'older-than-dependency'])),
  timestamp: Schema.NullOr(Schema.String), ageHours: Schema.NullOr(Schema.Finite),
  maxAgeHours: Schema.NullOr(Schema.Finite), message: Schema.String,
});
const readiness = openStruct({
  generatedAt: timestamp, status: Schema.Literals(['ready', 'blocked']),
  summary: openStruct({ productBlockingFailures: count, actionableWarnings: count, optionalSignalDegradations: count }),
  coreDraftData: Schema.Array(readinessItem), optionalSignals: Schema.Array(readinessItem),
  productBlockingFailures: Schema.Array(readinessItem), optionalSignalDegradations: Schema.Array(readinessItem),
  actionableWarnings: Schema.Array(openStruct({
    key: Schema.String, label: Schema.String, sourceLabel: Schema.String, message: Schema.String,
    correctiveAction: Schema.optional(Schema.String), timestamp: Schema.optional(Schema.NullOr(Schema.String)),
    status: Schema.Literal('warning'),
  })),
  engineeringChecks: openStruct({
    status: Schema.Literal('not-run'), message: Schema.String,
    commands: Schema.Tuple([Schema.Literal('pnpm typecheck'), Schema.Literal('pnpm lint'),
      Schema.Literal('pnpm test'), Schema.Literal('pnpm build')]),
  }),
});
const player = Schema.declare(isPlayer).check(Schema.makeFilter(value => value.id.length > 0 &&
  Object.values(value).every(field => typeof field !== 'number' || Number.isFinite(field))));
const archivedDataSchema = openStruct({
  players: Schema.Array(player).check(Schema.makeFilter(value => value.length > 0 && value.length <= 5000)),
  policy: Schema.declare(isRecommendationPolicyFile),
  survivalModel: Schema.NullOr(Schema.declare(isLeagueSurvivalModel)),
  keepers: Schema.Array(openStruct({
    playerId: Schema.String, playerName: Schema.String, position: Schema.Literals(POSITIONS),
    isMyKeeper: Schema.Boolean, teamIndex: count, round: count, pickNumber: count,
  })).check(Schema.makeFilter(value => value.length <= 32)),
  keeperStatus: openStruct({
    season: Schema.optional(Schema.Finite.check(Schema.makeFilter(value => Number.isInteger(value) && value >= 0 && value <= 9999))),
    confirmedAt: Schema.NullOr(Schema.String), configuredCount: count, resolvedCount: count, canonicalCount: count,
    unresolvedNames: strings, duplicateNames: strings, invalidAssignments: strings,
    isLoading: Schema.Boolean, isError: Schema.Boolean, isInitialized: Schema.Boolean,
    isConfirmed: Schema.Boolean, isMockReady: Schema.Boolean, error: Schema.NullOr(Schema.String),
  }),
});
const decodeArchiveEnvelope = Schema.decodeUnknownSync(openStruct({
  schemaVersion: Schema.Literal(1), kind: Schema.Literal('fantasy-draft-session'),
  capturedAt: timestamp, session: Schema.String, slot: Schema.NullOr(count), snapshot: Schema.Unknown,
  data: archivedDataSchema, readiness, warnings: strings,
}));

function hasConsistentReadiness(value: DraftReadinessReport): boolean {
  const core = value.coreDraftData;
  const optional = value.optionalSignals;
  const failures = core.filter(item => item.status === 'blocking');
  return core.length === CORE_DRAFT_DATA_KEYS.length && CORE_DRAFT_DATA_KEYS.every(key => core.filter(item => item.key === key).length === 1) &&
    core.every(item => item.status === 'ready' || item.status === 'blocking') &&
    optional.length === OPTIONAL_SIGNAL_KEYS.length && OPTIONAL_SIGNAL_KEYS.every(key => optional.filter(item => item.key === key).length === 1) &&
    optional.every(item => item.status === 'ready' || item.status === 'degraded') &&
    value.status === (failures.length > 0 ? 'blocked' : 'ready') && value.summary.productBlockingFailures === failures.length &&
    value.productBlockingFailures.length === failures.length &&
    value.productBlockingFailures.every(item => failures.some(failure => failure.key === item.key));
}

function hasConsistentData(value: ArchivedDraftData, snapshot: DraftSyncSnapshot): boolean {
  const draft = snapshot.draft;
  if (!draft) return false;
  const { teams, rounds } = draft.settings;
  const byId = new Map(value.players.map(player => [player.id, player]));
  return byId.size === value.players.length && value.keepers.every(keeper =>
    keeper.teamIndex < teams && keeper.round >= 1 && keeper.round <= rounds &&
    keeper.pickNumber === getKeeperPickNumber(keeper, teams, draft.type) &&
    byId.get(keeper.playerId)?.position === keeper.position) &&
    new Set(value.keepers.map(keeper => keeper.playerId)).size === value.keepers.length &&
    new Set(value.keepers.map(keeper => keeper.pickNumber)).size === value.keepers.length;
}

export function createArchive(snapshot: DraftSyncSnapshot, data: DraftData, readiness: DraftReadinessReport,
  slot: number | undefined, warnings: readonly string[], now: number): SessionArchive {
  return { schemaVersion: 1, kind: 'fantasy-draft-session', capturedAt: new Date(now).toISOString(),
    session: `${snapshot.provider}:${snapshot.draftId}`, slot: slot ?? null, snapshot,
    data: { ...data, keeperStatus: { ...data.keeperStatus, error: data.keeperStatus.error?.message ?? null } },
    readiness, warnings };
}

export const saveArchive = Effect.fn('saveArchive')(function* (path: string, archive: SessionArchive, force: boolean) {
  if (Buffer.byteLength(JSON.stringify(archive, null, 2)) + 1 > MAX_ARCHIVE_BYTES) {
    return yield* new CliError('EXPORT_TOO_LARGE', 'The session export exceeds the 20 MiB size limit.');
  }
  yield* writePrivateJson(path, archive, force);
});

export const readArchive = Effect.fn('readArchive')(function* (path: string) {
  const value = yield* readBoundedJson(path, MAX_ARCHIVE_BYTES).pipe(Effect.mapError(error =>
    error._tag === 'JsonFileError' && error.missing
      ? new CliError('REPLAY_NOT_FOUND', 'The session archive does not exist.', 2)
      : new CliError('INVALID_ARCHIVE', 'The replay input must be a valid session archive within the 20 MiB size limit.', 2)));
  return yield* Effect.try({
    try: () => validArchive(value),
    catch: () => new CliError('INVALID_ARCHIVE', 'The session archive has invalid or inconsistent draft data.', 2),
  });
});

function validArchive(value: unknown): SessionArchive {
  const envelope = decodeArchiveEnvelope(value);
  const snapshot = decodeDraftSyncSnapshot(envelope.snapshot);
  const draft = snapshot.draft;
  if (!draft || parseSession(envelope.session).id !== `${snapshot.provider}:${snapshot.draftId}` ||
      draft.provider !== snapshot.provider || draft.draftId !== snapshot.draftId ||
      !(envelope.slot === null || envelope.slot >= 1 && envelope.slot <= draft.settings.teams) ||
      !hasConsistentData(envelope.data, snapshot) || !hasConsistentReadiness(envelope.readiness)) {
    throw new Error('Invalid archive');
  }
  const { teams, rounds } = draft.settings;
  const totalPicks = teams * rounds;
  if (snapshot.picks.some(pick => pick.draftId !== snapshot.draftId || pick.pickNumber > totalPicks ||
      pick.draftSlot > teams || pick.teamIndex >= teams) ||
      new Set(snapshot.picks.map(pick => pick.pickNumber)).size !== snapshot.picks.length ||
      new Set(snapshot.picks.map(pick => pick.playerId)).size !== snapshot.picks.length) throw new Error('Inconsistent picks');
  return { ...envelope, snapshot };
}

export function archivedData(archive: SessionArchive): DraftData {
  return { ...archive.data, keeperStatus: { ...archive.data.keeperStatus,
    error: archive.data.keeperStatus.error === null ? null : new Error(archive.data.keeperStatus.error) } };
}

export function replaySnapshot(archive: SessionArchive, pick?: number): DraftSyncSnapshot {
  if (pick === undefined) return archive.snapshot;
  const context = createSessionContext(archive.snapshot, archivedData(archive), archive.slot ?? undefined, Date.parse(archive.capturedAt));
  const draft = required(archive.snapshot.draft, 'archived draft');
  const currentPick = required(context.currentPick, 'archived current pick');
  if (!Number.isInteger(pick) || pick < 1 || pick > currentPick) {
    throw new CliError('REPLAY_PICK_OUT_OF_RANGE', `--pick must be between 1 and the captured current pick ${String(context.currentPick)}.`, 2);
  }
  return { ...archive.snapshot, picks: archive.snapshot.picks.filter(entry => entry.isKeeper || entry.pickNumber < pick),
    draft: { ...draft, status: draft.status === 'complete' && pick <= context.totalPicks
      ? 'drafting' : draft.status } };
}

export function replayBoundaries(archive: SessionArchive): readonly number[] {
  const context = createSessionContext(archive.snapshot, archivedData(archive), archive.slot ?? undefined, Date.parse(archive.capturedAt));
  const currentPick = required(context.currentPick, 'archived current pick');
  return [...new Set([1, ...archive.snapshot.picks.filter(pick => !pick.isKeeper).map(pick => pick.pickNumber + 1), currentPick])]
    .filter(pick => pick <= currentPick).sort((left, right) => left - right);
}
