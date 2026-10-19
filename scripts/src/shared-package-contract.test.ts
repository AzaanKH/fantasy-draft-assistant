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
  const subpaths = ['draft', 'catalog', 'league', 'node', 'sync', 'units'];

  it('rejects the root, temporary draft URL path and undeclared deep paths in plain Node', () => {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
const errors = [];
for (const path of ['', '/draft-url', '/draft/calculations/recommendations']) {
  try {
    await import('@fantasy-draft/shared' + path);
    errors.push('resolved');
  } catch (error) {
    errors.push(error.code);
  }
}
console.log(JSON.stringify(errors));
`], { cwd: SCRIPTS_DIR, encoding: 'utf8' });
    expect(JSON.parse(output)).toEqual(Array(3).fill('ERR_PACKAGE_PATH_NOT_EXPORTED'));
  });

  it('loads every exact subpath and every declared runtime export from built output', () => {
    const manifest = JSON.parse(readFileSync(join(SCRIPTS_DIR, '..', 'shared', 'package.json'), 'utf8'));
    expect(Object.keys(manifest.exports).sort()).toEqual(subpaths.map(subpath => `./${subpath}`).sort());
    expect(manifest).not.toHaveProperty('main');
    expect(manifest).not.toHaveProperty('types');
    const expected = Object.fromEntries(subpaths.map(subpath => {
      const source = readFileSync(join(SCRIPTS_DIR, '..', 'shared', 'src', subpath, 'index.ts'), 'utf8');
      const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
      const names = file.statements.flatMap(node =>
        ts.isExportDeclaration(node) && !node.isTypeOnly && node.exportClause && ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements.filter(element => !element.isTypeOnly).map(element => element.name.text)
          : []);
      return [subpath, names.sort()];
    }));
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
const exports = {};
for (const subpath of ${JSON.stringify(subpaths)}) {
  exports[subpath] = Object.keys(await import('@fantasy-draft/shared/' + subpath)).sort();
}
const sync = await import('@fantasy-draft/shared/sync');
console.log(JSON.stringify({ exports, route: sync.parseDraftRoomUrl('https://sleeper.com/draft/nfl/demo') }));
`], { cwd: SCRIPTS_DIR, encoding: 'utf8' });
    expect(JSON.parse(output)).toEqual({
      exports: expected,
      route: { isInDraftRoom: true, provider: 'sleeper', draftId: 'demo' },
    });
  });

  it('rejects root access in NodeNext and resolves every declared subpath contract', () => {
    const diagnostics = consumerDiagnostics(`
import type { Player } from '@fantasy-draft/shared';
import type * as Shared from '@fantasy-draft/shared';
import type { DraftRoomStatus } from '@fantasy-draft/shared/draft-url';
`);
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual([2307, 2307, 2307]);
    const source = subpaths.flatMap(subpath => {
      const source = readFileSync(join(SCRIPTS_DIR, '..', 'shared', 'src', subpath, 'index.ts'), 'utf8');
      const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
      return file.statements.flatMap(node =>
        ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements.map(element => `import type { ${element.name.text} as ${subpath}_${element.name.text} } from '@fantasy-draft/shared/${subpath}';`)
          : []);
    }).join('\n');
    expect(consumerDiagnostics(source)).toEqual([]);
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
