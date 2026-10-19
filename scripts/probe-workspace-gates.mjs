import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const workspaceFile = path.join(root, 'pnpm-workspace.yaml');
const packageFile = path.join(root, 'scripts/package.json');
const probe = path.join(root, '__unit4_workspace_probe__');
const originalWorkspace = await readFile(workspaceFile, 'utf8');
const originalPackage = await readFile(packageFile, 'utf8');
let created = false;
function check(expected) {
  const result = spawnSync(process.execPath, ['scripts/check-workspace-gates.mjs'], { cwd: root, encoding: 'utf8' });
  const output = `${result.stdout}${result.stderr}`;
  process.stdout.write(output);
  if (result.status !== 1 || !expected.every((message) => output.includes(message))) {
    throw new Error(`Expected coverage failure containing ${expected.join(', ')}`);
  }
}
try {
  const pkg = JSON.parse(originalPackage);
  for (const gate of ['lint', 'test', 'typecheck', 'build']) delete pkg.scripts[gate];
  await writeFile(packageFile, JSON.stringify(pkg));
  check(['has no lint gate', 'has no test gate', 'has no typecheck gate', 'has no build gate']);
  await writeFile(packageFile, originalPackage);
  await mkdir(probe);
  created = true;
  await writeFile(path.join(probe, 'package.json'), JSON.stringify({
    name: 'workspace-probe', scripts: { lint: 'eslint src', test: 'vitest run', typecheck: 'tsc', build: 'tsc' },
  }));
  await writeFile(workspaceFile, `${originalWorkspace}  - '__unit4_workspace_probe__'\n`);
  check(['workspace-probe', 'has no root ESLint coverage', 'has no test project']);
  console.log('Missing scripts and missing effective ESLint/Vitest coverage were rejected.');
} finally {
  await writeFile(packageFile, originalPackage);
  await writeFile(workspaceFile, originalWorkspace);
  if (created) await rm(probe, { recursive: true });
}
