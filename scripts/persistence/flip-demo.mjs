import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = process.env.FLIP_DEMO_OUTPUT;
assert(out && path.isAbsolute(out), 'Set FLIP_DEMO_OUTPUT to a fresh absolute evidence directory');
await mkdir(out);
const { chromium } = createRequire(path.join(root, 'scripts/package.json'))('playwright');
const browser = await chromium.launch({ headless: true });
const result = { origin: 'https://demo.example.test', errors: [], requests: [], blockedImages: [] };
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.__demoIDBOpens = [];
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args) { window.__demoIDBOpens.push(args[0]); return open.apply(this, args); };
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url()); result.requests.push(url.href);
    try {
      if (url.origin !== result.origin && route.request().resourceType() === 'image') {
        result.blockedImages.push(url.href); await route.abort(); return;
      }
      assert.equal(url.origin, result.origin, 'Hosted demo made a non-demo request');
      const relative = url.pathname === '/draft' ? 'index.html' : url.pathname.slice(1);
      assert(!relative.split('/').includes('..'));
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
      await route.fulfill({ body: await readFile(path.join(root, 'web-app/dist', relative)), contentType: types[path.extname(relative)] ?? 'application/octet-stream' });
    } catch (error) { result.errors.push(error.message); await route.abort(); }
  });
  const page = await context.newPage(); page.on('pageerror', error => result.errors.push(error.message));
  await page.goto(`${result.origin}/draft`);
  try { await page.locator('.draft-pool-footer').getByText(/players shown/).waitFor({ timeout: 15000 }); }
  finally { result.visibleText = await page.locator('body').innerText(); await page.screenshot({ path: path.join(out, 'hosted-demo.png') }); }
  assert.equal(await page.locator('[data-storage-activation]').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__demoIDBOpens), []);
  assert.deepEqual(result.errors, []);
  result.passed = true;
} catch (error) { result.failure = error.stack ?? String(error); process.exitCode = 1; }
finally { await browser.close(); await writeFile(path.join(out, 'results.json'), JSON.stringify(result, null, 2)); }
