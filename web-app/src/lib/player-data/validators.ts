import type { PlayerIdentityData } from '@/lib/calculations/player-value';
import { isNFLTeam, isPosition, isPredictionSource } from '@fantasy-draft/shared';

import type {
  ContractDataFile,
  PlayerIdentityFile,
  PredictionsDataFile,
  RecommendationPolicyFile,
} from './types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isContractDataFile(value: unknown): value is ContractDataFile {
  return (
    isRecord(value) &&
    (value['generatedAt'] === undefined ||
      value['generatedAt'] === null ||
      typeof value['generatedAt'] === 'string') &&
    (value['scrapedAt'] === undefined ||
      value['scrapedAt'] === null ||
      typeof value['scrapedAt'] === 'string') &&
    typeof value['contractYear'] === 'number' &&
    Number.isFinite(value['contractYear']) &&
    typeof value['playerCount'] === 'number' &&
    Number.isFinite(value['playerCount']) &&
    Array.isArray(value['players']) &&
    value['players'].every((player) =>
      isRecord(player) &&
      typeof player['name'] === 'string' &&
      isPosition(player['position']) &&
      isNFLTeam(player['team']) &&
      typeof player['contractEndYear'] === 'number' &&
      Number.isFinite(player['contractEndYear']) &&
      typeof player['isContractYear'] === 'boolean'
    )
  );
}

export function isPredictionsDataFile(value: unknown): value is PredictionsDataFile {
  return (
    isRecord(value) &&
    (value['generatedAt'] === null || typeof value['generatedAt'] === 'string') &&
    typeof value['modelVersion'] === 'string' &&
    value['modelVersion'].length > 0 &&
    Array.isArray(value['players']) &&
    value['players'].every((player) =>
      isRecord(player) &&
      typeof player['name'] === 'string' &&
      isPosition(player['position']) &&
      isNFLTeam(player['team']) &&
      typeof player['projectedPoints'] === 'number' &&
      Number.isFinite(player['projectedPoints']) &&
      isPredictionSource(player['source'])
    )
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isPlayerIdentity(value: unknown): value is PlayerIdentityData {
  return isRecord(value) &&
    isNonEmptyString(value['canonicalId']) &&
    isNonEmptyString(value['name']) &&
    (value['sleeperId'] === undefined || isNonEmptyString(value['sleeperId'])) &&
    (value['fantasyProsId'] === undefined || isNonEmptyString(value['fantasyProsId'])) &&
    Array.isArray(value['aliases']) &&
    value['aliases'].every(isNonEmptyString) &&
    isPosition(value['position']) &&
    isNFLTeam(value['team']);
}

export function isPlayerIdentityFile(value: unknown): value is PlayerIdentityFile {
  return (
    isRecord(value) &&
    typeof value['generatedAt'] === 'string' &&
    typeof value['season'] === 'number' &&
    Number.isFinite(value['season']) &&
    isRecord(value['coverage']) &&
    typeof value['coverage']['fantasyProsRankingMatchRate'] === 'number' &&
    Number.isFinite(value['coverage']['fantasyProsRankingMatchRate']) &&
    typeof value['coverage']['matchedDefenses'] === 'number' &&
    Number.isFinite(value['coverage']['matchedDefenses']) &&
    Array.isArray(value['players']) &&
    value['players'].every(isPlayerIdentity)
  );
}

export function isRecommendationPolicyFile(value: unknown): value is RecommendationPolicyFile {
  return (
    isRecord(value) &&
    typeof value['generatedAt'] === 'string' &&
    typeof value['modelVersion'] === 'string' &&
    typeof value['modelPredictionsEnabled'] === 'boolean' &&
    typeof value['contractSignalEnabled'] === 'boolean' &&
    typeof value['pickEvOverrideEnabled'] === 'boolean' &&
    typeof value['pickEvOverrideThreshold'] === 'number' &&
    Number.isFinite(value['pickEvOverrideThreshold']) &&
    (value['fallback'] === 'model' || value['fallback'] === 'fantasypros-ecr-market') &&
    isRecord(value['shadowLogging']) &&
    typeof value['shadowLogging']['enabled'] === 'boolean' &&
    typeof value['shadowLogging']['season'] === 'number' &&
    Number.isFinite(value['shadowLogging']['season']) &&
    typeof value['shadowLogging']['endpoint'] === 'string' &&
    typeof value['reason'] === 'string'
  );
}

