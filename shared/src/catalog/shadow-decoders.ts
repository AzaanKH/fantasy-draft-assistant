import type { DataShape } from './data-shape.js';
import { Schema } from 'effect';
import { POSITIONS } from '../player.js';

function openStruct<const Fields extends Schema.Struct.Fields>(fields: Fields) {
  return /* @__PURE__ */ Schema.StructWithRest(/* @__PURE__ */ Schema.Struct(fields), [/* @__PURE__ */ Schema.Record(Schema.String, Schema.Unknown)]);
}
function boundedString(maximum: number) {
  return /* @__PURE__ */ Schema.String.check(/* @__PURE__ */ Schema.makeFilter(value => value.length > 0 && value.length <= maximum));
}
function integer(minimum: number, maximum: number) {
  return /* @__PURE__ */ Schema.Finite.check(/* @__PURE__ */ Schema.makeFilter(value => Number.isInteger(value) && value >= minimum && value <= maximum));
}
const timestamp = /* @__PURE__ */ boundedString(64).check(/* @__PURE__ */ Schema.makeFilter(value => !Number.isNaN(Date.parse(value))));
const position = /* @__PURE__ */ Schema.Literals(POSITIONS);
const recommendation = /* @__PURE__ */ openStruct({ playerId: /* @__PURE__ */ boundedString(128), playerName: /* @__PURE__ */ boundedString(128), position, score: Schema.Finite });
const recommendations = /* @__PURE__ */ Schema.Array(recommendation).check(/* @__PURE__ */ Schema.makeFilter(value => value.length >= 1 && value.length <= 5));
function stringList(maximum: number) {
  return /* @__PURE__ */ Schema.Array(/* @__PURE__ */ boundedString(128)).check(/* @__PURE__ */ Schema.makeFilter(value => value.length <= maximum));
}
const shadowRecommendationEvent = /* @__PURE__ */ openStruct({
  eventId: /* @__PURE__ */ boundedString(256), season: /* @__PURE__ */ integer(-Number.MAX_VALUE, Number.MAX_VALUE),
  draftId: /* @__PURE__ */ boundedString(128), pickNumber: /* @__PURE__ */ integer(1, Number.MAX_VALUE), observedAt: timestamp,
  experiment: /* @__PURE__ */ openStruct({ sourceLabel: /* @__PURE__ */ Schema.Literal('Experimental prediction artifact'), modelVersion: /* @__PURE__ */ boundedString(128), generatedAt: timestamp, freshness: /* @__PURE__ */ Schema.Literal('ready') }),
  coreDecision: /* @__PURE__ */ openStruct({ ecrAnchor: /* @__PURE__ */ Schema.Literal('FantasyPros ECR'), policy: /* @__PURE__ */ boundedString(64), bestPick: recommendation, bestPlayer: recommendation, recommendations }),
  shadowRecommendations: recommendations, disagreement: Schema.Boolean,
  context: /* @__PURE__ */ openStruct({
    draftProvider: /* @__PURE__ */ Schema.Literals(['sleeper', 'yahoo', 'espn']), leagueSettingsFingerprint: /* @__PURE__ */ boundedString(256),
    totalTeams: /* @__PURE__ */ integer(2, 32), totalRounds: /* @__PURE__ */ integer(1, 30), myPickPosition: /* @__PURE__ */ integer(1, 32),
    draftedPlayerIds: /* @__PURE__ */ stringList(300), rosterPlayerIds: /* @__PURE__ */ stringList(30),
    positionNeeds: /* @__PURE__ */ Schema.Array(/* @__PURE__ */ openStruct({ position, priority: /* @__PURE__ */ Schema.Literals(['critical', 'high', 'medium', 'low', 'defer', 'filled']) })).check(/* @__PURE__ */ Schema.makeFilter(value => value.length <= 6)),
  }).check(/* @__PURE__ */ Schema.makeFilter(value => value.myPickPosition <= value.totalTeams)),
});
export const decodeShadowRecommendationEvent: (value: unknown) => ShadowRecommendationEvent = /* @__PURE__ */ Schema.decodeUnknownSync(shadowRecommendationEvent);
export const isShadowRecommendationEvent: (value: unknown) => value is ShadowRecommendationEvent = /* @__PURE__ */ Schema.is(shadowRecommendationEvent);

export type ShadowRecommendationEvent = DataShape<typeof shadowRecommendationEvent.Type>;
export type ShadowRecommendation = DataShape<typeof recommendation.Type>;
