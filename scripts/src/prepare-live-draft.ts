import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  DraftReadinessItem,
  DraftReadinessReport,
  DraftReadinessWarning,
} from '@fantasy-draft/shared';
import { buildDraftReadinessReport } from './check-draft-readiness.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const SLEEPER_REFRESH_TIMEOUT_MS = 60_000;

interface RefreshStep {
  readonly label: string;
  readonly script: string;
}

type PreConnectFailure = DraftReadinessItem | DraftReadinessWarning;

export const LIVE_CORE_REFRESH_STEPS: readonly RefreshStep[] = [
  { label: 'Sleeper player directory', script: 'refresh:sleeper' },
  { label: 'FantasyPros rankings', script: 'refresh:fantasypros' },
  { label: 'Canonical player identities', script: 'data:identity' },
];

export const LIVE_DRAFT_PREP_REPORT_STEP: RefreshStep = {
  label: 'Draft prep report',
  script: 'report:draft-prep',
};

function runRefreshStep(step: RefreshStep): Promise<void> {
  console.log(`\n[Live preflight] Refreshing ${step.label}...`);

  return new Promise((resolveStep, rejectStep) => {
    const timeoutMs = step.script === 'refresh:sleeper'
      ? SLEEPER_REFRESH_TIMEOUT_MS
      : null;
    const child = spawn(PNPM_COMMAND, [step.script], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: 'inherit',
      detached: timeoutMs !== null && process.platform !== 'win32',
    });
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    const settle = (result: 'resolve' | 'reject', error?: Error): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (result === 'resolve') {
        resolveStep();
      } else {
        rejectStep(error);
      }
    };

    if (timeoutMs !== null) {
      timeout = setTimeout(() => {
        if (child.pid !== undefined) {
          if (process.platform === 'win32') {
            const terminator = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
              stdio: 'ignore',
            });
            terminator.once('error', () => { child.kill('SIGTERM'); });
          } else {
            try {
              process.kill(-child.pid, 'SIGTERM');
            } catch {
              child.kill('SIGTERM');
            }
          }
        }
        settle(
          'reject',
          new Error(`${step.label} refresh timed out after ${String(timeoutMs / 1000)} seconds.`)
        );
      }, timeoutMs);
    }

    child.once('error', (error) => { settle('reject', error); });
    child.once('exit', (code, signal) => {
      if (code === 0) {
        settle('resolve');
        return;
      }

      const outcome = signal ? `signal ${signal}` : `exit code ${String(code)}`;
      settle('reject', new Error(`${step.label} refresh failed with ${outcome}.`));
    });
  });
}

async function updateDraftPrepReport(): Promise<void> {
  try {
    await runRefreshStep(LIVE_DRAFT_PREP_REPORT_STEP);
    console.log('[Live preflight] Draft prep report updated.');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[Live preflight] Draft prep report was not updated: ${message}`
    );
    console.warn(
      '[Live preflight] Continuing because report generation is not Core Draft Data.'
    );
  }
}

export function findPreConnectFailures(
  report: DraftReadinessReport
): readonly PreConnectFailure[] {
  const fileBlockers = report.productBlockingFailures.filter(
    (item: DraftReadinessItem) => item.key !== 'primary-league-settings'
  );
  const sleeperWarnings = report.actionableWarnings.filter(
    (warning: DraftReadinessWarning) => warning.key === 'data/sleeper-adp.json'
  );
  return [...fileBlockers, ...sleeperWarnings];
}

function renderFailures(failures: readonly PreConnectFailure[]): void {
  console.error('\n[Live preflight] Core draft data is still blocked:');
  for (const failure of failures) {
    console.error(`  ${failure.label}: ${failure.message}`);
    if (failure.correctiveAction) {
      console.error(`  Action: ${failure.correctiveAction}`);
    }
  }
}

export async function prepareLiveDraft(): Promise<void> {
  for (const step of LIVE_CORE_REFRESH_STEPS) {
    await runRefreshStep(step);
  }

  const report = await buildDraftReadinessReport(Date.now());
  const failures = findPreConnectFailures(report);
  if (failures.length > 0) {
    renderFailures(failures);
    throw new Error('Live preflight could not prepare the required local draft data.');
  }

  await updateDraftPrepReport();

  console.log('\n[Live preflight] Rankings, player identities, and keeper supply are ready.');
  console.log(
    '[Live preflight] Connect the Primary League draft to verify its live scoring and roster settings.'
  );
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  prepareLiveDraft().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
