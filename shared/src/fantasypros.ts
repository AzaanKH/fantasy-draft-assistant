import type { NewsStatus, NFLTeam, Position } from './player';
import type { ECRPlayer } from './scrapers';

export const FANTASYPROS_SNAPSHOT_SOURCES = [
  'manual-refresh',
  'fixture',
  'api',
] as const;

export type FantasyProsSnapshotSource = (typeof FANTASYPROS_SNAPSHOT_SOURCES)[number];

export interface FantasyProsProjection {
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
  readonly projectedPoints: number;
  readonly ceilingPoints?: number;
  readonly floorPoints?: number;
}

export interface FantasyProsNewsItem {
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
  readonly status: NewsStatus;
  readonly headline: string;
  readonly updatedAt: string;
}

export interface FantasyProsSnapshotMetadata {
  readonly season: number;
  readonly sourceType: FantasyProsSnapshotSource;
  readonly source: string;
  readonly refreshedAt: string;
  readonly rankingCount: number;
  readonly projectionCount: number;
  readonly newsCount: number;
}

export interface FantasyProsSnapshot {
  readonly metadata: FantasyProsSnapshotMetadata;
  readonly rankings: readonly ECRPlayer[];
  readonly projections: readonly FantasyProsProjection[];
  readonly news: readonly FantasyProsNewsItem[];
}

export function isFantasyProsSnapshotSource(
  value: unknown
): value is FantasyProsSnapshotSource {
  return (
    typeof value === 'string' &&
    FANTASYPROS_SNAPSHOT_SOURCES.includes(value as FantasyProsSnapshotSource)
  );
}

