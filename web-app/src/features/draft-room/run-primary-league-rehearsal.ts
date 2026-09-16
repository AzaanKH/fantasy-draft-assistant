import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPrimaryLeagueRehearsal } from './primary-league-rehearsal';

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..'
);
const REPORT_PATH = resolve(
  REPO_ROOT,
  'data/primary-league-deterministic-rehearsal-report.json'
);

const report = runPrimaryLeagueRehearsal();
await mkdir(dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`Primary League deterministic rehearsal: ${report.status}`);
console.log(`Report: ${REPORT_PATH}`);
console.log(
  `${String(report.completion.canonicalPicks)} canonical picks, ` +
  `${String(report.completion.missedPickNumbers.length)} missed, ` +
  `${String(report.completion.duplicatePickNumbers.length)} duplicate slots.`
);
if (report.failures.length > 0) {
  report.failures.forEach((failure) => {
    console.error(`  ${failure}`);
  });
  process.exitCode = 1;
}
