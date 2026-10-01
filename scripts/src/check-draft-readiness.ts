import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildDraftReadinessReport } from './draft-readiness-report.js';
export { areKeepersValid, buildDraftReadinessReport } from './draft-readiness-report.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const REPORT_PATH = join(REPO_ROOT, 'data', 'draft-readiness-report.json');

function renderSection(
  heading: string,
  items: readonly { readonly label: string; readonly message: string; readonly correctiveAction?: string }[]
): void {
  console.log(`\n${heading} (${String(items.length)})`);
  if (items.length === 0) {
    console.log('  None.');
    return;
  }
  for (const item of items) {
    console.log(`  ${item.label}: ${item.message}`);
    if (item.correctiveAction) console.log(`  Action: ${item.correctiveAction}`);
  }
}

async function main(): Promise<void> {
  const nowOverride = process.env['DRAFT_READINESS_NOW'];
  const now = nowOverride ? Date.parse(nowOverride) : Date.now();
  if (!Number.isFinite(now)) {
    throw new Error('DRAFT_READINESS_NOW must be a valid ISO-8601 timestamp.');
  }

  const report = await buildDraftReadinessReport(now);
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Draft Readiness: ${report.status === 'ready' ? 'READY' : 'BLOCKED'}`);
  renderSection('PRODUCT-BLOCKING FAILURES', report.productBlockingFailures);
  renderSection('ACTIONABLE WARNINGS', report.actionableWarnings);
  renderSection('OPTIONAL SIGNAL DEGRADATION', report.optionalSignalDegradations);
  console.log('\nENGINEERING CHECKS (SEPARATE; NOT RUN)');
  console.log(`  ${report.engineeringChecks.message}`);
  console.log(`\nGenerated report: ${REPORT_PATH}`);

  if (report.status === 'blocked') process.exitCode = 1;
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    console.error('Draft Readiness check failed:', error);
    process.exit(1);
  });
}
