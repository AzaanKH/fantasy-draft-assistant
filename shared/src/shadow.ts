import { isNeedPriority, type NeedPriority } from './draft';
import { isPosition, type Position } from './player';
import { isDraftProvider, type DraftProvider } from './sync';

export interface ShadowRecommendation {
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly score: number;
}

export interface ShadowPositionNeed {
  readonly position: Position;
  readonly priority: NeedPriority;
}

export interface ShadowRecommendationEvent {
  readonly eventId: string;
  readonly season: number;
  readonly draftId: string;
  readonly pickNumber: number;
  readonly observedAt: string;
  readonly experiment: {
    readonly sourceLabel: 'Experimental prediction artifact';
    readonly modelVersion: string;
    readonly generatedAt: string;
    readonly freshness: 'ready';
  };
  readonly coreDecision: {
    readonly ecrAnchor: 'FantasyPros ECR';
    readonly policy: string;
    readonly bestPick: ShadowRecommendation;
    readonly bestPlayer: ShadowRecommendation;
    readonly recommendations: readonly ShadowRecommendation[];
  };
  readonly shadowRecommendations: readonly ShadowRecommendation[];
  readonly disagreement: boolean;
  readonly context: {
    readonly draftProvider: DraftProvider;
    readonly leagueSettingsFingerprint: string;
    readonly totalTeams: number;
    readonly totalRounds: number;
    readonly myPickPosition: number;
    readonly draftedPlayerIds: readonly string[];
    readonly rosterPlayerIds: readonly string[];
    readonly positionNeeds: readonly ShadowPositionNeed[];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength;
}

function isIsoTimestamp(value: unknown): value is string {
  return isBoundedString(value, 64) && !Number.isNaN(Date.parse(value));
}

function isStringList(value: unknown, maximumItems: number): value is string[] {
  return Array.isArray(value) && value.length <= maximumItems &&
    value.every((item) => isBoundedString(item, 128));
}

function isShadowRecommendation(value: unknown): value is ShadowRecommendation {
  return (
    isRecord(value) &&
    isBoundedString(value['playerId'], 128) &&
    isBoundedString(value['playerName'], 128) &&
    isPosition(value['position']) &&
    isFiniteNumber(value['score'])
  );
}

function isRecommendationList(value: unknown): value is ShadowRecommendation[] {
  return Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 5 &&
    value.every(isShadowRecommendation);
}

function isShadowPositionNeed(value: unknown): value is ShadowPositionNeed {
  return (
    isRecord(value) &&
    isPosition(value['position']) &&
    isNeedPriority(value['priority'])
  );
}

export function isShadowRecommendationEvent(value: unknown): value is ShadowRecommendationEvent {
  if (
    !isRecord(value) ||
    !isRecord(value['experiment']) ||
    !isRecord(value['coreDecision']) ||
    !isRecord(value['context'])
  ) {
    return false;
  }

  const experiment = value['experiment'];
  const coreDecision = value['coreDecision'];
  const context = value['context'];
  const positionNeeds = context['positionNeeds'];

  return (
    isBoundedString(value['eventId'], 256) &&
    Number.isInteger(value['season']) &&
    isFiniteNumber(value['season']) &&
    isBoundedString(value['draftId'], 128) &&
    Number.isInteger(value['pickNumber']) &&
    isFiniteNumber(value['pickNumber']) &&
    value['pickNumber'] >= 1 &&
    isIsoTimestamp(value['observedAt']) &&
    experiment['sourceLabel'] === 'Experimental prediction artifact' &&
    isBoundedString(experiment['modelVersion'], 128) &&
    isIsoTimestamp(experiment['generatedAt']) &&
    experiment['freshness'] === 'ready' &&
    coreDecision['ecrAnchor'] === 'FantasyPros ECR' &&
    isBoundedString(coreDecision['policy'], 64) &&
    isShadowRecommendation(coreDecision['bestPick']) &&
    isShadowRecommendation(coreDecision['bestPlayer']) &&
    isRecommendationList(coreDecision['recommendations']) &&
    isRecommendationList(value['shadowRecommendations']) &&
    typeof value['disagreement'] === 'boolean' &&
    isDraftProvider(context['draftProvider']) &&
    isBoundedString(context['leagueSettingsFingerprint'], 256) &&
    Number.isInteger(context['totalTeams']) &&
    isFiniteNumber(context['totalTeams']) &&
    context['totalTeams'] >= 2 &&
    context['totalTeams'] <= 32 &&
    Number.isInteger(context['totalRounds']) &&
    isFiniteNumber(context['totalRounds']) &&
    context['totalRounds'] >= 1 &&
    context['totalRounds'] <= 30 &&
    Number.isInteger(context['myPickPosition']) &&
    isFiniteNumber(context['myPickPosition']) &&
    context['myPickPosition'] >= 1 &&
    context['myPickPosition'] <= context['totalTeams'] &&
    isStringList(context['draftedPlayerIds'], 300) &&
    isStringList(context['rosterPlayerIds'], 30) &&
    Array.isArray(positionNeeds) &&
    positionNeeds.length <= 6 &&
    positionNeeds.every(isShadowPositionNeed)
  );
}
