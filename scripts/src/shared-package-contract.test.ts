import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Guards shared's NodeNext configuration: consumers must load the built package
// under plain Node, and its types must actually resolve (not silently become `any`).
const SCRIPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function consumerDiagnostics(source: string): { code: number; message: string }[] {
  const fileName = join(SCRIPTS_DIR, 'src', '__shared-contract-probe__.ts');
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  };
  const baseHost = ts.createCompilerHost(options);
  const host: ts.CompilerHost = {
    ...baseHost,
    fileExists: (path) => path === fileName || baseHost.fileExists(path),
    readFile: (path) => (path === fileName ? source : baseHost.readFile(path)),
    getSourceFile: (path, languageVersion, ...rest) =>
      path === fileName
        ? ts.createSourceFile(path, source, languageVersion)
        : baseHost.getSourceFile(path, languageVersion, ...rest),
  };

  const program = ts.createProgram([fileName], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === fileName)
    .map((diagnostic) => ({
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    }));
}

describe('@fantasy-draft/shared package contract', () => {
  it('imports the built package under plain Node ESM resolution', () => {
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "const shared = await import('@fantasy-draft/shared'); console.log(typeof shared.isPlayer);",
      ],
      { cwd: SCRIPTS_DIR, encoding: 'utf8' }
    );

    expect(output.trim()).toBe('function');
  });

  it('loads the closed draft subpath without adding recommendation exports to the root', () => {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
const draft = await import('@fantasy-draft/shared/draft');
const root = await import('@fantasy-draft/shared');
let deepImportError;
try {
  await import('@fantasy-draft/shared/draft/calculations/recommendations');
} catch (error) {
  deepImportError = error.code;
}
console.log(JSON.stringify({
  recommendation: typeof draft.getRecommendationBoard,
  order: typeof draft.createSlotSequence,
  derive: typeof draft.deriveDraft,
  rootRecommendation: typeof root.getRecommendationBoard,
  deepImportError,
}));
`], { cwd: SCRIPTS_DIR, encoding: 'utf8' });

    expect(JSON.parse(output)).toEqual({
      recommendation: 'function',
      order: 'function',
      derive: 'function',
      rootRecommendation: 'undefined',
      deepImportError: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    });
  });

  it('loads catalog and draft URL exports without exposing them through the root', () => {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
const catalog = await import('@fantasy-draft/shared/catalog');
const { parseDraftRoomUrl } = await import('@fantasy-draft/shared/draft-url');
const draft = await import('@fantasy-draft/shared/draft');
const root = await import('@fantasy-draft/shared');
console.log(JSON.stringify({
  validator: typeof catalog.isPlayerIdentityFile,
  readiness: typeof catalog.buildDraftReadinessReport,
  mock: typeof draft.simulateCpuDraft,
  route: parseDraftRoomUrl('https://sleeper.com/draft/nfl/demo'),
  rootCatalog: typeof root.isPlayerIdentityFile,
  rootUrl: typeof root.parseDraftRoomUrl,
}));
`], { cwd: SCRIPTS_DIR, encoding: 'utf8' });

    expect(JSON.parse(output)).toEqual({
      validator: 'function',
      readiness: 'function',
      mock: 'function',
      route: { isInDraftRoom: true, provider: 'sleeper', draftId: 'demo' },
      rootCatalog: 'undefined',
      rootUrl: 'undefined',
    });
  });

  it('closes every completed wave runtime name on the root and loads its exact subpath', () => {
    const groups = {
      draft: [
        'isNeedPriority', 'isShadowRecommendationEvent', 'optimizeLineupUtility',
        'LIVE_RECOMMENDATION_ARCHITECTURE', 'createSlotSequence', 'deriveDraft',
      ],
      sync: [
        'isDraftSessionSummary', 'DraftSyncEngine', 'isDraftProvider', 'isDraftMetadata',
        'isEspnDraftSnapshot', 'isDraftSyncSnapshot', 'isDraftSyncUpdate',
        'isSleeperDraftMetadata', 'isSleeperDraftPick', 'isSleeperDraftPickList',
        'normalizeSleeperDraftMetadata', 'normalizeSleeperPick', 'resolveSleeperDraftLeagueId',
      ],
      units: [
        'MAX_DRAFT_TEAMS', 'MAX_DRAFT_ROUNDS', 'MAX_DRAFT_PICKS', 'MAX_ROSTER_SPOTS',
        'isBoundedInteger', 'isDraftSize',
      ],
      node: ['localDevPorts'],
      league: [
        'DEFAULT_ROSTER_REQUIREMENTS', 'createEmptyRoster', 'DEFAULT_SCORING_RULES',
        'createDefaultLeagueSettings', 'createLeagueSettings', 'isLeagueSettings',
        'isSleeperLeague', 'normalizeSleeperLeagueSettings', 'isRosterRequirements',
      ],
    };
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
const root = await import('@fantasy-draft/shared');
const failures = [];
for (const [target, names] of Object.entries(${JSON.stringify(groups)})) {
  const subpath = await import('@fantasy-draft/shared/' + target);
  for (const name of names) {
    if (name in root || !(name in subpath)) failures.push(target + '/' + name);
  }
}
console.log(JSON.stringify(failures));
`], { cwd: SCRIPTS_DIR, encoding: 'utf8' });
    expect(JSON.parse(output)).toEqual([]);
  });

  it('rejects all closed root names in NodeNext and resolves their subpath types', () => {
    const closed: Record<string, string> = JSON.parse(readFileSync(
      join(SCRIPTS_DIR, 'shared-closed-exports.json'), 'utf8'
    ));
    const entries = Object.entries(closed);
    const rootSource = entries.map(([name]) => `import type { ${name} } from '@fantasy-draft/shared';`).join('\n');
    const diagnostics = consumerDiagnostics(rootSource);
    expect(diagnostics).toHaveLength(entries.length);
    for (const [index, [name]] of entries.entries()) {
      expect(diagnostics[index]?.code).toBeOneOf([2305, 2724]);
      expect(diagnostics[index]?.message).toContain(name);
    }
    const subpathSource = entries.map(([name, subpath]) => `import type { ${name} } from '${subpath}';`).join('\n');
    expect(consumerDiagnostics(subpathSource)).toEqual([]);
  });

  it('closes duplicate roster exports on draft in Node and NodeNext', () => {
    const names = ['DEFAULT_ROSTER_REQUIREMENTS', 'createEmptyRoster', 'Roster', 'RosterRequirements'];
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
const draft = await import('@fantasy-draft/shared/draft');
console.log(JSON.stringify(${JSON.stringify(names)}.filter(name => name in draft)));
`], { cwd: SCRIPTS_DIR, encoding: 'utf8' });
    expect(JSON.parse(output)).toEqual([]);
    const diagnostics = consumerDiagnostics(names.map(name => `import type { ${name} } from '@fantasy-draft/shared/draft';`).join('\n'));
    expect(diagnostics).toHaveLength(names.length);
    for (const [index, name] of names.entries()) {
      expect(diagnostics[index]?.code).toBeOneOf([2305, 2724]);
      expect(diagnostics[index]?.message).toContain(name);
    }
  });

  it('type-checks consumers under NodeNext and rejects nonexistent DraftSyncEngine methods', () => {
    const source = `
import { DraftSyncEngine } from '@fantasy-draft/shared/sync';
const engine = new DraftSyncEngine('sleeper', 'draft-1');
engine.getSnapshot();
engine.notARealMethod();
`;
    const diagnostics = consumerDiagnostics(source);

    expect(diagnostics).toEqual([
      {
        code: 2339,
        message: "Property 'notARealMethod' does not exist on type 'DraftSyncEngine'.",
      },
    ]);
  });
});
