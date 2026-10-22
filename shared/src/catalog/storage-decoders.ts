import { DRAFT_SESSION_LINEAGE_LIMIT, isDraftSessionIdentity, isDraftSyncConnection, isValidDraftSyncId } from '../sessions.js';
import { isQuickMockPreferences } from '../draft/quick-mock-settings.js';
export { DRAFT_SESSION_LINEAGE_LIMIT, isDraftSessionIdentity, isDraftSyncConnection, isValidDraftSyncId, isQuickMockPreferences };
import { Schema } from 'effect';
import { deriveDraftCursor, type DraftProgress } from '../draft-progress.js';
import { isLeagueSettings, isRosterRequirements } from '../league-settings.js';
import { createSlotSequence } from '../draft-order.js';
import { MAX_DRAFT_PICKS, MAX_DRAFT_ROUNDS, MAX_DRAFT_TEAMS, isDraftSize } from '../limits.js';
import { POSITIONS } from '../player.js';
import { DRAFT_DATA_REFRESH_STEPS } from '../draft-data-refresh.js';

function object<const F extends Schema.Struct.Fields>(fields: F) {
  return /* @__PURE__ */ Schema.StructWithRest(/* @__PURE__ */ Schema.Struct(fields), [/* @__PURE__ */ Schema.Record(Schema.String, Schema.Unknown)]);
}
function integer(min: number, max: number) {
  return Schema.Finite.check(/* @__PURE__ */ Schema.makeFilter(value => Number.isInteger(value) && value >= min && value <= max));
}
const text = /* @__PURE__ */ Schema.String.check(/* @__PURE__ */ Schema.makeFilter(value => value.length > 0 && value.length <= 512));
const timestamp = /* @__PURE__ */ Schema.Finite.check(/* @__PURE__ */ Schema.makeFilter(value => value >= 0));
const nullableTimestamp = /* @__PURE__ */ Schema.NullOr(timestamp);
const providerSchema = /* @__PURE__ */ Schema.Literals(['sleeper', 'espn', 'yahoo']);
const draftType = /* @__PURE__ */ Schema.Literals(['snake', 'linear', 'auction']);
const position = /* @__PURE__ */ Schema.Literals(POSITIONS);
const leagueSettings = /* @__PURE__ */ Schema.declare(isLeagueSettings);
const rosterRequirements = /* @__PURE__ */ Schema.declare(isRosterRequirements);

const identity = /* @__PURE__ */ object({ provider: providerSchema, draftId: Schema.String }).check(/* @__PURE__ */ Schema.makeFilter(value => isValidDraftSyncId(value.provider, value.draftId)));
export const decodeDraftSessionIdentity = /* @__PURE__ */ Schema.decodeUnknownSync(identity);
const connection = /* @__PURE__ */ object({
  provider: providerSchema, draftId: Schema.String, draftPosition: /* @__PURE__ */ Schema.NullOr(/* @__PURE__ */ integer(1, 20)),
  usePrimaryLeagueSettings: /* @__PURE__ */ Schema.optional(Schema.Boolean), settingsProfile: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ Schema.Literal('quick-mock')),
}).check(/* @__PURE__ */ Schema.makeFilter(value => isValidDraftSyncId(value.provider, value.draftId) &&
  (value.settingsProfile === undefined || value.provider === 'sleeper' && value.usePrimaryLeagueSettings !== true) &&
  (value.provider === 'sleeper' || value.usePrimaryLeagueSettings !== true)));
export const decodeDraftSyncConnection = /* @__PURE__ */ Schema.decodeUnknownSync(connection);

const quickMock = /* @__PURE__ */ object({ totalTeams: /* @__PURE__ */ integer(2, 20), totalRounds: /* @__PURE__ */ integer(10, 30),
  reception: /* @__PURE__ */ Schema.Literals([0, 0.5, 1]), passingTouchdown: /* @__PURE__ */ Schema.Literals([4, 6]), });
export const decodeQuickMockPreferences = /* @__PURE__ */ Schema.decodeUnknownSync(quickMock);
export const decodeLeagueSetupPreferences = /* @__PURE__ */ Schema.decodeUnknownSync(/* @__PURE__ */ object({
  profile: /* @__PURE__ */ Schema.Literals(['quick-mock', 'primary-league']), quickMock,
}));

const configFields = { totalTeams: /* @__PURE__ */ integer(2, MAX_DRAFT_TEAMS), totalRounds: /* @__PURE__ */ integer(1, MAX_DRAFT_ROUNDS),
  myPickPosition: /* @__PURE__ */ integer(1, MAX_DRAFT_TEAMS), rosterRequirements, draftType: /* @__PURE__ */ Schema.optional(draftType),
};
const config = /* @__PURE__ */ object(configFields).check(/* @__PURE__ */ Schema.makeFilter(value => isDraftSize(value.totalTeams, value.totalRounds) && value.myPickPosition <= value.totalTeams));
const recordedPick = /* @__PURE__ */ object({ pickNumber: /* @__PURE__ */ integer(1, MAX_DRAFT_PICKS), playerId: text, playerName: text, position,
  teamIndex: /* @__PURE__ */ integer(0, MAX_DRAFT_TEAMS - 1), teamName: text, timestamp,
  source: /* @__PURE__ */ Schema.Literals(['sync', 'manual', 'provisional', 'keeper']),
  shortlistIndex: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ integer(0, MAX_DRAFT_PICKS)), provisionalRevision: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ integer(0, Number.MAX_SAFE_INTEGER)),
  provisionalUpdatedAt: /* @__PURE__ */ Schema.optional(timestamp),
});
const keeper = /* @__PURE__ */ object({ playerId: text, playerName: text, position, teamIndex: /* @__PURE__ */ integer(0, MAX_DRAFT_TEAMS - 1),
  round: /* @__PURE__ */ integer(1, MAX_DRAFT_ROUNDS), isMyKeeper: Schema.Boolean });
const unresolvedPick = /* @__PURE__ */ object({ pickNumber: /* @__PURE__ */ integer(1, MAX_DRAFT_PICKS), playerId: text, playerName: text, nflTeam: /* @__PURE__ */ Schema.NullOr(text) });
const playerIds = /* @__PURE__ */ Schema.Array(text).check(/* @__PURE__ */ Schema.makeFilter(value => value.length <= MAX_DRAFT_PICKS));
const history = /* @__PURE__ */ Schema.Array(recordedPick).check(/* @__PURE__ */ Schema.makeFilter(value => value.length <= MAX_DRAFT_PICKS));
const keepers = /* @__PURE__ */ Schema.Array(keeper).check(/* @__PURE__ */ Schema.makeFilter(value => value.length <= MAX_DRAFT_PICKS));
const unresolved = /* @__PURE__ */ Schema.Array(unresolvedPick).check(/* @__PURE__ */ Schema.makeFilter(value => value.length <= MAX_DRAFT_PICKS));
const lens = /* @__PURE__ */ Schema.Literals(['best-pick', 'best-player']);
const session = /* @__PURE__ */ object({ version: /* @__PURE__ */ Schema.Literal(1), identity, config, leagueSettings,
  draftProgress: /* @__PURE__ */ Schema.optional(Schema.Unknown),
  currentPick: /* @__PURE__ */ integer(1, MAX_DRAFT_PICKS + 1), draftHistory: history, preloadedKeepers: keepers,
  shortlistedPlayerIds: playerIds, keepersInitialized: Schema.Boolean, unresolvedProviderPicks: unresolved,
  decisionLens: lens, manualContinuityBaselineAt: nullableTimestamp, lastConfirmedSyncAt: nullableTimestamp,
  lastConfirmedPickNumber: /* @__PURE__ */ integer(0, MAX_DRAFT_PICKS), revision: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ integer(0, Number.MAX_SAFE_INTEGER)),
  lineage: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ Schema.Array(text).check(/* @__PURE__ */ Schema.makeFilter(value => value.length <= DRAFT_SESSION_LINEAGE_LIMIT))),
}).check(/* @__PURE__ */ Schema.makeFilter(value => {
  const c = value.config;
  const total = c.totalTeams * c.totalRounds;
  // eslint-disable-next-line no-restricted-syntax -- Version 1 sessions predating draftType used snake order.
  const sequence = createSlotSequence({ type: c.draftType ?? 'snake', teams: c.totalTeams, rounds: c.totalRounds });
  return value.currentPick <= total + 1 && value.lastConfirmedPickNumber <= total &&
    (value.manualContinuityBaselineAt === null || value.identity.provider === 'sleeper') &&
    value.draftHistory.length <= total && value.preloadedKeepers.length <= total && value.unresolvedProviderPicks.length <= total &&
    value.draftHistory.every(pick => pick.pickNumber <= total && pick.teamIndex < c.totalTeams &&
      (pick.source !== 'provisional' || pick.teamIndex === sequence.at(pick.pickNumber).teamIndex)) &&
    value.preloadedKeepers.every(row => row.teamIndex < c.totalTeams && row.round <= c.totalRounds) &&
    value.unresolvedProviderPicks.every(row => row.pickNumber <= total);
}));
const progressPick = /* @__PURE__ */ integer(1, MAX_DRAFT_PICKS + 1);
// Keeper slots and bounds belong to the accepted command, even after the draft format changes.
const reservedSlots = {
  keeperSlots: /* @__PURE__ */ Schema.Array(/* @__PURE__ */ integer(1, MAX_DRAFT_PICKS))
    .check(/* @__PURE__ */ Schema.makeFilter(slots => slots.length <= MAX_DRAFT_PICKS && new Set(slots).size === slots.length)),
  totalPicks: /* @__PURE__ */ integer(1, MAX_DRAFT_PICKS),
};
const reservedAnchor = /* @__PURE__ */ Schema.Union([
  /* @__PURE__ */ object({ kind: /* @__PURE__ */ Schema.Literal('provider'), nextPickNumber: Schema.Finite, ...reservedSlots }),
  /* @__PURE__ */ object({ kind: /* @__PURE__ */ Schema.Literal('first-open'), ...reservedSlots }),
  /* @__PURE__ */ object({ kind: /* @__PURE__ */ Schema.Literal('past-keepers'), fromPick: progressPick, ...reservedSlots }),
]).check(/* @__PURE__ */ Schema.makeFilter(anchor => anchor.keeperSlots.every(slot => slot <= anchor.totalPicks)));
const progress = /* @__PURE__ */ object({
  anchor: /* @__PURE__ */ Schema.Union([
    /* @__PURE__ */ object({ kind: /* @__PURE__ */ Schema.Literal('start') }),
    /* @__PURE__ */ object({ kind: /* @__PURE__ */ Schema.Literal('branch'), pickNumber: progressPick }),
    /* @__PURE__ */ object({ kind: /* @__PURE__ */ Schema.Literal('reopen'), pickNumber: progressPick }),
    /* @__PURE__ */ object({ kind: /* @__PURE__ */ Schema.Literal('carry'), pickNumber: progressPick }),
    reservedAnchor,
  ]),
  historyLength: /* @__PURE__ */ integer(0, MAX_DRAFT_PICKS),
  historyOrder: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ Schema.Literal('pick')),
});
const decodeProgress = /* @__PURE__ */ Schema.decodeUnknownSync(progress);
const decodeSession = /* @__PURE__ */ Schema.decodeUnknownSync(session);
// Migration validates entries separately and retains the original history order.
export const decodeStoredDraftSessionRecord = decodeSession;
export const decodeStoredDraftPick = /* @__PURE__ */ Schema.decodeUnknownSync(recordedPick);
export const decodeStoredDraftKeeper = /* @__PURE__ */ Schema.decodeUnknownSync(keeper);
export const decodeStoredUnresolvedPick = /* @__PURE__ */ Schema.decodeUnknownSync(unresolvedPick);
export const decodeStoredPlayerId = /* @__PURE__ */ Schema.decodeUnknownSync(text);
export const decodeStoredDraftProgress = decodeProgress;
export function decodeStoredDraftSession(input: unknown): ReturnType<typeof decodeSession> & { readonly draftProgress: DraftProgress } {
  const value = decodeSession(input);
  // Legacy reloads sort picks; validate the command prefix against that same order.
  const draftHistory = [...value.draftHistory].sort((left, right) => left.pickNumber - right.pickNumber);
  let draftProgress: DraftProgress = {
    anchor: { kind: 'carry', pickNumber: value.currentPick }, historyLength: value.draftHistory.length,
  };
  if (value.draftProgress !== undefined) {
    try {
      const decoded = decodeProgress(value.draftProgress);
      if (decoded.historyLength > value.draftHistory.length ||
          deriveDraftCursor(draftHistory, decoded) !== value.currentPick) {
        throw new Error('Progress does not match the saved history and cursor');
      }
      draftProgress = decoded;
    } catch {
      console.warn('[Fantasy Draft] Could not restore stored draft progress; imported the saved cursor as carry.', { identity: value.identity });
    }
  }
  return { ...value, draftHistory, draftProgress };
}

function change<S extends Schema.Top>(schema: S) { return /* @__PURE__ */ object({ before: schema, after: schema }); }
const changeFields = {
  config: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ change(/* @__PURE__ */ object({ ...configFields, draftType }))), leagueSettings: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ change(leagueSettings)),
  preloadedKeepers: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ change(/* @__PURE__ */ Schema.mutable(keepers))), keepersInitialized: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ change(Schema.Boolean)),
  unresolvedProviderPicks: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ change(/* @__PURE__ */ Schema.mutable(unresolved))), decisionLens: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ change(lens)),
  manualContinuityBaselineAt: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ change(nullableTimestamp)), lastConfirmedSyncAt: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ change(nullableTimestamp)),
  lastConfirmedPickNumber: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ change(/* @__PURE__ */ integer(0, MAX_DRAFT_PICKS))), currentPick: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ change(/* @__PURE__ */ integer(1, MAX_DRAFT_PICKS + 1))),
};
const fields = /* @__PURE__ */ object(changeFields).check(/* @__PURE__ */ Schema.makeFilter(value => Object.keys(value).every(key => Object.hasOwn(changeFields, key))));
const journal = /* @__PURE__ */ object({ version: /* @__PURE__ */ Schema.Literal(1), writeId: text, baseWriteId: /* @__PURE__ */ Schema.NullOr(text),
  revision: /* @__PURE__ */ integer(0, Number.MAX_SAFE_INTEGER), queueAdded: playerIds, queueRemoved: playerIds,
  picks: /* @__PURE__ */ Schema.Array(/* @__PURE__ */ object({ pickNumber: /* @__PURE__ */ integer(1, MAX_DRAFT_PICKS), before: /* @__PURE__ */ Schema.NullOr(recordedPick), after: /* @__PURE__ */ Schema.NullOr(recordedPick) }))
    .check(/* @__PURE__ */ Schema.makeFilter(value => value.length <= MAX_DRAFT_PICKS)), fields,
});
export const decodeDraftSessionChange = /* @__PURE__ */ Schema.decodeUnknownSync(journal);

const refreshStatus = /* @__PURE__ */ object({ state: /* @__PURE__ */ Schema.Literals(['idle', 'running', 'succeeded', 'failed']),
  steps: /* @__PURE__ */ Schema.Array(/* @__PURE__ */ object({ key: /* @__PURE__ */ Schema.Literals(DRAFT_DATA_REFRESH_STEPS.map(step => step.key)), label: Schema.String,
    state: /* @__PURE__ */ Schema.Literals(['pending', 'running', 'succeeded', 'failed']) })),
  startedAt: /* @__PURE__ */ Schema.NullOr(Schema.String), finishedAt: /* @__PURE__ */ Schema.NullOr(Schema.String), error: /* @__PURE__ */ Schema.NullOr(Schema.String), detail: /* @__PURE__ */ Schema.NullOr(Schema.String),
});
export const decodeDraftDataRefreshStatus = /* @__PURE__ */ Schema.decodeUnknownSync(refreshStatus);
export const isDraftDataRefreshStatus = /* @__PURE__ */ Schema.is(refreshStatus);
