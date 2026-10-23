import type { CoreDraftDataKey } from './draft-readiness.js';

/** The live preflight refresh, in dependency order: identities need fresh rankings and the Sleeper directory. */
export const DRAFT_DATA_REFRESH_STEPS = [
  { key: 'sleeper-directory', label: 'Sleeper player directory', script: 'refresh:sleeper' },
  { key: 'fantasypros-rankings', label: 'FantasyPros rankings', script: 'refresh:fantasypros' },
  { key: 'player-identities', label: 'Canonical player identities', script: 'data:identity' },
] as const;

/** Core Draft Data the refresh can repair. League settings and keepers need the user. */
export const REFRESHABLE_CORE_DRAFT_DATA_KEYS: readonly CoreDraftDataKey[] = [
  'trusted-rankings',
  'canonical-player-identities',
];

type DraftDataRefreshStepKey = (typeof DRAFT_DATA_REFRESH_STEPS)[number]['key'];
export type DraftDataRefreshState = 'idle' | 'running' | 'succeeded' | 'failed';
export type DraftDataRefreshStepState = 'pending' | 'running' | 'succeeded' | 'failed';

interface DraftDataRefreshStepStatus {
  readonly key: DraftDataRefreshStepKey;
  readonly label: string;
  readonly state: DraftDataRefreshStepState;
}

export interface DraftDataRefreshStatus {
  readonly state: DraftDataRefreshState;
  readonly steps: readonly DraftDataRefreshStepStatus[];
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  /** Plain-language failure, such as which step failed. */
  readonly error: string | null;
  /** The last lines the failed step printed, to explain the failure. */
  readonly detail: string | null;
}
