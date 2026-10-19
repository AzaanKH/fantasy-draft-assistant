import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Guards shared's NodeNext configuration: consumers must load the built package
// under plain Node, and its types must actually resolve (not silently become `any`).
const SCRIPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('@fantasy-draft/shared package contract', () => {
  it('imports the built package under plain Node ESM resolution', () => {
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "const shared = await import('@fantasy-draft/shared'); console.log(typeof shared.DraftSyncEngine);",
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

  it('type-checks consumers under NodeNext and rejects nonexistent DraftSyncEngine methods', () => {
    const fileName = join(SCRIPTS_DIR, 'src', '__shared-contract-probe__.ts');
    const source = `
import { DraftSyncEngine } from '@fantasy-draft/shared';
const engine = new DraftSyncEngine('sleeper', 'draft-1');
engine.getSnapshot();
engine.notARealMethod();
`;
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
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.file?.fileName === fileName)
      .map((diagnostic) => ({
        code: diagnostic.code,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      }));

    expect(diagnostics).toEqual([
      {
        code: 2339,
        message: "Property 'notARealMethod' does not exist on type 'DraftSyncEngine'.",
      },
    ]);
  });
});
