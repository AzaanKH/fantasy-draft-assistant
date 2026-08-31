import type { NewsStatus, NFLTeam, Position } from './player';
import type { ECRPlayer } from './scrapers';

export const FANTASYPROS_SNAPSHOT_SOURCES = [
  'manual-refresh',
  'fixture',
  'api',
] as const;

export type FantasyProsSnapshotSource = (typeof FANTASYPROS_SNAPSHOT_SOURCES)[number];

export interface FantasyProsProjection {
  readonly fantasyProsId?: string;
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
  readonly projectedPoints: number;
  /** FantasyPros PPR total before this league's scoring bonuses. */
  readonly baseProjectedPoints?: number;
  /** Projected rushing attempts used for the league's +0.20/attempt bonus. */
  readonly projectedRushAttempts?: number;
  /** Projected receptions used for the league's TE +0.50/reception premium. */
  readonly projectedReceptions?: number;
  readonly projectedPassingYards?: number;
  readonly projectedPassingTouchdowns?: number;
  readonly projectedRushingYards?: number;
  readonly projectedRushingTouchdowns?: number;
  readonly projectedReceivingYards?: number;
  readonly projectedReceivingTouchdowns?: number;
  /** @deprecated Legacy cached adjustment. League scoring is now calculated locally. */
  readonly customScoringAdjustment?: number;
  /** @deprecated Legacy cached total. Consumers should locally re-score projectedPoints. */
  readonly leagueProjectedPoints?: number;
  readonly ceilingPoints?: number;
  readonly floorPoints?: number;
}

export interface FantasyProsNewsItem {
  readonly fantasyProsId?: string;
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
  readonly status: NewsStatus;
  readonly headline: string;
  readonly categories?: readonly string[];
  readonly description?: string;
  readonly impact?: string;
  readonly link?: string;
  readonly updatedAt?: string;
}

export interface FantasyProsAdpPlayer {
  readonly fantasyProsId?: string;
  readonly rank: number;
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
  readonly positionalRank: number;
  readonly bestRank: number;
  readonly worstRank: number;
  readonly averageRank: number;
}

export interface FantasyProsSnapshotMetadata {
  readonly season: number;
  readonly sourceType: FantasyProsSnapshotSource;
  readonly source: string;
  readonly refreshedAt: string;
  readonly projectionRefreshedAt?: string;
  readonly projectionSource?: 'api' | 'preserved-cache';
  readonly rankingCount: number;
  readonly adpCount: number;
  readonly projectionCount: number;
  readonly newsCount: number;
}

export interface FantasyProsSnapshot {
  readonly metadata: FantasyProsSnapshotMetadata;
  readonly rankings: readonly ECRPlayer[];
  readonly adp: readonly FantasyProsAdpPlayer[];
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
