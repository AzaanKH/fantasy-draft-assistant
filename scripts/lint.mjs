import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import { gateWorkspaces } from '../gate-workspaces.js';
import { baselineRuleIds } from './agent-lint-rules.mjs';
import { compareBaseline, countBaseline } from './lint-baseline.mjs';

const root = path.resolve(import.meta.dirname, '..');

export async function lint(directories = gateWorkspaces.map(({ directory }) => directory)) {
  for (const directory of directories) {
    if (!gateWorkspaces.some((workspace) => workspace.directory === directory)) {
      throw new Error(`Unknown lint workspace ${directory}. Add it to gate-workspaces.js and the root gate configs.`);
    }
  }
  const eslint = new ESLint({ cwd: root, overrideConfig: { linterOptions: { reportUnusedDisableDirectives: 'error' } } });
  const results = await eslint.lintFiles(directories.map((directory) => `${directory}/**/*.{ts,tsx,js,mjs,cjs}`));
  const baseline = JSON.parse(await readFile(path.join(root, 'eslint-baseline.json'), 'utf8'));
  const unknown = Object.keys(baseline).filter((file) => !gateWorkspaces.some(({ directory }) => file.startsWith(`${directory}/src/`)));
  const failures = unknown.map((file) => `${file}: baseline is stale. Remove entries outside the linted workspace source files.`);
  failures.push(...compareBaseline(countBaseline(results, root), baseline, directories));
  const visible = results.map((result) => ({
    ...result,
    messages: result.messages.filter((message) => !baselineRuleIds.includes(message.ruleId) || failures.length > 0),
  }));
  const output = (await eslint.loadFormatter('stylish')).format(visible);
  if (output) process.stdout.write(output);
  for (const failure of failures) console.error(failure);
  const errorCount = visible.reduce((count, result) => count + result.messages.length, 0);
  if (failures.length || errorCount) return 1;
  console.log(`Lint passed for ${directories.join(', ')} (${results.length} files; baseline counts match).`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await lint(process.argv.slice(2).length ? process.argv.slice(2) : undefined);
}
