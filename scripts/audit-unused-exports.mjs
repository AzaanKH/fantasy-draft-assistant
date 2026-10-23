import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const refIndex = process.argv.indexOf('--ref');
const revision = refIndex < 0 ? null : execFileSync('git',
  ['rev-parse', '--verify', process.argv[refIndex + 1]], { encoding: 'utf8' }).trim();
const readSource = (file) => revision
  ? execFileSync('git', ['show', `${revision}:${file}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  : readFileSync(file, 'utf8');
const files = execFileSync('git', revision ? ['ls-tree', '-rz', '--name-only', revision] : ['ls-files', '-z'],
  { encoding: 'utf8' }).split('\0')
  .filter((file) => /\.[cm]?[jt]sx?$/.test(file) && !file.endsWith('.d.ts'));
const workspaces = [...readSource('pnpm-workspace.yaml').matchAll(/^\s*-\s*'([^']+)'/gm)]
  .map((match) => match[1]);
const packages = new Map(workspaces.map((workspace) => {
  const manifest = JSON.parse(readSource(`${workspace}/package.json`));
  return [manifest.name, { workspace, manifest }];
}));
const options = {
  allowJs: true, noEmit: true, jsx: ts.JsxEmit.ReactJSX,
  target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  baseUrl: root, paths: { '@/*': ['web-app/src/*'] },
};
const host = ts.createCompilerHost(options);
const readDependency = host.readFile;
const tracked = new Set(files);
const cache = new Map();
host.readFile = (file) => {
  const relative = path.relative(root, path.resolve(file));
  if (!revision || !tracked.has(relative)) return readDependency(file);
  if (!cache.has(relative)) cache.set(relative, readSource(relative));
  return cache.get(relative);
};
host.resolveModuleNames = (names, containingFile) => names.map((name) => {
  for (const [packageName, { workspace, manifest }] of packages) {
    if (name !== packageName && !name.startsWith(`${packageName}/`)) continue;
    const key = name === packageName ? '.' : `.${name.slice(packageName.length)}`;
    const entry = manifest.exports?.[key];
    const target = typeof entry === 'string' ? entry : entry?.import ?? entry?.default ?? manifest.module ?? manifest.main;
    if (typeof target === 'string') {
      const source = path.resolve(root, workspace, target.replace(/^\.\/dist\//, './src/').replace(/\.js$/, '.ts'));
      if (ts.sys.fileExists(source)) return { resolvedFileName: source, extension: ts.Extension.Ts };
    }
  }
  return ts.resolveModuleName(name, containingFile, options, host).resolvedModule;
});
const program = ts.createProgram(files, options, host);
const checker = program.getTypeChecker();
const canonical = (symbol) => symbol && (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
const sources = program.getSourceFiles().filter((source) => files.includes(path.relative(root, source.fileName)));
const isTest = (file) => /(?:^|\/)(?:__tests__|__fixtures__|test-fixtures)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
const references = new Map();
const localReferences = new Map();
const add = (symbol, file) => {
  if (!symbol) return;
  const locations = references.get(symbol) ?? new Set();
  locations.add(path.relative(root, file));
  references.set(symbol, locations);
};
for (const source of sources) {
  function visit(node) {
    if (ts.isExportDeclaration(node)) return;
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings &&
        ts.isNamespaceImport(node.importClause.namedBindings)) {
      const module = checker.getSymbolAtLocation(node.moduleSpecifier);
      if (module) for (const symbol of checker.getExportsOfModule(module)) add(canonical(symbol), source.fileName);
    }
    if (ts.isIdentifier(node)) {
      const symbol = canonical(checker.getSymbolAtLocation(node));
      add(symbol, source.fileName);
      if (symbol && !symbol.declarations?.some((decl) => decl.getSourceFile() === source &&
          node.pos >= decl.pos && node.end <= decl.end)) {
        const locations = localReferences.get(symbol) ?? new Set();
        locations.add(path.relative(root, source.fileName));
        localReferences.set(symbol, locations);
      }
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        ts.isStringLiteral(node.arguments[0])) {
      const module = checker.getSymbolAtLocation(node.arguments[0]);
      if (module) for (const symbol of checker.getExportsOfModule(module)) add(canonical(symbol), source.fileName);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const rows = [];
for (const source of sources) {
  const module = checker.getSymbolAtLocation(source);
  if (!module || isTest(source.fileName)) continue;
  for (const exported of checker.getExportsOfModule(module)) {
    const symbol = canonical(exported);
    const declaration = symbol?.declarations?.find((decl) => decl.getSourceFile() === source);
    if (!declaration) continue;
    const file = path.relative(root, source.fileName);
    const importers = [...(references.get(symbol) ?? [])].filter((importer) => importer !== file);
    rows.push({ file, symbol: exported.name, line: source.getLineAndCharacterOfPosition(declaration.getStart()).line + 1,
      usedLocally: localReferences.get(symbol)?.has(file) ?? false,
      productionImporters: importers.filter((importer) => !isTest(importer)).sort(),
      testImporters: importers.filter(isTest).sort() });
  }
}
const output = process.argv.includes('--all') ? rows : rows.filter((row) => row.productionImporters.length === 0);
console.log(JSON.stringify({ revision, workspaces, filesScanned: sources.length, exportsScanned: rows.length,
  exports: output.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line) }, null, 2));
