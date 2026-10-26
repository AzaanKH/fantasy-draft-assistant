import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import { gateWorkspaces } from '../gate-workspaces.js';
import { glob } from 'tinyglobby';
import { parse } from 'yaml';
import vitest from '../vitest.config.js';

const root = path.resolve(import.meta.dirname, '..');

export function validWorkspaceLint(command, directory) {
  if (typeof command !== 'string') return false;
  const words = command.trim().split(/\s+/);
  if (words[0] === 'pnpm') {
    words.shift();
    if (words[0] === 'exec') words.shift();
  }
  return words.length === 3 && words[0] === 'node' &&
    words[1] === '../scripts/lint.mjs' && words[2] === directory;
}

export async function checkWorkspaceGates() {
  const workspace = parse(await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8'));
  const manifests = await glob(workspace.packages.map((pattern) => `${pattern}/package.json`), {
    cwd: root, ignore: ['**/node_modules/**'],
  });
  const eslint = new ESLint({ cwd: root });
  const failures = [];
  for (const manifest of manifests) {
    const directory = path.dirname(manifest);
    const pkg = JSON.parse(await readFile(path.join(root, manifest), 'utf8'));
    for (const gate of ['lint', 'typecheck', 'test', 'build']) {
      if (typeof pkg.scripts?.[gate] !== 'string' || !pkg.scripts[gate].trim()) {
        failures.push(`Workspace ${pkg.name} has no ${gate} gate. Add a ${gate} script${gate === 'test' ? ' and include it in vitest projects' : ''}.`);
      }
    }
    if (!validWorkspaceLint(pkg.scripts?.lint, directory)) {
      failures.push(`Workspace ${pkg.name} lint must run scripts/lint.mjs for ${directory}. Use node ../scripts/lint.mjs ${directory}.`);
    }
    const files = await glob(`${directory}/src/**/*.{ts,tsx}`, { cwd: root });
    for (const file of [...files, `${directory}/src/__workspace_coverage_probe__.ts`]) {
      const config = await eslint.calculateConfigForFile(path.join(root, file));
      const rule = config?.rules?.['@typescript-eslint/no-unused-vars'];
      if (!rule || rule[0] !== 2) {
        failures.push(`Workspace ${pkg.name} file ${file} has no root ESLint coverage. Include ${directory}/src/**/*.{ts,tsx} in eslint.config.js.`);
      }
    }
    const projects = vitest.test.projects.filter((project) => project.root === path.join(root, directory));
    if (!projects.length) failures.push(`Workspace ${pkg.name} has no test project. Include it in vitest projects in vitest.config.js.`);
    for (const project of projects) {
      for (const policy of ['restoreMocks', 'unstubGlobals', 'unstubEnvs']) {
        if (project.test[policy] !== true) failures.push(`Workspace ${pkg.name} disables ${policy}. Use the shared test policy in vitest.config.js.`);
      }
    }
    const coveredTests = new Set();
    for (const project of projects) {
      const matched = await glob(project.test.include, { cwd: project.root, ignore: project.test.exclude });
      for (const file of matched) coveredTests.add(`${directory}/${file}`);
    }
    const tests = await glob(`${directory}/**/*.{test,spec}.{ts,tsx,js,mjs}`, { cwd: root, ignore: ['**/node_modules/**', '**/dist/**'] });
    for (const file of tests) {
      if (!coveredTests.has(file)) failures.push(`Workspace ${pkg.name} test ${file} is uncovered. Add its pattern to vitest projects in vitest.config.js.`);
    }
  }
  for (const { directory } of gateWorkspaces) {
    if (!manifests.includes(`${directory}/package.json`)) failures.push(`Gate workspace ${directory} is stale. Remove it from gate-workspaces.js or add it to pnpm-workspace.yaml.`);
  }
  if (!manifests.length) failures.push('No workspaces found. Correct packages in pnpm-workspace.yaml.');
  for (const failure of failures) console.error(failure);
  if (!failures.length) console.log(`Workspace gates cover all ${manifests.length} packages.`);
  return failures.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await checkWorkspaceGates();
}
