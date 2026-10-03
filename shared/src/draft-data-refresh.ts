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

export type DraftDataRefreshStepKey = (typeof DRAFT_DATA_REFRESH_STEPS)[number]['key'];
export type DraftDataRefreshState = 'idle' | 'running' | 'succeeded' | 'failed';
export type DraftDataRefreshStepState = 'pending' | 'running' | 'succeeded' | 'failed';

export interface DraftDataRefreshStepStatus {
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

const REFRESH_STATES = new Set<string>(['idle', 'running', 'succeeded', 'failed']);
const STEP_STATES = new Set<string>(['pending', 'running', 'succeeded', 'failed']);
const STEP_KEYS = new Set<string>(DRAFT_DATA_REFRESH_STEPS.map((step) => step.key));

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function isDraftDataRefreshStatus(value: unknown): value is DraftDataRefreshStatus {
  if (typeof value !== 'object' || value === null) return false;
  const status = value as Record<string, unknown>;
  return typeof status['state'] === 'string' &&
    REFRESH_STATES.has(status['state']) &&
    Array.isArray(status['steps']) &&
    status['steps'].every((step: unknown) => {
      if (typeof step !== 'object' || step === null) return false;
      const entry = step as Record<string, unknown>;
      return typeof entry['key'] === 'string' && STEP_KEYS.has(entry['key']) &&
        typeof entry['label'] === 'string' &&
        typeof entry['state'] === 'string' && STEP_STATES.has(entry['state']);
    }) &&
    isNullableString(status['startedAt']) &&
    isNullableString(status['finishedAt']) &&
    isNullableString(status['error']) &&
    isNullableString(status['detail']);
}
