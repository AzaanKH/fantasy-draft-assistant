import { LIVE_RECOMMENDATION_ARCHITECTURE } from '../../recommendation-policy.js';
import { isNFLTeam, isPosition, NFL_TEAMS } from '../../player.js';
import { isTeamEnvironment } from '../../team-environment.js';
import type {
  ContractDataFile,
  RecommendationPolicyFile,
  TeamEnvDataFile,
} from './types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isTeamEnvDataFile(value: unknown): value is TeamEnvDataFile {
  if (!isRecord(value) ||
    typeof value['generatedAt'] !== 'string' ||
    !isFiniteNumber(value['season']) ||
    !isFiniteNumber(value['teamCount']) ||
    !isRecord(value['teams']) || Array.isArray(value['teams'])) {
    return false;
  }

  const teams = value['teams'];
  return value['teamCount'] === NFL_TEAMS.length &&
    NFL_TEAMS.every((team) => Object.hasOwn(teams, team)) &&
    Object.entries(teams).every(([team, environment]) =>
      isNFLTeam(team) &&
      isTeamEnvironment(environment) &&
      environment.team === team &&
      [environment.offenseScore, environment.pointsRank,
        environment.passAttemptsRank, environment.rushAttemptsRank].every(isFiniteNumber)
    );
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
    value['players'].every((player: unknown) =>
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

export function isRecommendationPolicyFile(value: unknown): value is RecommendationPolicyFile {
  return (
    isRecord(value) &&
    typeof value['generatedAt'] === 'string' &&
    value['recommendationArchitecture'] === LIVE_RECOMMENDATION_ARCHITECTURE &&
    typeof value['modelPredictionsEnabled'] === 'boolean' &&
    typeof value['contractSignalEnabled'] === 'boolean' &&
    (value['fallback'] === 'model' || value['fallback'] === 'fantasypros-ecr-market') &&
    isRecord(value['shadowLogging']) &&
    typeof value['shadowLogging']['enabled'] === 'boolean' &&
    typeof value['shadowLogging']['season'] === 'number' &&
    Number.isFinite(value['shadowLogging']['season']) &&
    typeof value['shadowLogging']['endpoint'] === 'string' &&
    typeof value['reason'] === 'string'
  );
}
