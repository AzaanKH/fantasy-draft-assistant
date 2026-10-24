import { readFileSync, realpathSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { isEffectModule } from './effect-bundle-guard.ts';

const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
const fixHint = 'Keep shared/draft plain; move Effect decoding to the I/O boundary.';

export function checkDraftEffectFree({ root = path.resolve(import.meta.dirname, '../shared/dist'), entry = 'draft/index.js' } = {}) {
  const pending = [[path.resolve(root, entry)]];
  const visited = new Set();
  while (pending.length) {
    const chain = pending.pop();
    const file = chain.at(-1);
    if (visited.has(file)) continue;
    visited.add(file);
    let source;
    try {
      const actual = realpathSync(file);
      if (!actual.startsWith(realpathSync(root) + path.sep)) throw new Error('outside emitted package');
      source = ts.createSourceFile(file, readFileSync(actual, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    } catch {
      throw new Error(`Missing or unreadable emitted draft module ${chain.map(id => path.relative(root, id)).join(' -> ')}. Build shared before checking its complete import graph.`);
    }
    if (source.parseDiagnostics.length) throw new Error(`Cannot parse emitted module ${path.relative(root, file)}. Rebuild shared.`);
    const dependencies = [];
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) dependencies.push(node.moduleSpecifier);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
        if (node.arguments.length !== 1) throw new Error(`Unresolved emitted import in ${path.relative(root, file)}. ${fixHint}`);
        dependencies.push(node.arguments[0]);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    for (const dependency of dependencies) {
      if (!ts.isStringLiteralLike(dependency)) throw new Error(`Nonliteral emitted import in ${path.relative(root, file)} cannot prove an Effect-free closure. ${fixHint}`);
      const specifier = dependency.text;
      const display = [...chain.map(id => path.relative(root, id)), specifier].join(' -> ');
      if (isEffectModule(specifier)) throw new Error(`${display} imports Effect. ${fixHint}`);
      if (builtins.has(specifier.replace(/^node:/, ''))) continue;
      if (!specifier.startsWith('.')) throw new Error(`${display} is an unresolved external dependency. ${fixHint}`);
      pending.push([...chain, path.resolve(path.dirname(file), specifier)]);
    }
  }
  return visited.size;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(`Built shared/draft Effect-free graph passed (${checkDraftEffectFree()} emitted modules).`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
