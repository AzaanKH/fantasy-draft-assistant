import { Schema } from 'effect';
import { decodeDraftSyncSnapshot, decodeEspnDraftSnapshot } from '@fantasy-draft/shared/catalog';

function openStruct<const Fields extends Schema.Struct.Fields>(fields: Fields) {
  return Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)]);
}

function boundarySchema<A>(decode: (value: unknown) => A): Schema.declare<A> {
  return Schema.declare((value): value is A => {
    try { decode(value); return true; } catch { return false; }
  });
}

const detectedPick = openStruct({
  playerName: Schema.String,
  teamName: Schema.String,
  position: Schema.optional(Schema.String),
  /** Pick number in round.pick format, such as 1.5 for round 1, pick 5. */
  pickNumber: Schema.optional(Schema.String),
  timestamp: Schema.Finite,
});
const positiveInteger = Schema.Finite.check(Schema.makeFilter(value => Number.isInteger(value) && value >= 1));
const draftRoomStatus = openStruct({
  isInDraftRoom: Schema.Boolean,
  provider: Schema.optional(Schema.Literals(['sleeper', 'espn', 'yahoo'])),
  draftId: Schema.optional(Schema.String),
  myDraftSlot: Schema.optional(positiveInteger),
  status: Schema.optional(Schema.Literals(['pre_draft', 'drafting', 'paused', 'complete'])),
});
const extensionState = openStruct({
  picks: Schema.Array(detectedPick),
  status: draftRoomStatus,
  snapshot: Schema.optional(Schema.NullOr(boundarySchema(decodeDraftSyncSnapshot))),
});
const extensionMessage = Schema.Union([
  openStruct({ type: Schema.Literal('PICK_DETECTED'), data: detectedPick }),
  openStruct({ type: Schema.Literal('ESPN_DRAFT_SNAPSHOT'), data: boundarySchema(decodeEspnDraftSnapshot) }),
  openStruct({ type: Schema.Literal('DRAFT_ROOM_STATUS'), data: draftRoomStatus }),
  openStruct({ type: Schema.Literal('GET_DRAFT_STATUS') }),
  openStruct({ type: Schema.Literal('OPEN_SIDE_PANEL') }),
  openStruct({ type: Schema.Literal('SYNC_STATE'), data: extensionState }),
]);

type KnownFields<A> = { [K in keyof A as string extends K ? never : K]: A[K] };

type DataShape<A> = A extends readonly unknown[]
  ? { [K in keyof A]: DataShape<A[K]> }
  : A extends object
    ? keyof KnownFields<A> extends never ? A : { [K in keyof KnownFields<A>]: DataShape<KnownFields<A>[K]> }
    : A;

export type DetectedPick = DataShape<typeof detectedPick.Type>;
export type ExtensionState = DataShape<typeof extensionState.Type>;
export type ExtensionMessage = DataShape<typeof extensionMessage.Type>;

export const decodeDetectedPick = Schema.decodeUnknownSync(detectedPick);
export const decodeDetectedPicks = Schema.decodeUnknownSync(Schema.Array(detectedPick));
export const decodeDraftRoomStatus = Schema.decodeUnknownSync(draftRoomStatus);
export const decodeExtensionState = Schema.decodeUnknownSync(extensionState);
export const decodeExtensionMessage = Schema.decodeUnknownSync(extensionMessage);
export const decodeExtensionStateResponse = Schema.decodeUnknownSync(openStruct({ success: Schema.Literal(true), data: extensionState }));
export const decodeStoredString = Schema.decodeUnknownSync(Schema.String);
export const decodeStoredDraftSlot = Schema.decodeUnknownSync(positiveInteger);

export const decodeSyncToken = Schema.decodeUnknownSync(Schema.String.check(Schema.makeFilter(value => /^[A-Za-z0-9_-]{43,128}$/.test(value))));
