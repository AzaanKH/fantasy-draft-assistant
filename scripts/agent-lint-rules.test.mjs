import { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import agent, { baselineRuleIds } from './agent-lint-rules.mjs';

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
    "import { localDevPorts } from '@fantasy-draft/shared/node';",
    "export * from '@fantasy-draft/shared/node';",
    "const node = import(`@fantasy-draft/shared/node`);",
    "const node = require('@fantasy-draft/shared/node');",
  ])('keeps Node imports out of browser source: %s', async source => {
    const eslint = new ESLint({ cwd: new URL('..', import.meta.url).pathname });
    for (const filePath of ['extension/src/shared/probe.ts', 'web-app/src/probe.ts']) {
      const config = await eslint.calculateConfigForFile(filePath);
      const result = new Linter().verify(source, [{
        files: ['**/*.ts'], languageOptions: { parser: tseslint.parser },
        plugins: { agent }, rules: { 'agent/no-node-in-browser': config.rules['agent/no-node-in-browser'] ?? 'off' },
      }], { filename: filePath });
      expect(result).toEqual([expect.objectContaining({
        ruleId: 'agent/no-node-in-browser', severity: 2,
        message: expect.stringContaining('localDevPorts from @fantasy-draft/shared/sync'),
      })]);
    }
  });
  it.each([
    ['web-app/src/lib/probe.ts', "import { getLocalSyncToken } from '../../../server/src/local-auth';"],
    ['web-app/src/probe.ts', "const auth = import('../../server/src/local-auth.js');"],
    ['extension/src/background/probe.ts', "export { getLocalSyncToken } from '../../../server/src/local-auth.js';"],
    ['extension/src/content/probe.ts', "import { getLocalSyncToken } from 'server/src/local-auth';"],
  ])('keeps server modules out of browser source: %s', async (filePath, source) => {
    const cwd = new URL('..', import.meta.url).pathname;
    const config = await new ESLint({ cwd }).calculateConfigForFile(filePath);
    const result = new Linter({ cwd }).verify(source, [{
      files: ['**/*.ts'], languageOptions: { parser: tseslint.parser },
      plugins: { agent }, rules: { 'agent/no-node-in-browser': config.rules['agent/no-node-in-browser'] ?? 'off' },
    }], { filename: `${cwd}${filePath}` });
    expect(result).toEqual([expect.objectContaining({
      ruleId: 'agent/no-node-in-browser', severity: 2, message: expect.stringContaining('local sync token'),
    })]);
  });
  it('lets browser source import its own relative modules', () => {
    const cwd = new URL('..', import.meta.url).pathname;
    const result = new Linter({ cwd }).verify("import { serverTime } from './server/clock';", [{
      files: ['**/*.ts'], languageOptions: { parser: tseslint.parser },
      plugins: { agent }, rules: { 'agent/no-node-in-browser': 'error' },
    }], { filename: `${cwd}web-app/src/probe.ts` });
    expect(result).toEqual([]);
  });
  it.each([
    "import { spawn } from 'child_process';",
    "import cp from 'node:child_process';",
    "export * from 'node:child_process';",
    "const cp = import('child_process');",
    "const cp = import(`node:child_process`);",
    "const cp = require('child_process');",
    "const cp = require(`node:child_process`);",
    "import cp = require('child_process');",
    "process.getBuiltinModule('child_process');",
    "process['getBuiltinModule']('node:child_process');",
    "const load = require; load('node:child_process');",
    "import { createRequire } from 'node:module'; createRequire(import.meta.url)('child_process');",
    "import { createRequire as make } from 'node:module'; const load = make(import.meta.url); load('node:child_process');",
    "type Child = import('node:child_process').ChildProcess;",
  ])('requires the shared process runner: %s', async source => {
    const eslint = new ESLint({ cwd: new URL('..', import.meta.url).pathname });
    const filePath = 'scripts/src/process-probe.ts';
    const config = await eslint.calculateConfigForFile(filePath);
    const result = new Linter().verify(source, [{
      files: ['**/*.ts'], languageOptions: { parser: tseslint.parser },
      plugins: { agent }, rules: { 'agent/no-bare-child-process': config.rules['agent/no-bare-child-process'] ?? 'off' },
    }], { filename: filePath });
    expect(result).toEqual([expect.objectContaining({
      ruleId: 'agent/no-bare-child-process', severity: 2,
      message: expect.stringContaining('use Processes from @fantasy-draft/shared/node'),
    })]);
  });
  it.each([
    ['shared/src/node/processes.ts', false],
    ['shared/src/node/nested/runner.ts', false],
    ['shared/src/node-other/runner.ts', true],
    ['server/src/fixture.test.ts', false],
    ['scripts/audit-unused-exports.mjs', false],
    ['scripts/probe-source-condition.mjs', false],
    ['scripts/probe-workspace-gates.mjs', false],
    ['scripts/probe-agent-gates.mjs', false],
    ['scripts/other-probe.mjs', true],
    ['extension/config/process.ts', true],
  ])('enforces the process boundary and exact exceptions in %s', async (filePath, enforced) => {
    const eslint = new ESLint({ cwd: new URL('..', import.meta.url).pathname });
    const config = await eslint.calculateConfigForFile(filePath);
    expect(config.rules['agent/no-bare-child-process'] ?? [0]).toEqual(enforced ? [2] : [0]);
    expect(baselineRuleIds).not.toContain('agent/no-bare-child-process');
  });
  it.each([
    'const x = JSON.parse(text) as Payload;',
    'const x = response.json() as Promise<Payload>;',
    'const x = await response.json() as Payload;',
    "const x = JSON['parse'](text) as Payload;",
  ])('rejects unvalidated JSON casts: %s', (source) => {
    expect(messages(source)).toEqual([expect.objectContaining({ ruleId: 'agent/no-json-cast' })]);
  });
  it.each([
    'fetch(url);', 'globalThis.fetch(url);', 'window.fetch(url);',
    "globalThis['fetch'](url);", 'window[`fetch`](url);',
    'const f = fetch; f(url);', 'const f = window.fetch; f(url);',
    'const f = globalThis.fetch; f(url);',
    'const { fetch: f } = globalThis; f(url);',
    'const { fetch } = window; fetch(url);',
    "const { ['fetch']: f } = window; f(url);",
    'const f = fetch.bind(globalThis); f(url);',
    'const f = window.fetch.bind(window); f(url);',
    "const f = globalThis['fetch']['bind'](globalThis); f(url);",
    'consume(fetch);', 'consume(globalThis.fetch);',
    'window.fetch = mockFetch;',
  ])('requires @fantasy-draft/shared/http for native references: %s', source => {
    expect(messages(source)).toEqual([expect.objectContaining({
      ruleId: 'agent/no-bare-fetch', severity: 2,
      message: expect.stringContaining('use @fantasy-draft/shared/http'),
    })]);
  });
  it.each([
    'const client = { fetch() {} }; client.fetch(url);',
    'function run(fetch: Function) { fetch(url); }',
    'const fetch = localRequest; fetch(url);',
    'function run(window: Client) { window.fetch(url); }',
    'function run(globalThis: Client) { globalThis.fetch(url); }',
    'function run(globalThis: Client) { const { fetch: f } = globalThis; f(url); }',
    'function run(fetch: Function) { const f = fetch.bind(null); f(url); }',
    'const value = { fetch: localRequest };',
    'type Client = { fetch: () => void };',
    'type Transport = typeof fetch;',
    'const request: typeof fetch = client;',
    'type Transport = typeof globalThis.fetch;',
    'window[method](url);',
  ])('allows unrelated methods and locally bound names: %s', source => {
    expect(messages(source)).toEqual([]);
  });
  it('allows native transport only inside shared/src/http', () => {
    expect(messages('fetch(url); globalThis.fetch(url);', 'shared/src/http/transport.ts')).toEqual([]);
    expect(messages('fetch(url);', 'shared/src/http/nested/transport.ts')).toEqual([]);
    expect(messages('fetch(url);', 'shared/src/http-other/transport.ts')).toHaveLength(1);
    expect(baselineRuleIds).not.toContain('agent/no-bare-fetch');
  });
  it.each(['scripts/probe.mjs', 'web-app/__visual__/probe.ts', 'extension/config/transport.ts'])('enforces native references outside production src in %s', async filePath => {
    const eslint = new ESLint({ cwd: new URL('..', import.meta.url).pathname });
    const config = await eslint.calculateConfigForFile(filePath);
    expect(config.rules['agent/no-bare-fetch']).toEqual([2]);
    const result = new Linter().verify('window.fetch = mockFetch;', [{
      files: ['**/*.{ts,mjs}'], languageOptions: { parser: tseslint.parser },
      plugins: { agent }, rules: { 'agent/no-bare-fetch': config.rules['agent/no-bare-fetch'] },
    }], { filename: filePath });
    expect(result).toEqual([expect.objectContaining({ ruleId: 'agent/no-bare-fetch', severity: 2 })]);
  });
  it.each(['server/src/client.test.ts', 'web-app/src/transport.test.tsx', 'scripts/transport.test.mjs'])('excludes mock and local-server harnesses from native fetch enforcement in %s', async filePath => {
    const eslint = new ESLint({ cwd: new URL('..', import.meta.url).pathname });
    const config = await eslint.calculateConfigForFile(filePath);
    expect(config.rules['agent/no-bare-fetch'] ?? [0]).toEqual([0]);
    const result = new Linter().verify('fetch(localUrl); window.fetch = mockFetch;', [{
      files: ['**/*.{ts,tsx,mjs}'], languageOptions: { parser: tseslint.parser },
      plugins: { agent }, rules: { 'agent/no-bare-fetch': config.rules['agent/no-bare-fetch'] ?? 'off' },
    }], { filename: filePath });
    expect(result).toEqual([]);
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
    expect(messages("import { x } from '@fantasy-draft/shared/league'; import { y } from './local';")).toEqual([]);
    expect(messages("import { x } from '@/lib/x';", 'web-app/src/probe.ts')).toEqual([]);
  });
  it('requires exported function annotations', () => {
    expect(messages('export function read() { return 1; }')).toEqual([expect.objectContaining({ ruleId: '@typescript-eslint/explicit-module-boundary-types' })]);
    expect(messages('export function read(): number { return 1; }')).toEqual([]);
  });
});

describe('league constant rules', () => {
  function leagueMessages(source, file = 'web-app/src/probe.ts') {
    return new Linter().verify(source, [{
      files: ['**/*.ts'], languageOptions: { parser: tseslint.parser },
      plugins: { agent }, rules: { 'agent/no-position-array': 'error', 'agent/no-inline-season': 'error' },
    }], { filename: file });
  }
  it.each([
    "const FLEX_POSITIONS: readonly Position[] = ['RB', 'WR', 'TE'];",
    "const filters = ['ALL', 'QB', 'RB', 'FLEX'];",
    "const late = new Set(['K', `DEF`]);",
    "const sql = `select * from stats where position in ('QB', 'RB', 'WR', 'TE')`;",
    "const sql = \"where pos in ('K', 'DEF')\";",
  ])('rejects position groups outside shared/src/league: %s', (source) => {
    expect(leagueMessages(source)).toEqual([expect.objectContaining({
      ruleId: 'agent/no-position-array', message: expect.stringContaining('OFFENSIVE_POSITIONS'),
    })]);
  });
  it.each([
    "const filters = ['ALL', ...OFFENSIVE_POSITIONS, 'FLEX'];",
    "const cycle = ['RB', 'WR', 'WR', 'RB'];",
    "if (position === 'TE') bonus();",
    "const sql = `where position in ${sqlPositionList(OFFENSIVE_POSITIONS)} and position = 'TE'`;",
    "const label = 'QB, RB, WR, TE';",
  ])('allows named groups, repeated fixture sequences and single positions: %s', (source) => {
    expect(leagueMessages(source)).toEqual([]);
  });
  it.each([
    'const season = new Date().getFullYear();',
    'const season = new Date(now).getUTCFullYear();',
    "const season = time['getUTCFullYear']();",
  ])('rejects Date-year seasons: %s', (source) => {
    expect(leagueMessages(source)).toEqual([expect.objectContaining({
      ruleId: 'agent/no-inline-season', message: expect.stringContaining('currentSeason(clock)'),
    })]);
  });
  it('enforces the season owner in workspace source and scripts without baseline allowances', async () => {
    const eslint = new ESLint({ cwd: new URL('..', import.meta.url).pathname });
    for (const [filePath, positions, season] of [
      ['web-app/src/probe.ts', 2, 2], ['scripts/src/probe.ts', 2, 2], ['shared/src/draft/probe.ts', 2, 2],
      ['scripts/persistence/probe.mjs', 0, 2], ['shared/src/league/probe.ts', 0, 2],
      ['shared/src/league/season.ts', 0, 0], ['shared/src/http/probe.ts', 0, 0],
      ['web-app/src/probe.test.ts', 0, 0], ['scripts/probe.test.mjs', 0, 0],
    ]) {
      const config = await eslint.calculateConfigForFile(filePath);
      expect(config.rules['agent/no-position-array'] ?? [0], filePath).toEqual([positions]);
      expect(config.rules['agent/no-inline-season'] ?? [0], filePath).toEqual([season]);
    }
    expect(baselineRuleIds).toContain('agent/no-position-array');
    expect(baselineRuleIds).not.toContain('agent/no-inline-season');
  });
});

describe('unit constructors', () => {
  function unitMessages(source) {
    return new Linter().verify(source, [{
      files: ['**/*.ts'], languageOptions: { parser: tseslint.parser },
      plugins: { agent }, rules: { 'agent/no-unit-cast': 'error' },
    }], { filename: 'web-app/src/probe.ts' });
  }
  it.each(['const p = 0.4 as Probability;', 'const r = <Rank>value;', 'const v = row.vor as Vor;',
    'const r = value as Rank | undefined;', 'const map = raw as Readonly<Record<string, Probability>>;', 'const list = values as Percent[];'])('rejects unit casts: %s', (source) => {
    expect(unitMessages(source)).toEqual([expect.objectContaining({ ruleId: 'agent/no-unit-cast', message: expect.stringContaining('asProbability') })]);
  });
  it('allows constructors and unrelated casts, and exempts shared/src/units', async () => {
    expect(unitMessages('const p = asProbability(0.4); const n = value as number;')).toEqual([]);
    const eslint = new ESLint({ cwd: new URL('..', import.meta.url).pathname });
    expect((await eslint.calculateConfigForFile('shared/src/units/brands.ts')).rules['agent/no-unit-cast']).toBeUndefined();
    expect((await eslint.calculateConfigForFile('shared/src/draft/probe.ts')).rules['agent/no-unit-cast']).toEqual([2]);
    expect((await eslint.calculateConfigForFile('web-app/src/probe.test.ts')).rules['agent/no-unit-cast']).toEqual([2]);
  });
});

describe('domain clock', () => {
  function clockMessages(source) {
    return new Linter().verify(source, [{
      files: ['**/*.ts'], languageOptions: { parser: tseslint.parser },
      plugins: { agent }, rules: { 'agent/no-domain-clock': 'error' },
    }], { filename: 'shared/src/draft/probe.ts' });
  }
  it.each(['export function f(now = Date.now()) { return now; }', "const t = Date['now']();", 'const d = new Date();',
    'const t = globalThis.Date.now();', 'const d = new globalThis.Date();'])('rejects system time reads: %s', (source) => {
    expect(clockMessages(source)).toEqual([expect.objectContaining({ ruleId: 'agent/no-domain-clock', message: expect.stringContaining('systemClock') })]);
  });
  it('allows explicit times and the clock, and scopes the rule to shared domain code', async () => {
    expect(clockMessages('const d = new Date(now); const t = systemClock.now(); const p = Date.parse(text);')).toEqual([]);
    const eslint = new ESLint({ cwd: new URL('..', import.meta.url).pathname });
    for (const [filePath, expected] of [
      ['shared/src/sync.ts', [2]], ['shared/src/draft/probe.ts', [2]], ['shared/src/units/clock.ts', undefined],
      ['shared/src/http/runner.ts', undefined], ['shared/src/node/processes.ts', undefined], ['shared/src/sync.test.ts', undefined],
    ]) {
      expect((await eslint.calculateConfigForFile(filePath)).rules['agent/no-domain-clock'], filePath).toEqual(expected);
    }
  });
});

describe('closed shared root exports', () => {
  it.each([
    "import { Player as Local } from '@fantasy-draft/shared';",
    "import type { Player } from '@fantasy-draft/shared';",
    "import shared from '@fantasy-draft/shared';",
    "import '@fantasy-draft/shared';",
    "export { unknownName } from '@fantasy-draft/shared';",
    "export * as shared from '@fantasy-draft/shared';",
    "type Nested = import('@fantasy-draft/shared').unknownName.Nested;",
    "const shared = require('@fantasy-draft/shared');",
    "import shared = require('@fantasy-draft/shared');",
    "const shared = import(`@fantasy-draft/shared`);",
    "const shared = require(`@fantasy-draft/shared`);",
  ])('rejects every bare root form: %s', source => {
    const result = messages(source);
    expect(result).toEqual([expect.objectContaining({ ruleId: 'agent/no-closed-root-import', messageId: 'root' })]);
    for (const hint of ['/league', '/draft', '/catalog', '/sync', '/units', '/node', '/http', 'players', 'draft URLs']) {
      expect(result[0].message).toContain(hint);
    }
  });
  it.each(['web-app/__bench__/probe.ts', 'scripts/probe.mjs'])('checks closed names outside src in %s', async (filePath) => {
    const eslint = new ESLint({ cwd: new URL('..', import.meta.url).pathname });
    const results = await eslint.lintText("import { deriveDraft } from '@fantasy-draft/shared';", { filePath });
    expect(results[0].messages).toEqual([expect.objectContaining({ ruleId: 'agent/no-closed-root-import' })]);
  });
  it.each([
    ["type Roster = import('@fantasy-draft/shared/draft').Roster;", 'league'],
    ["import { createEmptyRoster } from '@fantasy-draft/shared/draft';", 'league'],
    ["export type { Roster as TeamRoster } from '@fantasy-draft/shared/draft';", 'league'],
  ])('names the replacement for %s', (source, target) => {
    expect(messages(source)).toEqual([expect.objectContaining({
      ruleId: 'agent/no-closed-root-import',
      message: expect.stringContaining(`/${target}`),
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
  it.each([
    "import { parseDraftRoomUrl } from '@fantasy-draft/shared/draft-url';",
    "type Status = import('@fantasy-draft/shared/draft-url').DraftRoomStatus;",
    "const url = import(`@fantasy-draft/shared/draft-url`);",
  ])('points temporary URL imports to sync: %s', source => {
    expect(messages(source)).toEqual([expect.objectContaining({
      ruleId: 'agent/no-closed-root-import', messageId: 'draftUrl',
      message: expect.stringContaining('@fantasy-draft/shared/sync'),
    })]);
  });
  it('allows namespace and type access to valid draft exports', () => {
    expect(messages("import * as draft from '@fantasy-draft/shared/draft'; type Pick = import('@fantasy-draft/shared/draft').DraftPick;")).toEqual([]);
  });
  it('allows contracts on their exact subpaths', () => {
    expect(messages("import type { Player } from '@fantasy-draft/shared/league'; import { DraftSyncEngine } from '@fantasy-draft/shared/sync';")).toEqual([]);
  });
});

describe('Effect import boundaries', () => {
  async function effectMessages(source, filePath) {
    const eslint = new ESLint({ cwd: new URL('..', import.meta.url).pathname });
    const config = await eslint.calculateConfigForFile(filePath);
    return new Linter().verify(source, [{
      files: ['**/*.{ts,tsx}'],
      languageOptions: { parser: tseslint.parser },
      rules: {
        'no-restricted-imports': config.rules['no-restricted-imports'] ?? 'off',
        'no-restricted-syntax': config.rules['no-restricted-syntax'] ?? 'off',
      },
    }], { filename: filePath });
  }

  it.each([
    'shared/src/player.ts', 'shared/src/limits.ts', 'shared/src/draft.ts',
    'shared/src/http/index.ts', 'shared/src/http/transport.ts', 'shared/src/league-settings.ts', 'shared/src/player-schema.ts', 'shared/src/league/index.ts', 'shared/src/draft/index.ts',
    'web-app/src/lib/pure-value.ts', 'scripts/src/model/pure-value.ts', 'server/src/pure-value.ts',
  ])('rejects the Effect barrel in %s with a concrete fix', async filePath => {
    expect(await effectMessages("import { Schema } from 'effect';", filePath)).toEqual([
      expect.objectContaining({ message: expect.stringContaining('Decode at the boundary: put Effect Schema in shared/src/catalog; leaf modules use plain predicates.') }),
    ]);
  });

  it.each([
    "export { Schema } from 'effect';", "export * from 'effect';",
    "import { Schema } from 'effect/Schema';", "const effect = import('effect');",
    "const effect = require('effect');",
    "const effect = import('effect/Effect');", "const effect = require('effect/Effect');",
    "const effect = import(`effect`);", "const effect = require(`effect/Effect`);",
  ])('rejects alternate dependency forms: %s', async source => {
    expect(await effectMessages(source, 'shared/src/player.ts')).toHaveLength(1);
  });

  it.each([
    'shared/src/catalog/decoders.ts', 'shared/src/catalog/nested/boundary.ts',
    'scripts/src/script-file-schemas.ts', 'scripts/src/contract-source-schema.ts',
    'server/src/sync-server.ts', 'scripts/src/effect-runtime.ts',
    'cli/src/run.ts', 'extension/src/background/background-controller.ts',
  ])('allows explicit decoder and I/O owners in %s', async filePath => {
    expect(await effectMessages("import { Schema } from 'effect';", filePath)).toEqual([]);
  });
});

describe('native fetch across host globals', () => {
  it.each(['self.fetch(url);', 'global.fetch(url);', 'globalThis.window.fetch(url);'])('rejects %s', source => {
    expect(messages(source)).toEqual([expect.objectContaining({ ruleId: 'agent/no-bare-fetch' })]);
  });
});
