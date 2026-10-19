import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import agent from './agent-lint-rules.mjs';

function messages(source, file = 'cli/src/probe.ts') {
  return new Linter().verify(source, [{
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { agent, '@typescript-eslint': tseslint.plugin },
    rules: {
      'agent/no-json-cast': 'error',
      'agent/no-bare-fetch': 'error',
      'agent/no-cross-package-import': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
    },
  }], { filename: new URL(`../${file}`, import.meta.url).pathname });
}

describe('agent lint rules', () => {
  it.each([
    'const x = JSON.parse(text) as Payload;',
    'const x = response.json() as Promise<Payload>;',
    'const x = await response.json() as Payload;',
    "const x = JSON['parse'](text) as Payload;",
  ])('rejects unvalidated JSON casts: %s', (source) => {
    expect(messages(source)).toEqual([expect.objectContaining({ ruleId: 'agent/no-json-cast' })]);
  });
  it('requires the shared HTTP runner', () => {
    expect(messages('fetch(url);')).toEqual([expect.objectContaining({ message: expect.stringContaining('shared HTTP runner (unit 8)') })]);
  });
  it.each([
    "import { x } from '../../server/src/x';",
    "export { x } from '../../server/src/x';",
    "const x = import('../../server/src/x');",
    "import { x } from '@/lib/x';",
  ])('rejects workspace reach-ins: %s', (source) => {
    expect(messages(source)).toEqual([expect.objectContaining({ ruleId: 'agent/no-cross-package-import' })]);
  });
  it('allows public packages, same-package paths, and the web-app alias', () => {
    expect(messages("import { x } from '@fantasy-draft/shared'; import { y } from './local';")).toEqual([]);
    expect(messages("import { x } from '@/lib/x';", 'web-app/src/probe.ts')).toEqual([]);
  });
  it('requires exported function annotations', () => {
    expect(messages('export function read() { return 1; }')).toEqual([expect.objectContaining({ ruleId: '@typescript-eslint/explicit-module-boundary-types' })]);
    expect(messages('export function read(): number { return 1; }')).toEqual([]);
  });
});
