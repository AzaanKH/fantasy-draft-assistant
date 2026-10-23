export interface KeeperPreloadStatus {
  readonly season?: number;
  readonly confirmedAt: string | null;
  readonly configuredCount: number;
  readonly resolvedCount: number;
  readonly canonicalCount: number;
  readonly unresolvedNames: readonly string[];
  /** Keeper entries that resolved to a player already kept by another entry. */
  readonly duplicateNames: readonly string[];
  /** Keeper entries with an illegal team/round or a team/round collision. */
  readonly invalidAssignments: readonly string[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly isInitialized: boolean;
  readonly isConfirmed: boolean;
  readonly isMockReady: boolean;
  readonly error: Error | null;
}
