import { Processes, ProcessError, runNodeMain } from '@fantasy-draft/shared/node';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DRAFT_DATA_REFRESH_STEPS } from '@fantasy-draft/shared/catalog';
import type {
  DraftReadinessItem,
  DraftReadinessReport,
  DraftReadinessWarning,
} from '@fantasy-draft/shared/catalog';
import { buildDraftReadinessReport } from './check-draft-readiness.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

interface RefreshStep {
  readonly label: string;
  readonly script: string;
}

type PreConnectFailure = DraftReadinessItem | DraftReadinessWarning;

export const LIVE_CORE_REFRESH_STEPS: readonly RefreshStep[] = DRAFT_DATA_REFRESH_STEPS;

export const LIVE_DRAFT_PREP_REPORT_STEP: RefreshStep = {
  label: 'Draft prep report',
  script: 'report:draft-prep',
};

async function runRefreshStep(step: RefreshStep, signal: AbortSignal): Promise<void> {
  console.log(`\n[Live preflight] Refreshing ${step.label}...`);

  try {
    await Processes.run(PNPM_COMMAND, [step.script], {
      cwd: REPO_ROOT, env: process.env, output: 'inherit', stdin: 'inherit',
      shell: process.platform === 'win32', timeoutMs: 5 * 60_000, signal,
    });
  } catch (error) {
    if (!(error instanceof ProcessError) || error.kind !== 'exit') throw error;
    const outcome = error.result.signal ? `signal ${error.result.signal}` : `exit code ${String(error.exitCode)}`;
    throw new Error(`${step.label} refresh failed with ${outcome}.`);
  }
}

async function updateDraftPrepReport(signal: AbortSignal): Promise<void> {
  try {
    await runRefreshStep(LIVE_DRAFT_PREP_REPORT_STEP, signal);
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

async function prepareLiveDraft(signal: AbortSignal): Promise<void> {
  for (const step of LIVE_CORE_REFRESH_STEPS) {
    await runRefreshStep(step, signal);
  }

  const report = await buildDraftReadinessReport(Date.now());
  const failures = findPreConnectFailures(report);
  if (failures.length > 0) {
    renderFailures(failures);
    throw new Error('Live preflight could not prepare the required local draft data.');
  }

  await updateDraftPrepReport(signal);

  console.log('\n[Live preflight] Rankings, player identities, and keeper supply are ready.');
  console.log(
    '[Live preflight] Connect the Primary League draft to verify its live scoring and roster settings.'
  );
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await runNodeMain(prepareLiveDraft);
}
