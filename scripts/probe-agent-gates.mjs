import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { ESLint } from 'eslint';

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
export const snakeNullish = Math.random() > 0.5 ? 'linear' : undefined;
export const fallback = snakeNullish ?? 'snake';
export const fallbackOr = snakeNullish || 'snake';
export function defaultDraft(draftType = 'snake'): string { return draftType; }
export const imports = [localDevPorts, SAFE_RECOMMENDATION_POLICY];
`;
let created = false;
try {
  await writeFile(file, source, { flag: 'wx' });
  created = true;
  const eslint = new ESLint({ cwd: root });
  const results = await eslint.lintFiles([file]);
  process.stdout.write((await eslint.loadFormatter('stylish')).format(results));
  const messages = results.flatMap((result) => result.messages);
  for (const rule of ['agent/no-json-cast', 'agent/no-bare-fetch', 'agent/no-cross-package-import', '@typescript-eslint/explicit-module-boundary-types']) {
    if (!messages.some((message) => message.ruleId === rule)) throw new Error(`${rule} did not fire`);
  }
  if (messages.filter((message) => message.ruleId === 'no-restricted-syntax').length !== 3) {
    throw new Error('Expected snake default, ?? fallback, and || fallback errors');
  }
  console.log('All new lint rules and all three snake forms fired on the scratch file.');
} finally {
  if (created) await unlink(file);
}
