import { readFile, writeFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'shared/src/league-settings.ts');
const declaration = path.join(root, 'shared/dist/league-settings.d.ts');
const original = await readFile(source, 'utf8');
const before = await stat(declaration);
const signature = 'export function createDefaultLeagueSettings(';
if (!original.includes(signature)) throw new Error('Update this probe for the current shared export.');
try {
  await writeFile(source, original.replace(signature, `${signature}_unit4RequiredProbe: never, `));
  const result = spawnSync('pnpm', ['typecheck'], { cwd: root, encoding: 'utf8' });
  const output = `${result.stdout}${result.stderr}`;
  process.stdout.write(output);
  if (result.status === 0 || !/TS(2554|2345)/.test(output) || !/(cli|web-app) typecheck:/.test(output)) {
    throw new Error('Expected consumer call-site failures from the changed shared source signature.');
  }
  if ((await stat(declaration)).mtimeMs !== before.mtimeMs) throw new Error('Typecheck rebuilt shared dist.');
  console.log('Consumer typecheck caught the source signature change without rebuilding shared dist.');
} finally {
  await writeFile(source, original);
}
