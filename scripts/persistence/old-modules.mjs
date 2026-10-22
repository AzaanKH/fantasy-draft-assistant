import { Processes } from '@fantasy-draft/shared/node';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(process.env.PERSISTENCE_OUTPUT || path.join(root, 'artifacts/old-module-import'));
mkdirSync(out, { recursive: true });
async function run(args, cwd, label) {
  try {
    const result = await Processes.run(args[0], args.slice(1), { cwd, timeoutMs: 180_000, maxOutputBytes: 10_000_000 });
    writeFileSync(path.join(out, `${label}.log`), result.stdout + result.stderr);
  } catch (error) {
    writeFileSync(path.join(out, `${label}.log`), String(error) + '\n' + (error.result?.stdout ?? '') + (error.result?.stderr ?? ''));
    throw error;
  }
}
const sources = [['main', '8f1d26a621f4893f0c948f282e464573dd57b679', '.local/compat-main'], ['stack', '41debb3ccf175f6b5bbeef1806a1486043602635', '.local/verify-base']];
for (const [name, revision, directory] of sources) {
  const checkout = path.join(root, directory);
  mkdirSync(checkout, { recursive: true });
  const archive = path.join(out, `${name}-source.tar`);
  await run(['git', 'archive', `--output=${archive}`, revision], root, `${name}-archive`);
  await run(['tar', '-xf', archive, '-C', checkout], root, `${name}-extract`);
  await run(['pnpm', 'install', '--frozen-lockfile', '--prefer-offline'], checkout, `${name}-install`);
  await run(['pnpm', '--filter', '@fantasy-draft/shared', 'build'], checkout, `${name}-build`);
  const fixture = path.join(out, `${name}-bytes.json`);
  await run(['pnpm', '--filter', 'web-app', 'exec', 'tsx', '--tsconfig', path.join(checkout, 'web-app/tsconfig.json'), '--conditions=@fantasy-draft/source', path.join(root, 'scripts/persistence/old-module-writer.mts'), checkout, fixture], checkout, `${name}-writer`);
  await run(['pnpm', '--filter', 'web-app', 'exec', 'tsx', '--tsconfig', path.join(root, 'web-app/tsconfig.json'), '--conditions=@fantasy-draft/source', path.join(root, 'scripts/persistence/check-old-import.mts'), fixture, path.join(out, `${name}-import.json`)], root, `${name}-import`);
}
writeFileSync(path.join(out, 'sources.json'), JSON.stringify(sources.map(([source, revision]) => ({ source, revision })), null, 2));
