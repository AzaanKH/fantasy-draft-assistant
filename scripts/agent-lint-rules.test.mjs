import { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import agent from './agent-lint-rules.mjs';

function messages(source, file = 'cli/src/probe.ts') {
  return new Linter({ cwd: new URL('..', import.meta.url).pathname }).verify(source, [{
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { agent, '@typescript-eslint': tseslint.plugin },
    rules: {
      'agent/no-closed-root-import': 'error',
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

describe('closed shared root exports', () => {
  it.each(['web-app/__bench__/probe.ts', 'scripts/probe.mjs'])('checks closed names outside src in %s', async (filePath) => {
    const eslint = new ESLint({ cwd: new URL('..', import.meta.url).pathname });
    const results = await eslint.lintText("import { deriveDraft } from '@fantasy-draft/shared';", { filePath });
    expect(results[0].messages).toEqual([expect.objectContaining({ ruleId: 'agent/no-closed-root-import' })]);
  });
  it.each([
    ["import { DraftSyncEngine } from '@fantasy-draft/shared';", 'sync'],
    ["import type { DraftMetadata as Metadata } from '@fantasy-draft/shared';", 'sync'],
    ["export { createLeagueSettings as settings } from '@fantasy-draft/shared';", 'league'],
    ["import { MAX_DRAFT_TEAMS } from '@fantasy-draft/shared';", 'units'],
    ["type Roster = import('@fantasy-draft/shared/draft').Roster;", 'league'],
    ["import { deriveDraft } from '@fantasy-draft/shared';", 'draft'],
    ["import type { Recommendation } from '@fantasy-draft/shared';", 'draft'],
    ["import { createEmptyRoster } from '@fantasy-draft/shared/draft';", 'league'],
    ["export type { Roster as TeamRoster } from '@fantasy-draft/shared/draft';", 'league'],
    ["import { localDevPorts } from '@fantasy-draft/shared';", 'node'],
  ])('names the replacement for %s', (source, target) => {
    expect(messages(source)).toEqual([expect.objectContaining({
      ruleId: 'agent/no-closed-root-import',
      message: expect.stringContaining(`@fantasy-draft/shared/${target}`),
    })]);
  });
  it.each([
    "import * as shared from '@fantasy-draft/shared';",
    "export * from '@fantasy-draft/shared';",
    "const shared = import('@fantasy-draft/shared');",
    "type Metadata = import('@fantasy-draft/shared').DraftMetadata;",
  ])('rejects namespace access to closed groups: %s', (source) => {
    expect(messages(source)).toEqual([expect.objectContaining({ ruleId: 'agent/no-closed-root-import' })]);
  });
  it('allows namespace and type access to valid draft exports', () => {
    expect(messages("import * as draft from '@fantasy-draft/shared/draft'; type Pick = import('@fantasy-draft/shared/draft').DraftPick;")).toEqual([]);
  });
  it('allows open root names and closed names on their exact subpaths', () => {
    expect(messages("import type { Player } from '@fantasy-draft/shared'; import { DraftSyncEngine } from '@fantasy-draft/shared/sync';")).toEqual([]);
  });
});
