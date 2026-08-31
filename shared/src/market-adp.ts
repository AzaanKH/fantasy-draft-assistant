import { isNFLTeam, isPosition, type NFLTeam, type Position } from './player';

export type MarketAdpFormat = 'standard' | 'half-ppr' | 'ppr';

export interface MarketAdpPlayer {
  readonly externalId: string;
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam | null;
  readonly adp: number;
}

export interface MarketAdpSnapshot {
  readonly source: 'fantasy-football-calculator';
  readonly format: MarketAdpFormat;
  readonly teams: number;
  readonly season: number;
  readonly refreshedAt: string;
  readonly draftCount: number | null;
  readonly players: readonly MarketAdpPlayer[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isMarketAdpFormat(value: unknown): value is MarketAdpFormat {
  return value === 'standard' || value === 'half-ppr' || value === 'ppr';
}

function isMarketAdpPlayer(value: unknown): value is MarketAdpPlayer {
  return (
    isRecord(value) &&
    typeof value['externalId'] === 'string' &&
    typeof value['name'] === 'string' &&
    isPosition(value['position']) &&
    (value['team'] === null || isNFLTeam(value['team'])) &&
    isFiniteNumber(value['adp']) &&
    value['adp'] > 0
  );
}

export function isMarketAdpSnapshot(value: unknown): value is MarketAdpSnapshot {
  return (
    isRecord(value) &&
    value['source'] === 'fantasy-football-calculator' &&
    isMarketAdpFormat(value['format']) &&
    isFiniteNumber(value['teams']) &&
    isFiniteNumber(value['season']) &&
    typeof value['refreshedAt'] === 'string' &&
    (value['draftCount'] === null || isFiniteNumber(value['draftCount'])) &&
    Array.isArray(value['players']) &&
    value['players'].every(isMarketAdpPlayer)
  );
}
