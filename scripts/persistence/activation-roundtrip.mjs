import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Processes } from '@fantasy-draft/shared/node';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (!process.argv.includes('--browser-authorized')) throw new Error('The parent must authorize this final-head rollback browser roundtrip');
const expectedHead = process.env.ROUNDTRIP_EXPECTED_HEAD;
assert.match(expectedHead ?? '', /^[0-9a-f]{40}$/, 'Set ROUNDTRIP_EXPECTED_HEAD to the parent-authorized committed SHA');
const actualHead = await Processes.run('git', ['rev-parse', 'HEAD'], { cwd: root, timeoutMs: 10000 });
assert.equal(actualHead.stdout.trim(), expectedHead, 'Rollback roundtrip is not on its authorized head');
const dirty = await Processes.run('git', ['status', '--porcelain'], { cwd: root, timeoutMs: 10000 });
assert.equal(dirty.stdout.trim(), '', 'Commit and freeze sources before the rollback browser roundtrip');
const out = path.resolve(process.env.ROUNDTRIP_OUTPUT || path.join(root, 'artifacts/activation-roundtrip'));
const fixtures = path.resolve(process.env.ROUNDTRIP_FIXTURES || path.join(out, '../old-modules'));
await mkdir(out, { recursive: false });
const requireWeb = createRequire(path.join(root, 'web-app/package.json'));
const { createServer } = await import(requireWeb.resolve('vite'));
const { chromium } = createRequire(path.join(root, 'scripts/package.json'))('playwright');
process.env.BROWSER_DATA_SOURCE = 'demo'; process.env.VITE_STORAGE_ACTIVATION = 'idb'; process.env.DRAFT_WEB_PORT = '3002';
delete process.env.VITE_PERSISTENCE_HARNESS; delete process.env.VITE_DEMO_MODE;
const origin = 'http://localhost:3002';
const oldRoot = path.join(root, '.local/compat-stack');
let old, server, browser;
const loadBearing = ['web-app/src/main.tsx','web-app/src/workspace/activation-entry.tsx','web-app/src/workspace/activation-storage.ts','web-app/src/workspace/indexed-db.ts','web-app/src/workspace/rollback-export.ts','web-app/src/workspace/operator-rollback.ts','web-app/src/workspace/durable-workspace.ts','web-app/src/workspace/indexed-workspace.ts','web-app/src/workspace/v1-import.ts','web-app/src/workspace/draft-reducer.ts','web-app/src/workspace/ui-dispatch.ts','web-app/src/hooks/useDraftSyncReconciliation.ts','web-app/src/hooks/useKeeperPreload.ts','web-app/src/stores/draft/pick-actions.ts','shared/src/sync/storage-activation.ts','scripts/persistence/activation-roundtrip.mjs','scripts/persistence/verify-rollback.mjs','scripts/persistence/check-rollback-reader.mts'];
const manifest = async () => Object.fromEntries(await Promise.all(loadBearing.map(async file => [file,createHash('sha256').update(await readFile(path.join(root,file))).digest('hex')])));
const report = { started: new Date().toISOString(), head: expectedHead, sourceHashes: await manifest(), scenarios: [], errors: [] };
const save = () => writeFile(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
async function run(command, args, cwd) {
  const result = await Processes.run(command, args, { cwd, timeoutMs: 180000, maxOutputBytes: 1000000 });
  return result.stdout + result.stderr;
}
function expectedFacts(value) {
  return { picks: [...value.draftHistory].sort((a,b)=>a.pickNumber-b.pickNumber), cursor: value.currentPick, keepers: value.preloadedKeepers,
    queue: value.shortlistedPlayerIds, manual: value.manualContinuityBaselineAt, confirmed: value.lastConfirmedPickNumber };
}
async function readDatabase(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('fantasy-draft-workspace-v2'); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result; const tx = db.transaction(['sessions', 'metadata']);
      const sessions = tx.objectStore('sessions').getAll(); const metadata = tx.objectStore('metadata').getAll();
      tx.oncomplete = () => { resolve({ sessions: sessions.result, metadata: metadata.result }); db.close(); }; tx.onerror = () => reject(tx.error);
    };
  }));
}
try {
  old = await createServer({ root: path.join(oldRoot, 'web-app'), configFile: path.join(oldRoot, 'web-app/vite.config.ts'), base: '/legacy/',
    server: { middlewareMode: true, hmr: false, watch: null, fs: { allow: [oldRoot], strict: false, deny: [] } }, appType: 'custom', plugins: [{ name: 'allow-extracted-old-modules', configResolved(config) { config.server.fs.deny = []; config.server.fs.strict = false; } }] });
  const html = `<!doctype html><html><body><button id="write">Record old pick</button><output id="receipt"></output><script type="module">
    import {createDraftStore,subscribeToBrowserStorageEvents} from '/legacy/src/stores/draftStore.ts';
    import {readDraftSessionChanges} from '/legacy/src/stores/draftSessionUnconfirmedSaves.ts';
    window.oldJournalsBeforeStore=readDraftSessionChanges(localStorage,{provider:'sleeper',draftId:'123'});
    const store=createDraftStore({storage:localStorage,session:{provider:'sleeper',draftId:'123'},externalChanges:subscribeToBrowserStorageEvents});
    store.getState().setSessionMode('live');window.oldStore=store;
    document.querySelector('#write').onclick=()=>{document.querySelector('#receipt').textContent=String(store.getState().recordProvisionalPick({pickNumber:6,playerId:'old-tab-attempt',playerName:'Old tab attempt',position:'WR',teamIndex:5,teamName:'Team 6'}));};
    window.oldReady=true;
  </script></body></html>`;
  server = await createServer({ root: path.join(root, 'web-app'), configFile: path.join(root, 'web-app/vite.config.ts'),
    server: { host: '127.0.0.1', port: 3002, strictPort: true, hmr: false, watch: null }, plugins: [{ name: 'old-module-browser-proof', configureServer(vite) {
      vite.middlewares.use((request,response,next) => {
        if (request.url === '/legacy-proof') { response.setHeader('Content-Type','text/html'); response.end(html); return; }
        if (request.url?.startsWith('/legacy/')) { old.middlewares(request,response,next); return; } next();
      });
    } }] });
  await server.listen(); browser = await chromium.launch({ headless: true });
  for (const name of ['main', 'stack']) for (const scenario of ['complete', 'retained-corrupt']) {
    const fixture = JSON.parse(await readFile(path.join(fixtures, `${name}-bytes.json`), 'utf8'));
    const source = scenario === 'complete' ? fixture.complete : [...fixture.retained, ['fantasy-draft-session-v1:sleeper:broken', '{"broken":']];
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push({name,scenario,message:error.message}));
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin && !url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname.startsWith('/api/')) return route.fulfill({status:503,contentType:'application/json',body:'{"error":"offline fixture"}'});
      return route.abort();
    });
    await page.goto(`${origin}/draft?provider=sleeper&draftId=123&position=2`);
    await page.getByRole('button',{name:'Activate IndexedDB',exact:true}).waitFor();
    await page.evaluate(entries=>{for(const [key,value] of entries)localStorage.setItem(key,value);},source);
    await page.reload(); await page.getByRole('button',{name:'Activate IndexedDB',exact:true}).waitFor();
    const legacy = await context.newPage(); await legacy.goto(`${origin}/legacy-proof`); await legacy.waitForFunction(()=>window.oldReady);
    const before = await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('fantasy-draft-session')).sort().map(key=>[key,localStorage.getItem(key)]));
    assert.equal(await page.evaluate(()=>localStorage.getItem('fantasy-draft-storage-migrated')),null);
    if (scenario === 'retained-corrupt') {
      const original = fixture.retained.find(([key]) => key.startsWith('fantasy-draft-session-unconfirmed-v1:'));
      assert.ok(original);
      const orphan = JSON.parse(original[1]); orphan.writeId = 'orphan-review'; orphan.baseWriteId = 'missing-base'; orphan.revision = 500;
      orphan.picks = [{pickNumber:6,before:null,after:{...orphan.picks[0].after,pickNumber:6,playerId:'retained-only',playerName:'Retained only',teamIndex:5,teamName:'Team 6'}}];
      await page.evaluate(([key,value])=>localStorage.setItem(key,value),['fantasy-draft-session-unconfirmed-v1:sleeper:123:orphan-review',JSON.stringify(orphan)]);
    }
    await page.reload(); await page.getByRole('button',{name:'Activate IndexedDB',exact:true}).waitFor();
    if (scenario === 'retained-corrupt') assert.ok(await page.locator('select[aria-label^="Resolve unresolved-journal:"]').count());
    for (;;) {
      const undecided = page.locator('select').filter({has: page.locator('option:checked[value=""]')});
      if (!await undecided.count()) break;
      const select = undecided.first(); const keep = await select.locator('option[value="keep-imported"]').count();
      await select.selectOption(keep ? 'keep-imported' : 'discard-entry'); await select.waitFor({state:'attached'});
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('select')).every(select=>!select.disabled));
    }
    await page.getByRole('checkbox').check(); await page.getByRole('button',{name:'Activate IndexedDB',exact:true}).click();
    try { await page.getByRole('button',{name:'Draft workspace',exact:true}).waitFor({timeout:10000}); }
    catch(error) { await writeFile(path.join(out,`${name}-${scenario}-failure.txt`),await page.locator('body').innerText()); await page.screenshot({path:path.join(out,`${name}-${scenario}-failure.png`)}); throw error; }
    await page.waitForFunction(()=>Boolean(window.draftStorageOperator));
    const imported = await readDatabase(page); const active = imported.sessions.find(row=>row.identity.draftId==='123'); assert.ok(active);
    if (scenario === 'retained-corrupt') assert.ok(JSON.stringify(imported.metadata).includes('orphan-review'));
    assert.deepEqual(expectedFacts(active),expectedFacts(fixture.after));
    const marker = await page.evaluate(()=>localStorage.getItem('fantasy-draft-storage-migrated')); assert.ok(marker);
    const bytesBeforeRefusal = await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('fantasy-draft-session')).sort().map(key=>[key,localStorage.getItem(key)]));
    await legacy.getByRole('button',{name:'Record old pick'}).click(); assert.equal(await legacy.locator('#receipt').innerText(),'false');
    assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('fantasy-draft-session')).sort().map(key=>[key,localStorage.getItem(key)])),bytesBeforeRefusal);

    await legacy.close();
    let exported = await page.evaluate(()=>window.draftStorageOperator.prepare({otherTabsClosed:true}));
    const exportPath = path.join(out,`${name}-${scenario}-export.json`); const verificationPath = path.join(out,`${name}-${scenario}-verification.json`);
    if (exported.reconciliation.pending.length) {
      const dialog = page.getByRole('dialog', { name: 'Review rollback entries' });
      for (const box of await dialog.getByRole('checkbox').all()) await box.check();
      const downloadPromise = page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'Export reconciled rollback', exact: true }).click();
      const download = await downloadPromise; await download.saveAs(exportPath);
      exported = JSON.parse(await readFile(exportPath, 'utf8'));
    } else await writeFile(exportPath,JSON.stringify(exported,null,2));
    assert.deepEqual(exported.reconciliation.pending, []);
    assert.ok(exported.journals.length > 0, 'Rollback must write actual retained v1 journals');
    const exportedJournals = exported.writes.filter(row=>row.key.startsWith('fantasy-draft-session-unconfirmed-v1:'));
    assert.deepEqual(exportedJournals, exported.journals.map(({key,serialized})=>({key,serialized})));
    assert.deepEqual(await page.evaluate(rows=>rows.map(({key})=>({key,serialized:localStorage.getItem(key)})),exportedJournals),exportedJournals);
    await page.reload(); await page.waitForFunction(()=>Boolean(window.draftStorageOperator));
    const proofLog = await run('node',['scripts/persistence/verify-rollback.mjs',exportPath,verificationPath],root);
    await writeFile(path.join(out,`${name}-${scenario}-proof.log`),proofLog);
    const verification = JSON.parse(await readFile(verificationPath,'utf8'));
    assert.equal(verification.readers.length,4);
    assert.ok(verification.readers.every(row=>row.journalsDigest===exported.expectedJournalsDigest));
    await page.evaluate(verification=>window.draftStorageOperator.finalize(verification,{otherTabsClosed:true,operator:'activation-roundtrip.mjs'}),verification);
    assert.equal(await page.evaluate(()=>localStorage.getItem('fantasy-draft-storage-migrated')),null);
    const reopened = await context.newPage(); await reopened.goto(`${origin}/legacy-proof`); await reopened.waitForFunction(()=>window.oldReady);
    const oldJournalLoad = await reopened.evaluate(()=>window.oldJournalsBeforeStore);
    assert.deepEqual(oldJournalLoad.map(({key,serialized})=>({key,serialized})).sort((a,b)=>a.key.localeCompare(b.key)),exportedJournals);
    assert.ok(JSON.stringify((await readDatabase(page)).metadata).includes(JSON.stringify(exportedJournals[0].serialized)), 'Exact journal originals must remain recoverable in IndexedDB');
    const restored = await reopened.evaluate(()=>({history:window.oldStore.getState().draftHistory,queue:window.oldStore.getState().shortlistedPlayerIds}));
    assert.deepEqual([...restored.history].sort((a,b)=>a.pickNumber-b.pickNumber),[...active.draftHistory].sort((a,b)=>a.pickNumber-b.pickNumber)); assert.deepEqual(restored.queue,active.shortlistedPlayerIds);
    await reopened.getByRole('button',{name:'Record old pick'}).click();assert.equal(await reopened.locator('#receipt').innerText(),'true');
    const oldJournalKeysAfterStore = await reopened.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('fantasy-draft-session-unconfirmed-v1:')).sort());
    report.scenarios.push({name,scenario,sourceKeys:source.length,readOnlyBeforeConfirm:true,imported:expectedFacts(active),oldTabFrozen:true,rollbackReaders:verification.readers,
      exportedJournals,oldJournalLoad,oldJournalKeysAfterStore,ordinaryStoreMayConsumeOrDeleteJournals:true,exactOriginalsRetainedInIndexedDB:true,
      tombstoneRemoved:true,v1WritesRestored:true,retainedMetadata:imported.metadata.length,before});
    await page.screenshot({path:path.join(out,`${name}-${scenario}.png`)}); await context.close(); await save();
  }
  assert.equal(report.scenarios.length,4);assert.deepEqual(report.errors,[]);report.endSourceHashes=await manifest();report.sourceStable=JSON.stringify(report.sourceHashes)===JSON.stringify(report.endSourceHashes);assert.equal(report.sourceStable,true);report.passed=true;
} catch(error){report.fatal=error.stack??String(error);throw error;}
finally{report.finished=new Date().toISOString();await save();await browser?.close();await server?.close();await old?.close();}
