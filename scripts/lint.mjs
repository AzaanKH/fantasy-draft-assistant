import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import agentRules from './agent-lint-rules.mjs';
import { gateWorkspaces } from '../gate-workspaces.js';
import { compareBaseline, baselineOccurrences, newDiagnostics } from './lint-baseline.mjs';

const root = path.resolve(import.meta.dirname, '..');

export async function lint(directories = gateWorkspaces.map(({ directory }) => directory)) {
  for (const directory of directories) {
    if (!gateWorkspaces.some((workspace) => workspace.directory === directory)) {
      throw new Error(`Unknown lint workspace ${directory}. Add it to gate-workspaces.js and the root gate configs.`);
    }
  }
  const eslint = new ESLint({ cwd: root, overrideConfig: { linterOptions: { reportUnusedDisableDirectives: 'error' } } });
  const results = await eslint.lintFiles(directories.map((directory) => `${directory}/**/*.{ts,tsx,js,mjs,cjs}`));
  const sources = new Map(await Promise.all(results.map(async result => [result.filePath, await readFile(result.filePath, 'utf8')])));
  const suppressionLinter = new Linter();
  for (const result of results) {
    const source = sources.get(result.filePath);
    result.messages = result.messages.filter(message => message.ruleId !== 'agent/reasoned-disable');
    if (/eslint(?:-disable|\s)/.test(source)) {
      const reasons = suppressionLinter.verify(source, [{
        files: ['**/*.{ts,tsx,js,mjs,cjs}'],
        languageOptions: { parser: tseslint.parser },
        plugins: { agent: agentRules },
        rules: { 'agent/reasoned-disable': 'error' },
      }], { filename: result.filePath, allowInlineConfig: false });
      result.messages.push(...reasons.filter(message => message.ruleId === 'agent/reasoned-disable'));
    }
  }
  const baseline = JSON.parse(await readFile(path.join(root, 'eslint-baseline.json'), 'utf8'));
  const unknown = Object.keys(baseline).filter((file) => !gateWorkspaces.some(({ directory }) => file.startsWith(`${directory}/src/`)));
  const failures = unknown.map((file) => `${file}: baseline is stale. Remove entries outside the linted workspace source files.`);
  failures.push(...compareBaseline(baselineOccurrences(results, root, sources), baseline, directories));
  const visible = results.map((result) => {
    const messages = newDiagnostics(result.messages, sources.get(result.filePath), baseline[path.relative(root, result.filePath).replaceAll('\\', '/')], result.filePath);
    return { ...result, messages, errorCount: messages.filter(message => message.severity === 2).length,
      warningCount: messages.filter(message => message.severity === 1).length };
  });
  const output = (await eslint.loadFormatter('stylish')).format(visible);
  if (output) process.stdout.write(output);
  for (const failure of failures) console.error(failure);
  const errorCount = visible.reduce((count, result) => count + result.messages.length, 0);
  if (failures.length || errorCount) return 1;
  console.log(`Lint passed for ${directories.join(', ')} (${results.length} files; baseline occurrences match).`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await lint(process.argv.slice(2).length ? process.argv.slice(2) : undefined);
}
