import type { DataShape } from './data-shape.js';
import { Schema } from 'effect';
import { isLeagueSettings } from '../league-settings.js';
import { MAX_DRAFT_PICKS, MAX_DRAFT_ROUNDS, MAX_DRAFT_TEAMS } from '../limits.js';
import { POSITIONS } from '../player.js';

function openStruct<const Fields extends Schema.Struct.Fields>(fields: Fields) {
  return /* @__PURE__ */ Schema.StructWithRest(/* @__PURE__ */ Schema.Struct(fields), [/* @__PURE__ */ Schema.Record(Schema.String, Schema.Unknown)]);
}
function integer(minimum: number, maximum: number) {
  return /* @__PURE__ */ Schema.Number.check(/* @__PURE__ */ Schema.makeFilter(value => Number.isSafeInteger(value) && value >= minimum && value <= maximum));
}
function boundedString(maximum: number) {
  return /* @__PURE__ */ Schema.String.check(/* @__PURE__ */ Schema.makeFilter(value => value.length <= maximum));
}
const provider = /* @__PURE__ */ Schema.Literals(['sleeper', 'yahoo', 'espn']);
const status = /* @__PURE__ */ Schema.Literals(['pre_draft', 'drafting', 'paused', 'complete']);
const draftType = /* @__PURE__ */ Schema.Literals(['snake', 'linear', 'auction']);
const syncState = /* @__PURE__ */ Schema.Literals(['idle', 'syncing', 'synced', 'error']);
const draftId = /* @__PURE__ */ boundedString(128);
const draftOrder = /* @__PURE__ */ Schema.NullOr(/* @__PURE__ */ Schema.Record(Schema.String, /* @__PURE__ */ integer(1, MAX_DRAFT_TEAMS)).check(/* @__PURE__ */ Schema.makeFilter(value => Object.keys(value).length <= MAX_DRAFT_TEAMS)));
const teams = /* @__PURE__ */ integer(2, MAX_DRAFT_TEAMS);
const rounds = /* @__PURE__ */ integer(1, MAX_DRAFT_ROUNDS);
const timer = /* @__PURE__ */ integer(0, 86_400);
const sleeperDraftMetadata = /* @__PURE__ */ openStruct({
  draft_id: Schema.String,
  league_id: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ Schema.NullOr(Schema.String)),
  metadata: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ openStruct({ league_id: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ Schema.NullOr(Schema.String)) })),
  status, type: draftType,
  settings: /* @__PURE__ */ openStruct({ teams, rounds, pick_timer: timer }), draft_order: draftOrder,
});
const draftMetadataFields = {
  provider, draftId, providerKey: /* @__PURE__ */ boundedString(256),
  leagueId: /* @__PURE__ */ Schema.optional(Schema.String),
  leagueSettings: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ Schema.declare(isLeagueSettings)),
  status, type: draftType, draftOrder,
};
const draftSettingsFields = { teams, rounds, pickTimer: timer };
const draftMetadata = /* @__PURE__ */ openStruct({
  ...draftMetadataFields,
  settings: /* @__PURE__ */ openStruct(draftSettingsFields),
});
const sleeperDraftPick = /* @__PURE__ */ openStruct({
  round: rounds, roster_id: /* @__PURE__ */ Schema.NullOr(Schema.Finite), player_id: Schema.String,
  picked_by: Schema.String, pick_no: /* @__PURE__ */ integer(1, MAX_DRAFT_PICKS),
  metadata: /* @__PURE__ */ Schema.NullOr(/* @__PURE__ */ openStruct({ first_name: Schema.String, last_name: Schema.String, position: Schema.String, team: Schema.String, status: Schema.String })),
  is_keeper: /* @__PURE__ */ Schema.NullOr(Schema.Boolean), draft_slot: /* @__PURE__ */ integer(1, MAX_DRAFT_TEAMS), draft_id: Schema.String,
});
const sleeperDraftPickList = /* @__PURE__ */ Schema.Array(sleeperDraftPick).check(/* @__PURE__ */ Schema.makeFilter(value => value.length <= MAX_DRAFT_PICKS));
const draftPickEventFields = {
  draftId, pickNumber: /* @__PURE__ */ integer(1, MAX_DRAFT_PICKS), round: rounds,
  rosterId: /* @__PURE__ */ Schema.NullOr(Schema.Finite), draftSlot: /* @__PURE__ */ integer(1, MAX_DRAFT_TEAMS),
  teamIndex: /* @__PURE__ */ integer(0, MAX_DRAFT_TEAMS - 1), playerId: draftId,
  playerName: /* @__PURE__ */ boundedString(256), position: /* @__PURE__ */ Schema.NullOr(/* @__PURE__ */ Schema.Literals(POSITIONS)),
  nflTeam: /* @__PURE__ */ Schema.NullOr(Schema.String), isKeeper: Schema.Boolean,
  source: /* @__PURE__ */ Schema.Literals(['sleeper-api', 'yahoo-public', 'espn-extension', 'extension-dom', 'manual']),
  confidence: /* @__PURE__ */ Schema.Literals(['confirmed', 'probable']), observedAt: Schema.Finite,
};
const draftPickEvent = /* @__PURE__ */ openStruct(draftPickEventFields);
const providerDraftSnapshot = /* @__PURE__ */ openStruct({
  draft: draftMetadata, picks: /* @__PURE__ */ Schema.Array(draftPickEvent),
});
export const decodeProviderDraftSnapshot: (value: unknown) => {
  readonly draft: DraftMetadata; readonly picks: readonly DraftPickEvent[];
} = /* @__PURE__ */ Schema.decodeUnknownSync(providerDraftSnapshot);
const espnDraftSnapshot = /* @__PURE__ */ Schema.Struct({
  draft: /* @__PURE__ */ Schema.Struct({ ...draftMetadataFields, settings: /* @__PURE__ */ Schema.Struct(draftSettingsFields) }),
  picks: /* @__PURE__ */ Schema.Array(/* @__PURE__ */ Schema.Struct(draftPickEventFields)), observedAt: Schema.Finite,
  myDraftSlot: /* @__PURE__ */ Schema.optional(/* @__PURE__ */ integer(1, MAX_DRAFT_TEAMS)),
}).check(/* @__PURE__ */ Schema.makeFilter(value => {
  const { draft, picks } = value;
  const maximum = draft.settings.teams * draft.settings.rounds;
  return draft.provider === 'espn' && picks.length <= maximum &&
    (value.myDraftSlot === undefined || value.myDraftSlot <= draft.settings.teams) &&
    picks.every(pick => pick.draftId === draft.draftId && pick.source === 'espn-extension' &&
      pick.pickNumber <= maximum && pick.round <= draft.settings.rounds &&
      pick.draftSlot <= draft.settings.teams && pick.teamIndex < draft.settings.teams);
}));
const draftSyncSnapshot = /* @__PURE__ */ openStruct({
  provider, draftId, draft: /* @__PURE__ */ Schema.NullOr(draftMetadata),
  picks: /* @__PURE__ */ Schema.Array(draftPickEvent).check(/* @__PURE__ */ Schema.makeFilter(value => value.length <= MAX_DRAFT_PICKS)),
  status: syncState, lastPolledAt: /* @__PURE__ */ Schema.NullOr(Schema.Finite),
  lastSuccessfulSyncAt: /* @__PURE__ */ Schema.NullOr(Schema.Finite), lastError: /* @__PURE__ */ Schema.NullOr(Schema.String),
}).check(/* @__PURE__ */ Schema.makeFilter(value =>
  (value.draft === null || value.draft.provider === value.provider && value.draft.draftId === value.draftId) &&
  value.picks.every(pick => pick.draftId === value.draftId)
));
const draftSyncUpdate = /* @__PURE__ */ Schema.Union([
  /* @__PURE__ */ openStruct({
    type: /* @__PURE__ */ Schema.Literals(['snapshot', 'pick', 'status']), snapshot: draftSyncSnapshot,
    pick: /* @__PURE__ */ Schema.optional(draftPickEvent),
  }).check(/* @__PURE__ */ Schema.makeFilter(value => value.pick === undefined || value.pick.draftId === value.snapshot.draftId)),
  /* @__PURE__ */ openStruct({ type: /* @__PURE__ */ Schema.Literal('heartbeat'), provider, draftId, lastPolledAt: Schema.Finite, lastSuccessfulSyncAt: Schema.Finite }),
]);
const draftSessionSummary = /* @__PURE__ */ openStruct({
  session: Schema.String, provider, draftId,
  draftStatus: /* @__PURE__ */ Schema.NullOr(status), draftType: /* @__PURE__ */ Schema.NullOr(draftType),
  totalTeams: /* @__PURE__ */ Schema.NullOr(teams), totalRounds: /* @__PURE__ */ Schema.NullOr(rounds),
  currentPick: /* @__PURE__ */ Schema.NullOr(/* @__PURE__ */ integer(1, MAX_DRAFT_PICKS + 1)),
  picksRecorded: /* @__PURE__ */ integer(0, MAX_DRAFT_PICKS),
  sync: /* @__PURE__ */ openStruct({ state: syncState, lastSuccessfulSyncAt: /* @__PURE__ */ Schema.NullOr(Schema.Finite), lastError: /* @__PURE__ */ Schema.NullOr(Schema.String) }),
  lastActivityAt: Schema.Finite, subscribers: /* @__PURE__ */ integer(0, 32),
}).check(/* @__PURE__ */ Schema.makeFilter(value => value.session === `${value.provider}:${value.draftId}`));
const draftSessionList = /* @__PURE__ */ openStruct({ sessions: /* @__PURE__ */ Schema.Array(draftSessionSummary).check(/* @__PURE__ */ Schema.makeFilter(value => value.length <= 128)) });

export const decodeDraftMetadata: (value: unknown) => DraftMetadata = /* @__PURE__ */ Schema.decodeUnknownSync(draftMetadata);
export const decodeSleeperDraftMetadata: (value: unknown) => SleeperDraftMetadata = /* @__PURE__ */ Schema.decodeUnknownSync(sleeperDraftMetadata);
export const decodeSleeperDraftPick: (value: unknown) => SleeperDraftPick = /* @__PURE__ */ Schema.decodeUnknownSync(sleeperDraftPick);
export const decodeSleeperDraftPickList: (value: unknown) => readonly SleeperDraftPick[] = /* @__PURE__ */ Schema.decodeUnknownSync(sleeperDraftPickList);
export const decodeEspnDraftSnapshot: (value: unknown) => EspnDraftSnapshot = /* @__PURE__ */ Schema.decodeUnknownSync(espnDraftSnapshot, { onExcessProperty: 'error' });
export const decodeDraftSyncSnapshot: (value: unknown) => DraftSyncSnapshot = /* @__PURE__ */ Schema.decodeUnknownSync(draftSyncSnapshot);
export const decodeDraftSyncUpdate: (value: unknown) => DraftSyncUpdate = /* @__PURE__ */ Schema.decodeUnknownSync(draftSyncUpdate);
export const decodeDraftSessionSummary: (value: unknown) => DraftSessionSummary = /* @__PURE__ */ Schema.decodeUnknownSync(draftSessionSummary);
export const decodeDraftSessionList: (value: unknown) => { readonly sessions: readonly DraftSessionSummary[] } = /* @__PURE__ */ Schema.decodeUnknownSync(draftSessionList);
export const isDraftMetadata: (value: unknown) => value is DraftMetadata = /* @__PURE__ */ Schema.is(draftMetadata);
export const isSleeperDraftMetadata: (value: unknown) => value is SleeperDraftMetadata = /* @__PURE__ */ Schema.is(sleeperDraftMetadata);
export const isSleeperDraftPick: (value: unknown) => value is SleeperDraftPick = /* @__PURE__ */ Schema.is(sleeperDraftPick);
export const isSleeperDraftPickList: (value: unknown) => value is readonly SleeperDraftPick[] = /* @__PURE__ */ Schema.is(sleeperDraftPickList);
export function isEspnDraftSnapshot(value: unknown): value is EspnDraftSnapshot {
  try { decodeEspnDraftSnapshot(value); return true; } catch { return false; }
}
export const isDraftSyncSnapshot: (value: unknown) => value is DraftSyncSnapshot = /* @__PURE__ */ Schema.is(draftSyncSnapshot);
export const isDraftSyncUpdate: (value: unknown) => value is DraftSyncUpdate = /* @__PURE__ */ Schema.is(draftSyncUpdate);
export const isDraftSessionSummary: (value: unknown) => value is DraftSessionSummary = /* @__PURE__ */ Schema.is(draftSessionSummary);

export type SleeperDraftPick = DataShape<typeof sleeperDraftPick.Type>;
export type SleeperDraftMetadata = Omit<DataShape<typeof sleeperDraftMetadata.Type>, 'metadata'> & Pick<typeof sleeperDraftMetadata.Type, 'metadata'>;
export type DraftMetadata = DataShape<typeof draftMetadata.Type>;
export type DraftPickEvent = DataShape<typeof draftPickEvent.Type>;
export type EspnDraftSnapshot = DataShape<typeof espnDraftSnapshot.Type>;
export type DraftSyncSnapshot = DataShape<typeof draftSyncSnapshot.Type>;
export type DraftSyncUpdate = DataShape<typeof draftSyncUpdate.Type>;
export type DraftSessionSummary = DataShape<typeof draftSessionSummary.Type>;
