import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const RELEASE_REPORT_PATH = join(
  REPO_ROOT,
  'data',
  'primary-league-release-gate-report.json'
);
const READINESS_REPORT_PATH = join(REPO_ROOT, 'data', 'draft-readiness-report.json');
const REHEARSAL_REPORT_PATH = join(
  REPO_ROOT,
  'data',
  'primary-league-deterministic-rehearsal-report.json'
);
const OPERATION_PATH = join(REPO_ROOT, 'data', 'primary-league-rehearsal.json');

export type ReleaseCheckKey =
  | 'build'
  | 'type-check'
  | 'lint'
  | 'unit'
  | 'integration'
  | 'data-quality'
  | 'product-rehearsal';

interface CommandSpec {
  readonly executable: string;
  readonly args: readonly string[];
}

export interface ReleaseCheckDefinition {
  readonly key: ReleaseCheckKey;
  readonly label: string;
  readonly commands: readonly CommandSpec[];
}

export interface CommandOutcome {
  readonly command: string;
  readonly status: 'passed' | 'failed';
  readonly exitCode: number | null;
  readonly durationMs: number;
}

export interface ReleaseCheckOutcome {
  readonly key: ReleaseCheckKey;
  readonly label: string;
  readonly status: 'passed' | 'failed';
  readonly commands: readonly CommandOutcome[];
}

interface ReadinessEvidence {
  readonly productBlockingFailures?: readonly unknown[];
  readonly actionableWarnings?: readonly unknown[];
  readonly optionalSignalDegradations?: readonly unknown[];
}

interface RehearsalEvidence {
  readonly status?: string;
  readonly configuration?: unknown;
  readonly transitions?: unknown;
  readonly reconciliation?: unknown;
  readonly completion?: unknown;
  readonly failures?: readonly unknown[];
}

interface OperationalEvidence {
  readonly season?: number;
  readonly provider?: string;
  readonly draftId?: string;
  readonly leagueId?: string;
  readonly recordedAt?: string;
  readonly scheduledStartAt?: string;
  readonly timezone?: string;
  readonly pickTimerSeconds?: number;
  readonly providerStatus?: string;
  readonly expectedConfiguration?: unknown;
  readonly realProviderRehearsal?: {
    readonly status?: string;
    readonly completedAt?: string | null;
    readonly notes?: string;
  };
}

export interface PrimaryLeagueReleaseGateReport {
  readonly generatedAt: string;
  readonly status: 'blocked' | 'feature-freeze';
  readonly outcomes: Readonly<Record<ReleaseCheckKey, ReleaseCheckOutcome>>;
  readonly operational: OperationalEvidence;
  readonly deterministicRehearsal: RehearsalEvidence;
  readonly productBlockingFailures: readonly unknown[];
  readonly releaseBlockingFailures: readonly {
    readonly key: ReleaseCheckKey;
    readonly label: string;
    readonly message: string;
  }[];
  readonly actionableWarnings: readonly unknown[];
  readonly optionalSignalDegradations: readonly unknown[];
  readonly featureFreeze: {
    readonly status: 'pending' | 'active';
    readonly allowedChanges: readonly string[];
    readonly message: string;
  };
}

export const RELEASE_CHECKS: readonly ReleaseCheckDefinition[] = [
  {
    key: 'build',
    label: 'Build',
    commands: [{ executable: 'pnpm', args: ['build'] }],
  },
  {
    key: 'type-check',
    label: 'Type-check',
    commands: [{ executable: 'pnpm', args: ['typecheck'] }],
  },
  {
    key: 'lint',
    label: 'Lint',
    commands: [{ executable: 'pnpm', args: ['lint'] }],
  },
  {
    key: 'unit',
    label: 'Unit tests',
    commands: [
      { executable: 'pnpm', args: ['--filter', 'extension', 'test'] },
      {
        executable: 'pnpm',
        args: [
          '--filter', 'web-app', 'test', '--',
          '--exclude', 'src/**/*.integration.test.ts',
          '--exclude', 'src/**/primary-league-rehearsal.test.ts',
        ],
      },
      {
        executable: 'pnpm',
        args: [
          '--filter', 'server', 'test', '--',
          '--exclude', 'src/sync-engine.test.ts',
          '--exclude', 'src/sync-server.test.ts',
        ],
      },
      { executable: 'pnpm', args: ['--filter', 'scripts', 'test'] },
    ],
  },
  {
    key: 'integration',
    label: 'Integration tests',
    commands: [
      {
        executable: 'pnpm',
        args: [
          '--filter', 'web-app', 'test', '--',
          'src/features/draft-room/draft-workspace-decision.integration.test.ts',
        ],
      },
      {
        executable: 'pnpm',
        args: [
          '--filter', 'server', 'test', '--',
          'src/sync-engine.test.ts',
          'src/sync-server.test.ts',
        ],
      },
    ],
  },
  {
    key: 'data-quality',
    label: 'Data quality',
    commands: [
      { executable: 'pnpm', args: ['data:check:strict'] },
      { executable: 'pnpm', args: ['draft:readiness'] },
    ],
  },
  {
    key: 'product-rehearsal',
    label: 'Product rehearsal',
    commands: [
      { executable: 'pnpm', args: ['--filter', 'web-app', 'rehearse:primary-league'] },
    ],
  },
];

function commandLabel(spec: CommandSpec): string {
  return [spec.executable, ...spec.args].join(' ');
}

async function runCommand(spec: CommandSpec): Promise<CommandOutcome> {
  const startedAt = Date.now();
  const exitCode = await new Promise<number | null>((resolveExit) => {
    const child = spawn(spec.executable, [...spec.args], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', () => resolveExit(null));
    child.once('exit', (code) => resolveExit(code));
  });
  return {
    command: commandLabel(spec),
    status: exitCode === 0 ? 'passed' : 'failed',
    exitCode,
    durationMs: Date.now() - startedAt,
  };
}

async function runCheck(
  definition: ReleaseCheckDefinition
): Promise<ReleaseCheckOutcome> {
  console.log(`\n${definition.label}`);
  const commands: CommandOutcome[] = [];
  for (const command of definition.commands) {
    console.log(`$ ${commandLabel(command)}`);
    commands.push(await runCommand(command));
  }
  return {
    key: definition.key,
    label: definition.label,
    status: commands.every((command) => command.status === 'passed')
      ? 'passed'
      : 'failed',
    commands,
  };
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function unavailableOutcome(
  key: ReleaseCheckKey,
  label: string
): ReleaseCheckOutcome {
  return {
    key,
    label,
    status: 'failed',
    commands: [],
  };
}

export function buildPrimaryLeagueReleaseGateReport(input: {
  readonly now: number;
  readonly outcomes: readonly ReleaseCheckOutcome[];
  readonly readiness: ReadinessEvidence | null;
  readonly rehearsal: RehearsalEvidence | null;
  readonly operational: OperationalEvidence | null;
}): PrimaryLeagueReleaseGateReport {
  const outcomes = Object.fromEntries(
    RELEASE_CHECKS.map((definition) => [
      definition.key,
      input.outcomes.find((outcome) => outcome.key === definition.key) ??
        unavailableOutcome(definition.key, definition.label),
    ])
  ) as Record<ReleaseCheckKey, ReleaseCheckOutcome>;
  const completedAt = input.operational?.realProviderRehearsal?.completedAt;
  const completionTime = typeof completedAt === 'string' ? Date.parse(completedAt) : Number.NaN;
  const realProviderRehearsalPassed =
    input.operational?.realProviderRehearsal?.status === 'passed' &&
    Number.isFinite(completionTime) &&
    completionTime <= input.now;
  const productBlockingFailures = [
    ...(input.readiness?.productBlockingFailures ?? []),
    ...(input.rehearsal?.status === 'passed'
      ? []
      : [{
          key: 'deterministic-product-rehearsal',
          label: 'Deterministic product rehearsal',
          message: 'The complete deterministic Primary League rehearsal has not passed.',
        }]),
    ...(realProviderRehearsalPassed
      ? []
      : [{
          key: 'real-provider-rehearsal',
          label: 'Real-provider rehearsal',
          message: 'The scheduled Sleeper rehearsal has not completed successfully.',
        }]),
  ];
  const releaseBlockingFailures = Object.values(outcomes)
    .filter((outcome) => outcome.status === 'failed')
    .map((outcome) => ({
      key: outcome.key,
      label: outcome.label,
      message: `${outcome.label} did not pass every recorded command.`,
    }));
  const canFreeze =
    productBlockingFailures.length === 0 &&
    releaseBlockingFailures.length === 0;
  const allowedChanges = [
    'data refreshes',
    'rehearsal fixes',
    'defects that threaten Draft Readiness',
  ];

  return {
    generatedAt: new Date(input.now).toISOString(),
    status: canFreeze ? 'feature-freeze' : 'blocked',
    outcomes,
    operational: input.operational ?? {},
    deterministicRehearsal: input.rehearsal ?? {},
    productBlockingFailures,
    releaseBlockingFailures,
    actionableWarnings: input.readiness?.actionableWarnings ?? [],
    optionalSignalDegradations:
      input.readiness?.optionalSignalDegradations ?? [],
    featureFreeze: {
      status: canFreeze ? 'active' : 'pending',
      allowedChanges,
      message: canFreeze
        ? `Feature freeze is active. Only ${allowedChanges.join(', ')} are allowed.`
        : 'Feature freeze remains pending until every release check and the real-provider rehearsal pass.',
    },
  };
}

async function main(): Promise<void> {
  const outcomes: ReleaseCheckOutcome[] = [];
  for (const definition of RELEASE_CHECKS) {
    outcomes.push(await runCheck(definition));
  }
  const [readiness, rehearsal, operational] = await Promise.all([
    readJson<ReadinessEvidence>(READINESS_REPORT_PATH),
    readJson<RehearsalEvidence>(REHEARSAL_REPORT_PATH),
    readJson<OperationalEvidence>(OPERATION_PATH),
  ]);
  const report = buildPrimaryLeagueReleaseGateReport({
    now: Date.now(),
    outcomes,
    readiness,
    rehearsal,
    operational,
  });
  await writeFile(
    RELEASE_REPORT_PATH,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
  );
  console.log(`\nPrimary League release gate: ${report.status}`);
  console.log(`Report: ${RELEASE_REPORT_PATH}`);
  if (report.status !== 'feature-freeze') process.exitCode = 1;
}

const isDirectRun = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  await main();
}
