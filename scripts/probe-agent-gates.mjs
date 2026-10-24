import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import agent from './agent-lint-rules.mjs';

const root = path.resolve(import.meta.dirname, '..');
const file = path.join(root, 'cli/src/__unit4_lint_probe__.ts');
const source = `
import { localDevPorts } from '../../shared/src/local-dev.js';
import { SAFE_RECOMMENDATION_POLICY } from '@/lib/player-data/policy';
export function missingReturnType() { return 1; }
export const jsonValue = JSON.parse('{}') as Record<string, unknown>;
export const responseValue = new Response().json() as Promise<unknown>;
export const awaitedValue = await new Response().json() as unknown;
export const request = fetch('https://example.invalid');
export const globalRequest = globalThis.fetch;
export const windowRequest = window.fetch;
export const computedRequest = window['fetch'];
export const boundRequest = fetch.bind(globalThis);
const { fetch: destructuredRequest } = globalThis;
export const aliasRequest = destructuredRequest;
window.fetch = windowRequest;
const client = { fetch: () => undefined };
client.fetch();
function localTransport(fetch: () => void): void { fetch(); }
localTransport(client.fetch);
export const snakeNullish = Math.random() > 0.5 ? 'linear' : undefined;
export const fallback = snakeNullish ?? 'snake';
export const fallbackOr = snakeNullish || 'snake';
export function defaultDraft(draftType = 'snake'): string { return draftType; }
export const imports = [localDevPorts, SAFE_RECOMMENDATION_POLICY];
export const flexPositions = ['RB', 'WR', 'TE'];
export const season = new Date().getFullYear();
`;
let created = false;
try {
  await writeFile(file, source, { flag: 'wx' });
  created = true;
  const eslint = new ESLint({ cwd: root });
  const results = await eslint.lintFiles([file]);
  process.stdout.write((await eslint.loadFormatter('stylish')).format(results));
  const messages = results.flatMap((result) => result.messages);
  for (const rule of ['agent/no-json-cast', 'agent/no-bare-fetch', 'agent/no-cross-package-import', '@typescript-eslint/explicit-module-boundary-types', 'agent/no-position-array', 'agent/no-inline-season']) {
    if (!messages.some((message) => message.ruleId === rule)) throw new Error(`${rule} did not fire`);
  }
  if (messages.filter(message => message.ruleId === 'agent/no-bare-fetch').length !== 7) {
    throw new Error('Expected seven native fetch reference errors, including aliases and a property write');
  }
  if (messages.filter((message) => message.ruleId === 'no-restricted-syntax').length !== 3) {
    throw new Error('Expected snake default, ?? fallback, and || fallback errors');
  }
  console.log('All new lint rules and all three snake forms fired on the scratch file.');
} finally {
  if (created) await unlink(file);
}

if (process.argv.includes('--replay')) {
  const historicalPath = 'server/src/sync-server.ts';
  const historicalRef = 'a4696c0^';
  const historicalSource = execFileSync('git', ['show', `${historicalRef}:${historicalPath}`], { cwd: root, encoding: 'utf8' });
  const historicalCommit = execFileSync('git', ['rev-parse', historicalRef], { cwd: root, encoding: 'utf8' }).trim();
  const cases = [
    { name: `${historicalRef}:${historicalPath}`, source: historicalSource, expected: 1 },
    ...[
      'globalThis.fetch(url);', 'window.fetch(url);', "globalThis['fetch'](url);", 'window[`fetch`](url);',
      'const f = fetch; f(url);', 'const f = window.fetch; f(url);',
      'const { fetch: f } = globalThis; f(url);', 'const f = window.fetch.bind(window); f(url);',
      'window.fetch = mockFetch;',
    ].map(source => ({ name: source, source, expected: 1 })),
    { name: 'local and unrelated methods', source: 'function run(fetch) { fetch(url); } client.fetch(url);', expected: 0 },
  ];
  const linter = new Linter();
  const receipt = cases.map(({ name, source, expected }) => {
    const messages = linter.verify(source, [{
      files: ['**/*.ts'], languageOptions: { parser: tseslint.parser },
      plugins: { agent }, rules: { 'agent/no-bare-fetch': 'error' },
    }], { filename: path.join(root, historicalPath) });
    if (messages.length !== expected || messages.some(message => message.ruleId !== 'agent/no-bare-fetch' || message.severity !== 2)) {
      throw new Error(`Replay failed for ${name}: ${JSON.stringify(messages)}`);
    }
    return { name, errors: messages.map(({ ruleId, severity, line, column, message }) => ({ ruleId, severity, line, column, message })) };
  });
  console.log(JSON.stringify({ historicalCommit, historicalPath, liveRequests: 0, cases: receipt }, null, 2));
}

if (process.argv.includes('--replay')) {
  const source = execFileSync('git', ['show', 'f464926:server/src/draft-data-refresh.ts'], { cwd: root, encoding: 'utf8' });
  const messages = new Linter().verify(source, [{
    linterOptions: { reportUnusedDisableDirectives: false },
    files: ['**/*.ts'], languageOptions: { parser: tseslint.parser },
    plugins: { agent }, rules: { 'agent/no-bare-child-process': 'error' },
  }], { filename: path.join(root, 'server/src/draft-data-refresh.ts') });
  if (messages.length !== 1 || messages[0].ruleId !== 'agent/no-bare-child-process' || messages[0].severity !== 2) {
    throw new Error(`Base-era process replay failed: ${JSON.stringify(messages)}`);
  }
  console.log(JSON.stringify({ processReplayBase: 'f464926', liveCommands: 0, messages }, null, 2));
}
