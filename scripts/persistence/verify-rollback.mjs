import { createHash } from 'node:crypto';
import { Processes } from '@fantasy-draft/shared/node';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/persistence/verify-rollback.mjs <export.json> <verification.json>. Run old-modules.mjs first.');
const exported = JSON.parse(await readFile(input, 'utf8'));
const readers = [['main', '8f1d26a621f4893f0c948f282e464573dd57b679', '.local/compat-main'], ['stack', '41debb3ccf175f6b5bbeef1806a1486043602635', '.local/compat-stack']];
const directory = path.dirname(path.resolve(output));
await mkdir(directory, { recursive: true });
async function pinnedSources(checkout, revision) {
  const tree = await Processes.run('git', ['ls-tree', '-r', revision, '--', 'web-app/src/stores', 'web-app/src/lib', 'shared/src'], { cwd: root, timeoutMs: 30000, maxOutputBytes: 1000000 });
  const digest = createHash('sha256'); let count = 0;
  for (const line of tree.stdout.trim().split('\n')) {
    const match = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    assert.ok(match, 'Unexpected pinned git tree row');
    const [, expected, file] = match; const bytes = await readFile(path.join(checkout, file));
    const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(actual, expected, `Pinned old source differs: ${file}`);
    digest.update(`${file}\0${actual}\n`); count++;
  }
  assert.ok(count > 20); return { digest: digest.digest('hex'), count };
}
const evidence = [];
for (const [name, revision, directory] of readers) {
  const checkout = path.join(root, directory);
  const source = await pinnedSources(checkout, revision);
  const resultPath = `${path.resolve(output)}.${name}.json`;
  const result = await Processes.run('pnpm', ['--filter', 'web-app', 'exec', 'tsx', '--tsconfig', path.join(checkout, 'web-app/tsconfig.json'), '--conditions=@fantasy-draft/source', path.join(root, 'scripts/persistence/check-rollback-reader.mts'), checkout, path.resolve(input), resultPath, revision], { cwd: checkout, timeoutMs: 120000, maxOutputBytes: 1000000 });
  await writeFile(`${resultPath}.log`, result.stdout + result.stderr);
  const proof = JSON.parse(await readFile(resultPath, 'utf8'));
  assert.equal(proof.revision, revision);
  assert.deepEqual(await pinnedSources(checkout, revision), source);
  assert.equal(proof.load, exported.expectedFactsDigest);
  assert.equal(proof.writeback, exported.expectedFactsDigest);
  assert.equal(proof.loadJournalsDigest, exported.expectedJournalsDigest);
  assert.equal(proof.writeJournalsDigest, exported.expectedJournalsDigest);
  evidence.push({ commit: revision, phase: 'load', factsDigest: proof.load, moduleDigest: source.digest, journalsDigest: proof.loadJournalsDigest }, { commit: revision, phase: 'writeback', factsDigest: proof.writeback, moduleDigest: source.digest, journalsDigest: proof.writeJournalsDigest });
}
await writeFile(output, JSON.stringify({ exportDigest: exported.digest, readers: evidence, verifiedAt: Date.now(), verifiedBy: 'scripts/persistence/verify-rollback.mjs' }, null, 2));
console.log(`Verified exact export ${exported.digest} with both pinned readers and writers`);
