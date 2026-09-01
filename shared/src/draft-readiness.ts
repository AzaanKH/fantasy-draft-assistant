export const CORE_DRAFT_DATA_KEYS = [
  'trusted-rankings',
  'canonical-player-identities',
  'primary-league-settings',
  'confirmed-keeper-supply',
] as const;

export const OPTIONAL_SIGNAL_KEYS = [
  'experimental-predictions',
  'contract-context',
  'sportsbook-context',
] as const;

export type CoreDraftDataKey = (typeof CORE_DRAFT_DATA_KEYS)[number];
export type OptionalSignalKey = (typeof OPTIONAL_SIGNAL_KEYS)[number];
export type DraftReadinessKey = CoreDraftDataKey | OptionalSignalKey;
export type DraftReadinessClassification = 'core-draft-data' | 'optional-signal';
export type DraftReadinessAvailability = 'available' | 'missing' | 'invalid';
export type DraftReadinessProblem =
  | 'missing'
  | 'invalid'
  | 'stale'
  | 'older-than-dependency';
export type DraftReadinessItemStatus = 'ready' | 'blocking' | 'degraded';

export interface DraftReadinessDefinition {
  readonly key: DraftReadinessKey;
  readonly label: string;
  readonly classification: DraftReadinessClassification;
  readonly sourceLabel: string;
  readonly timestampLabel: string;
  /** Null for season-scoped confirmations that do not expire with wall-clock age. */
  readonly maxAgeHours: number | null;
  readonly correctiveAction: string;
}

export interface DraftReadinessDependencyObservation {
  readonly key: string;
  readonly label: string;
  readonly timestamp: string | null | undefined;
}

export interface DraftReadinessSourceObservation {
  readonly availability: DraftReadinessAvailability;
  readonly timestamp: string | null | undefined;
  readonly detail?: string;
  readonly dependencies?: readonly DraftReadinessDependencyObservation[];
}

export interface DraftReadinessWarningInput {
  readonly key: string;
  readonly label: string;
  readonly sourceLabel: string;
  readonly message: string;
  readonly correctiveAction?: string;
  readonly timestamp?: string | null;
}

export interface DraftReadinessWarning extends DraftReadinessWarningInput {
  readonly status: 'warning';
}

export interface DraftReadinessItem extends DraftReadinessDefinition {
  readonly status: DraftReadinessItemStatus;
  readonly problem: DraftReadinessProblem | null;
  readonly timestamp: string | null;
  readonly ageHours: number | null;
  readonly message: string;
}

export interface DraftReadinessReport {
  readonly generatedAt: string;
  readonly status: 'ready' | 'blocked';
  readonly summary: {
    readonly productBlockingFailures: number;
    readonly actionableWarnings: number;
    readonly optionalSignalDegradations: number;
  };
  readonly coreDraftData: readonly DraftReadinessItem[];
  readonly optionalSignals: readonly DraftReadinessItem[];
  readonly productBlockingFailures: readonly DraftReadinessItem[];
  readonly actionableWarnings: readonly DraftReadinessWarning[];
  readonly optionalSignalDegradations: readonly DraftReadinessItem[];
  readonly engineeringChecks: {
    readonly status: 'not-run';
    readonly message: string;
    readonly commands: readonly ['pnpm typecheck', 'pnpm lint', 'pnpm test', 'pnpm build'];
  };
}

export interface EvaluateDraftReadinessInput {
  readonly sources: Readonly<Partial<Record<DraftReadinessKey, DraftReadinessSourceObservation>>>;
  readonly warnings?: readonly DraftReadinessWarningInput[];
}

const CORE_DEFINITIONS = [
  {
    key: 'trusted-rankings',
    label: 'Trusted rankings',
    classification: 'core-draft-data',
    sourceLabel: 'FantasyPros ECR',
    timestampLabel: 'refreshed at',
    maxAgeHours: 24,
    correctiveAction: 'Run `pnpm refresh:fantasypros`.',
  },
  {
    key: 'canonical-player-identities',
    label: 'Canonical player identities',
    classification: 'core-draft-data',
    sourceLabel: 'Generated player identity map',
    timestampLabel: 'generated at',
    maxAgeHours: 24,
    correctiveAction: 'Run `pnpm data:identity` after refreshing rankings and the Sleeper player directory.',
  },
  {
    key: 'primary-league-settings',
    label: 'Primary League settings',
    classification: 'core-draft-data',
    sourceLabel: 'Primary League provider settings',
    timestampLabel: 'confirmed at',
    maxAgeHours: null,
    correctiveAction: 'Reconnect the Primary League draft and confirm its scoring and roster settings.',
  },
  {
    key: 'confirmed-keeper-supply',
    label: 'Confirmed keeper supply',
    classification: 'core-draft-data',
    sourceLabel: 'Primary League keeper file',
    timestampLabel: 'confirmed at',
    maxAgeHours: null,
    correctiveAction: 'Confirm the complete current-season keeper list in `data/league-history/current-keepers.json`.',
  },
] as const satisfies readonly DraftReadinessDefinition[];

const OPTIONAL_DEFINITIONS = [
  {
    key: 'experimental-predictions',
    label: 'Experimental predictions',
    classification: 'optional-signal',
    sourceLabel: 'Experimental prediction artifact',
    timestampLabel: 'generated at',
    maxAgeHours: 24 * 7,
    correctiveAction: 'Run `pnpm model:dataset` to rebuild the experimental prediction artifact.',
  },
  {
    key: 'contract-context',
    label: 'Contract context',
    classification: 'optional-signal',
    sourceLabel: 'nflverse contract context',
    timestampLabel: 'generated at',
    maxAgeHours: 24 * 7,
    correctiveAction: 'Run `pnpm refresh:contracts`.',
  },
  {
    key: 'sportsbook-context',
    label: 'Sportsbook context',
    classification: 'optional-signal',
    sourceLabel: 'Imported sportsbook snapshot',
    timestampLabel: 'captured at',
    maxAgeHours: 48,
    correctiveAction: 'Run `pnpm import:sportsbook` after replacing the source exports.',
  },
] as const satisfies readonly DraftReadinessDefinition[];

export const DRAFT_READINESS_DEFINITIONS: readonly DraftReadinessDefinition[] = [
  ...CORE_DEFINITIONS,
  ...OPTIONAL_DEFINITIONS,
];

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatDraftReadinessTimestamp(
  timestamp: string | null | undefined
): string {
  const parsed = parseTimestamp(timestamp);
  return parsed === null ? 'unavailable' : new Date(parsed).toISOString();
}

export function formatDraftReadinessAge(ageHours: number | null): string {
  if (ageHours === null) return 'unknown age';
  if (ageHours < 1) return 'less than 1 hour old';
  if (ageHours < 48) return `${String(Math.floor(ageHours))} hours old`;
  return `${String(Math.floor(ageHours / 24))} days old`;
}

function getProblem(
  definition: DraftReadinessDefinition,
  observation: DraftReadinessSourceObservation | undefined,
  now: number
): {
  readonly problem: DraftReadinessProblem | null;
  readonly timestamp: string | null;
  readonly ageHours: number | null;
  readonly dependency?: DraftReadinessDependencyObservation;
} {
  if (!observation || observation.availability === 'missing') {
    return { problem: 'missing', timestamp: null, ageHours: null };
  }

  const timestampMs = parseTimestamp(observation.timestamp);
  const timestamp = timestampMs === null
    ? observation.timestamp ?? null
    : new Date(timestampMs).toISOString();
  if (observation.availability === 'invalid' || timestampMs === null) {
    return { problem: 'invalid', timestamp, ageHours: null };
  }

  const ageHours = (now - timestampMs) / 3_600_000;
  if (ageHours < -1 / 60) {
    return { problem: 'invalid', timestamp, ageHours };
  }

  for (const dependency of observation.dependencies ?? []) {
    const dependencyTimestampMs = parseTimestamp(dependency.timestamp);
    if (dependencyTimestampMs !== null && timestampMs < dependencyTimestampMs) {
      return {
        problem: 'older-than-dependency',
        timestamp,
        ageHours,
        dependency,
      };
    }
  }

  if (
    definition.maxAgeHours !== null &&
    ageHours > definition.maxAgeHours
  ) {
    return { problem: 'stale', timestamp, ageHours };
  }

  return { problem: null, timestamp, ageHours };
}

function createItem(
  definition: DraftReadinessDefinition,
  observation: DraftReadinessSourceObservation | undefined,
  now: number
): DraftReadinessItem {
  const result = getProblem(definition, observation, now);
  const status: DraftReadinessItemStatus = result.problem === null
    ? 'ready'
    : definition.classification === 'core-draft-data'
      ? 'blocking'
      : 'degraded';
  const detail = observation?.detail?.trim();
  const message = (() => {
    if (result.problem === null) {
      return `${definition.label} from ${definition.sourceLabel} is ready (${definition.timestampLabel} ${formatDraftReadinessTimestamp(result.timestamp)}).`;
    }
    if (result.problem === 'missing') {
      return `${definition.sourceLabel} is missing, so ${definition.label} is unavailable.${detail ? ` ${detail}` : ''}`;
    }
    if (result.problem === 'invalid') {
      const futureTimestamp = result.ageHours !== null && result.ageHours < 0;
      return futureTimestamp
        ? `${definition.sourceLabel} has a ${definition.timestampLabel} timestamp (${formatDraftReadinessTimestamp(result.timestamp)}) newer than the readiness clock (${new Date(now).toISOString()}), so ${definition.label} is invalid.${detail ? ` ${detail}` : ''}`
        : `${definition.sourceLabel} is invalid, so ${definition.label} is unavailable.${detail ? ` ${detail}` : ''}`;
    }
    if (result.problem === 'older-than-dependency' && result.dependency) {
      return `The ${definition.label.toLowerCase()} artifact (${formatDraftReadinessTimestamp(result.timestamp)}) is older than ${result.dependency.label} (${formatDraftReadinessTimestamp(result.dependency.timestamp)}); the ${result.dependency.label.toLowerCase()} dependency is newer and ${definition.label} must be refreshed.${detail ? ` ${detail}` : ''}`;
    }
    return `${definition.sourceLabel} is stale: ${formatDraftReadinessAge(result.ageHours)} exceeds the ${String(definition.maxAgeHours)}-hour live limit (${definition.timestampLabel} ${formatDraftReadinessTimestamp(result.timestamp)}), so ${definition.label} is unavailable.${detail ? ` ${detail}` : ''}`;
  })();

  return {
    ...definition,
    status,
    problem: result.problem,
    timestamp: result.timestamp,
    ageHours: result.ageHours === null ? null : Math.max(0, result.ageHours),
    message,
  };
}

export function evaluateDraftReadiness(
  input: EvaluateDraftReadinessInput,
  now: number = Date.now()
): DraftReadinessReport {
  if (!Number.isFinite(now)) {
    throw new Error('Draft Readiness requires a finite evaluation timestamp.');
  }

  const coreDraftData = CORE_DEFINITIONS.map((definition) =>
    createItem(definition, input.sources[definition.key], now)
  );
  const optionalSignals = OPTIONAL_DEFINITIONS.map((definition) =>
    createItem(definition, input.sources[definition.key], now)
  );
  const productBlockingFailures = coreDraftData.filter(
    (item) => item.status === 'blocking'
  );
  const optionalSignalDegradations = optionalSignals.filter(
    (item) => item.status === 'degraded'
  );
  const actionableWarnings = (input.warnings ?? []).map((warning) => ({
    ...warning,
    status: 'warning' as const,
  }));

  return {
    generatedAt: new Date(now).toISOString(),
    status: productBlockingFailures.length > 0 ? 'blocked' : 'ready',
    summary: {
      productBlockingFailures: productBlockingFailures.length,
      actionableWarnings: actionableWarnings.length,
      optionalSignalDegradations: optionalSignalDegradations.length,
    },
    coreDraftData,
    optionalSignals,
    productBlockingFailures,
    actionableWarnings,
    optionalSignalDegradations,
    engineeringChecks: {
      status: 'not-run',
      message: 'Build, type-check, lint, and test results are separate engineering evidence and do not determine product Draft Readiness.',
      commands: ['pnpm typecheck', 'pnpm lint', 'pnpm test', 'pnpm build'],
    },
  };
}
