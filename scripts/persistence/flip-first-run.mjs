import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Processes } from '@fantasy-draft/shared/node';
import { createStaticHandler, inspectProductionBuild, verifyProductionHttp } from './ui-production.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = process.env.FLIP_OUTPUT;
assert(process.argv.includes('--browser-authorized'), 'Choose the opt-in first-run browser proof explicitly');
assert(out && path.isAbsolute(out), 'Set FLIP_OUTPUT to a fresh absolute evidence directory');
const run = async (command, args, label, cwd = root) => {
  try {
    const result = await Processes.run(command, args, { cwd, timeoutMs: 180000, maxOutputBytes: 2000000 });
    await writeFile(path.join(out, `${label}.log`), result.stdout + result.stderr);
    return result.stdout.trim();
  } catch (error) {
    await writeFile(path.join(out, `${label}.log`), String(error) + '\n' + (error.result?.stdout ?? '') + (error.result?.stderr ?? ''));
    throw error;
  }
};
await mkdir(out);
const head = await run('git', ['rev-parse', 'HEAD'], 'head');
assert.equal(head, process.env.FLIP_EXPECTED_HEAD, 'Use the authorized committed head');
assert.equal(await run('git', ['status', '--porcelain'], 'status-before'), '', 'Commit sources before first-run proof');
const requireScripts = createRequire(path.join(root, 'scripts/package.json'));
const { chromium } = requireScripts('playwright');
const { build } = await import(createRequire(path.join(root, 'web-app/package.json')).resolve('vite'));
const main = await run('git', ['rev-parse', 'origin/main'], 'main-revision');
const sources = [['main', main, 'fenced'], ['legacy', '8f1d26a621f4893f0c948f282e464573dd57b679', 'unfenced']];
const result = { head, started: new Date().toISOString(), sources, scenarios: [], readers: [], pageErrors: [] };
const save = () => writeFile(path.join(out, 'results.json'), JSON.stringify(result, null, 2));
const tsx = requireScripts.resolve('tsx/cli');
async function pinned(checkout, revision) {
  const tree = await run('git', ['ls-tree', '-r', revision, '--', 'web-app/src/stores', 'web-app/src/lib', 'shared/src'], `${revision}-tree`);
  const hash = createHash('sha256'); let files = 0;
  for (const row of tree.split('\n')) {
    const [, expected, file] = /^\d+ blob ([a-f0-9]{40})\t(.+)$/.exec(row);
    const bytes = await readFile(path.join(checkout, file));
    const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(actual, expected, `Pinned reader changed: ${file}`); hash.update(`${file}\0${actual}\n`); files++;
  }
  return { files, sha256: hash.digest('hex') };
}
let browser, server;
try {
  for (const [name, revision] of sources) {
    const checkout = path.join(root, `.local/flip-reader-${name}`);
    await mkdir(checkout, { recursive: true });
    const archive = path.join(out, `${name}.tar`);
    await run('git', ['archive', `--output=${archive}`, revision], `${name}-archive`);
    await run('tar', ['-xf', archive, '-C', checkout], `${name}-extract`);
    await run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], `${name}-install`, checkout);
    await run('pnpm', ['--filter', '@fantasy-draft/shared', 'build'], `${name}-shared-build`, checkout);
    result[name] = { checkout, source: await pinned(checkout, revision) };
    await run(process.execPath, [tsx, '--tsconfig', path.join(checkout, 'web-app/tsconfig.json'), '--conditions=@fantasy-draft/source', 'scripts/persistence/old-module-writer.mts', checkout, path.join(out, `${name}-bytes.json`)], `${name}-seed`);
  }
  server = createServer((request, response) => handler(request, response));
  let handler;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, origin = `http://localhost:${port}`;
  process.env.DRAFT_WEB_PORT = String(port); process.env.BROWSER_DATA_SOURCE = 'demo';
  delete process.env.VITE_PERSISTENCE_HARNESS; delete process.env.VITE_DEMO_MODE;
  browser = await chromium.launch({ headless: true });
  for (const mode of ['default', 'v1']) {
    if (mode === 'v1') process.env.VITE_STORAGE_ACTIVATION = 'v1';
    else delete process.env.VITE_STORAGE_ACTIVATION;
    const dist = path.join(out, `dist-${mode}`); let env;
    await build({ root: path.join(root, 'web-app'), configFile: path.join(root, 'web-app/vite.config.ts'), logLevel: 'error',
      build: { outDir: dist }, plugins: [{ name: 'flip-build-environment', configResolved(config) { env = config.env; } }] });
    assert.equal(env.VITE_STORAGE_ACTIVATION, mode === 'v1' ? 'v1' : undefined);
    const buildProof = mode === 'default' ? await inspectProductionBuild(dist, env) : undefined;
    handler = createStaticHandler({ dist, fixture: (_request, _response, next) => next() });
    const httpProof = buildProof ? await verifyProductionHttp(origin, buildProof) : undefined;
    for (const [name] of sources) {
      const fixture = JSON.parse(await readFile(path.join(out, `${name}-bytes.json`), 'utf8'));
      const context = await browser.newContext();
      try {
        const seed = mode === 'v1' ? JSON.parse(await readFile(path.join(out, `${name}-rollback.json`), 'utf8')).writes.map(({ key, serialized }) => [key, serialized]) : fixture.complete;
        await context.addInitScript(entries => {
          if (localStorage.getItem('flip-proof-seeded') === null) {
            for (const [key, value] of entries) localStorage.setItem(key, value);
            localStorage.setItem('flip-proof-seeded', 'true');
          }
          window.__flipOpened = [];
          const open = IDBFactory.prototype.open;
          IDBFactory.prototype.open = function (...args) { window.__flipOpened.push(args[0]); return open.apply(this, args); };
        }, seed);
        const page = await context.newPage();
        page.on('pageerror', error => result.pageErrors.push(error.message));
        await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline first-run proof"}' }));
        await page.goto(`${origin}/draft?provider=sleeper&draftId=123&position=2`);
        const v1 = () => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('fantasy-draft-session')).sort().map(key => [key, localStorage.getItem(key)]));
        if (mode === 'default') {
          const review = page.locator('[data-storage-activation="review"]'); await review.waitFor();
          assert((await review.innerText()).includes('sleeper 123'));
          const activate = page.getByRole('button', { name: 'Activate IndexedDB', exact: true });
          assert(await activate.isDisabled());
          assert.deepEqual(await v1(), [...fixture.complete].sort(([a], [b]) => a.localeCompare(b)));
          assert.equal(await page.evaluate(() => localStorage.getItem('fantasy-draft-storage-migrated')), null);
          await page.screenshot({ path: path.join(out, `${mode}-${name}-read-only.png`) });
          await page.getByRole('checkbox', { name: 'I have closed other draft tabs and side panels' }).check(); await activate.click();
          await review.waitFor({ state: 'detached' });
          await page.getByRole('button', { name: 'Draft workspace', exact: true }).waitFor();
          const captured = await page.evaluate(() => new Promise((resolve, reject) => {
            const open = indexedDB.open('fantasy-draft-workspace-v2'); open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result, tx = db.transaction(['sessions', 'metadata']);
              const sessions = tx.objectStore('sessions').getAll(), keys = tx.objectStore('sessions').getAllKeys();
              const metadata = tx.objectStore('metadata').getAll(), metadataKeys = tx.objectStore('metadata').getAllKeys();
              tx.oncomplete = () => { resolve({ sessions: sessions.result.map((value, index) => ({ key: keys.result[index], value })),
                metadata: metadata.result.map((value, index) => ({ key: metadataKeys.result[index], value })),
                entries: Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]) }); db.close(); };
              tx.onerror = () => reject(tx.error);
            };
          }));
          const imported = captured.sessions.find(row => row.key === 'sleeper:123')?.value;
          assert(imported, 'Missing imported draft');
          assert.deepEqual(imported.draftHistory, fixture.after.draftHistory);
          assert.deepEqual(imported.shortlistedPlayerIds, fixture.after.shortlistedPlayerIds);
          assert.deepEqual(imported.preloadedKeepers, fixture.after.preloadedKeepers);
          assert(captured.entries.some(([key]) => key === 'fantasy-draft-storage-migrated'));
          assert.deepEqual(await v1(), [...fixture.complete].sort(([a], [b]) => a.localeCompare(b)));
          const capturePath = path.join(out, `${name}-captured.json`), exportPath = path.join(out, `${name}-rollback.json`);
          await writeFile(capturePath, JSON.stringify(captured, null, 2));
          await run(process.execPath, [tsx, '--tsconfig', path.join(root, 'web-app/tsconfig.json'), '--conditions=@fantasy-draft/source', 'scripts/persistence/flip-rollback.mjs', capturePath, exportPath], `${name}-rollback`);
          await page.reload(); await page.getByRole('button', { name: 'Draft workspace', exact: true }).waitFor();
          assert.equal(await page.locator('[data-storage-activation="review"]').count(), 0);
          result.scenarios.push({ mode, name, env, httpProof, readOnlyBeforeConfirmation: true, exactV1BytesRetained: true, imported, tombstone: true, reloadResumed: true, rollbackFromCapturedProductionDatabase: exportPath });
        } else {
          await page.getByRole('button', { name: 'Draft workspace', exact: true }).waitFor();
          assert.equal(await page.locator('[data-storage-activation="review"]').count(), 0);
          const before = await v1();
          const add = page.getByRole('button', { name: /^Add .* to local shortlist$/ }).first(); await add.click();
          await page.waitForFunction(before => JSON.stringify(Object.keys(localStorage).filter(key => key.startsWith('fantasy-draft-session')).sort().map(key => [key, localStorage.getItem(key)])) !== before, JSON.stringify(before));
          assert.deepEqual(await page.evaluate(() => window.__flipOpened), []);
          assert.equal(await page.evaluate(() => localStorage.getItem('fantasy-draft-storage-migrated')), null);
          result.scenarios.push({ mode, name, env, seedIsActualRollbackOutput: true, v1Write: true, zeroIndexedDBOpens: true });
        }
        await page.screenshot({ path: path.join(out, `${mode}-${name}-active.png`) });
      } finally { await context.close(); }
    }
    for (const [name, revision, fencing] of sources) {
      const proof = path.join(out, `${mode}-${name}-reader.json`);
      await run(process.execPath, [tsx, '--tsconfig', path.join(result[name].checkout, 'web-app/tsconfig.json'), '--conditions=@fantasy-draft/source', 'scripts/persistence/flip-old-reader.mjs', result[name].checkout, path.join(out, `${name}-rollback.json`), proof, revision, mode, fencing], `${mode}-${name}-reader`);
      assert.deepEqual(await pinned(result[name].checkout, revision), result[name].source);
      result.readers.push(JSON.parse(await readFile(proof, 'utf8')));
    }
    await save();
  }
  assert.deepEqual(result.pageErrors, []);
  assert.equal(await run('git', ['rev-parse', 'HEAD'], 'head-after'), head);
  assert.equal(await run('git', ['status', '--porcelain'], 'status-after'), '');
  result.passed = true;
} catch (error) { result.fatal = error.stack ?? String(error); throw error; }
finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); result.finished = new Date().toISOString(); await save(); }
