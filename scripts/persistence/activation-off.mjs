import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(path.join(root, 'scripts/package.json'))('playwright');
const out = path.resolve(process.env.PERSISTENCE_OUTPUT || path.join(root, 'artifacts/activation-off'));
await mkdir(out, { recursive: true });
const fixtures = JSON.parse(await readFile(path.join(out, '../old-modules/stack-bytes.json'), 'utf8'));
const reports = [];
const baseData = path.join(root, '.local/verify-base/web-app/dist/data');
const headData = path.join(root, 'web-app/dist/data');
async function fixturePaths(directory, prefix = '') {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) paths.push(...await fixturePaths(path.join(directory, entry.name), relative));
    else paths.push(relative);
  }
  return paths.sort();
}
const fixtureFiles = await fixturePaths(baseData);
assert.deepEqual(await fixturePaths(headData), fixtureFiles, 'Production parity requires matching fixture files');
for (const file of fixtureFiles) assert.deepEqual(await readFile(path.join(baseData, file)), await readFile(path.join(headData, file)), `Production parity fixture differs: ${file}`);
for (const [side, checkout] of [['base', path.join(root, '.local/verify-base')], ['head', root]]) {
  const dist = path.join(checkout, 'web-app/dist');
  const js = (await readdir(path.join(dist, 'assets'))).filter(name => name.endsWith('.js'));
  for (const file of js) {
    const text = await readFile(path.join(dist, 'assets', file), 'utf8');
    assert.ok(!text.includes('fantasy-draft-workspace-v2') && !text.includes('VITE_PERSISTENCE_HARNESS'), 'Production includes the inactive store');
  }
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (relative.split('/').includes('..')) { response.writeHead(403).end(); return; }
      const filename = path.join(dist, relative && path.extname(relative) ? relative : 'index.html');
      response.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.json') ? 'application/json' : 'text/html');
      response.end(await readFile(filename));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, ...(process.env.PERSISTENCE_EXECUTABLE ? { executablePath: process.env.PERSISTENCE_EXECUTABLE } : {}) });
  try {
    const context = await browser.newContext();
    await context.addInitScript(({ entries }) => {
      window.__openedDatabases = [];
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (...args) { window.__openedDatabases.push(args[0]); return open.apply(this, args); };
      Date.now = () => 1770000000000;
      let random = 1;
      Math.random = () => ((random++ * 7919) % 104729) / 104729;
      for (const [key, value] of entries) localStorage.setItem(key, value);
    }, { entries: fixtures.complete });
    const page = await context.newPage(); const errors = []; const fetched = new Set();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/data/')) fetched.add(url.pathname); });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.port === String(port)) return route.continue();
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"offline verification"}' });
      return route.abort();
    });
    await page.goto(`http://localhost:${port}/draft?provider=sleeper&draftId=123&position=2`);
    await page.getByRole('button', { name: 'Draft workspace', exact: true }).waitFor();
    await page.waitForLoadState('networkidle');
    const before = await page.evaluate(async () => ({ opened: window.__openedDatabases, databases: await indexedDB.databases(), entries: Object.keys(localStorage).filter(key => key.startsWith('fantasy-draft-session')).sort().map(key => [key, localStorage.getItem(key)]) }));
    const add = page.getByRole('button', { name: /^Add .* to local shortlist$/ }).first();
    await add.click();
    await page.waitForLoadState('networkidle');
    const after = await page.evaluate(() => ({ opened: window.__openedDatabases, entries: Object.keys(localStorage).filter(key => key.startsWith('fantasy-draft-session')).sort().map(key => [key, localStorage.getItem(key)]) }));
    assert.deepEqual(after.opened, [], 'Normal production session opened IndexedDB');
    assert.deepEqual(before.databases, [], 'Normal production session created a database');
    assert.notDeepEqual(after.entries, before.entries, 'The real production queue action did not write v1');
    assert.deepEqual(errors, []);
    reports.push({ side, jsFiles: js.length, before, after, fetchSet: [...fetched].sort(), errors });
    await page.screenshot({ path: path.join(out, `${side}.png`) });
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
assert.deepEqual(reports[0].before.entries, reports[1].before.entries, 'Production startup v1 bytes differ');
assert.deepEqual(reports[0].after.entries, reports[1].after.entries, 'Production queue-write v1 bytes differ');
assert.deepEqual(reports[0].fetchSet, reports[1].fetchSet, 'Demo data fetch set changed');
await writeFile(path.join(out, 'results.json'), JSON.stringify({ reports, activationOff: true, byteIdentical: true, demoFetchSetUnchanged: true }, null, 2));
