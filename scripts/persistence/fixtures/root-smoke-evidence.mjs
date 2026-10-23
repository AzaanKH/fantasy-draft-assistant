import { readFile } from 'node:fs/promises';
import { planSession } from '../ui-adapter.mjs';
import { ROOT_SMOKE_PLAN, ROOT_SMOKE_SCOPE } from '../ui-root-smoke.mjs';
import { workerProtocol } from './worker-protocol.mjs';
import { resetExtensionWorker } from '../ui-worker.mjs';
import { FIXTURE_LEAGUE, READINESS_PATHS } from '../ui-readiness.mjs';

export async function rootSmokeEvidence() {
  const head = '1'.repeat(40), hash = 'a'.repeat(64), files = { 'index.html': hash, 'assets/app.js': hash };
  const env = { MODE: 'production', DEV: false, PROD: true, VITE_STORAGE_ACTIVATION: 'idb' };
  const sourceHashes = Object.fromEntries(Object.entries(files).map(([file, value]) => [`web-app/dist/${file}`, value]));
  const result = { metadata: { tier: ROOT_SMOKE_SCOPE, finished: 'done', expectedHead: head, git: { head, clean: true }, gitEnd: { head, status: '' },
    serve: 'production-static', resolvedEnv: env, productionBuild: { env, files, noViteClientOrHmr: true }, sourceHashes, sourceHashesEnd: sourceHashes, sourceStable: true,
    productionHttp: { verified: files, catalogFixtureSha256: hash, rejected: { '/@vite/client': 404, '/@react-refresh': 404, '/src/main.tsx': 404, '/node_modules/vite/dist/client/client.mjs': 404 } },
    catalogFixture: { sha256: hash }, commandsPerActor: 150, config: { suites: 1, seeds: 1, perActor: 150, pickConflicts: 20, moveConflicts: 20, control: false, bursts: false, lifecycle: true, burstPicksPerActor: 60 } },
    scenarios: [], commandStarts: [], commandLog: [], pageErrors: [], scenarioErrors: [], cleanupErrors: [] };
  const readinessFiles = Object.fromEntries(READINESS_PATHS.map(url => [url, hash]));
  result.metadata.readinessFixture = { leaguePreferences: FIXTURE_LEAGUE, files: readinessFiles };
  result.metadata.productionHttp.readinessFiles = readinessFiles;
  let serial = 0;
  const receipt = (label, session, cmd, outcome = 'ack', extra = {}) => {
    const row = { actionId: `row-${++serial}`, scenario: label, session, cmd, outcome, ...extra };
    result.commandLog.push(row); result.commandStarts.push({ actionId: row.actionId, scenario: label, session, cmd }); return row;
  };
  for (const label of Object.keys(ROOT_SMOKE_PLAN)) {
    const scenario = { label, steps: ROOT_SMOKE_PLAN[label].flatMap(([kind, count]) => Array.from({ length: count }, (_, i) => ({ kind, sample: i + 1 }))),
      activation: { completed: true, readOnlyBeforeConfirm: true, importedAll: true, tombstoneBefore: false, tombstoneAfter: true, buttonDisabledBeforeCheckbox: true, v1RetainedByteIdentical: true },
      v1AtActivation: [], v1FinalSnapshot: [], runs: [], pickConflicts: [], moveConflicts: [], bursts: {} };
    for (let sample = 1; sample <= 20; sample++) {
      const session = `conflict-${sample}`;
      const barrier = ['p1', 'p2'].map(player => ({ slot: '1', player, visible: true, disabled: false, alert: '', clicks: [] }));
      const alert = 'Pick 1 was just recorded elsewhere. Choose a pick.';
      const rows = barrier.map((before, index) => receipt(label, session, { id: `c:${index}`, slot: 1, playerId: before.player, type: 'pick' }, index ? 'rejected' : 'ack', {
        ...(index ? { alert, rejectionKind: 'invalidated-selection' } : {}), observations: { barrier: before, beforeClick: before,
          final: index ? { ...before, slot: '', disabled: true, alert } : { ...before, visible: false, clicks: [{ slot: '1', player: before.player, disabled: false }] } },
      }));
      scenario.pickConflicts.push({ sample, session, slot: 1, players: ['p1', 'p2'], barrier, results: rows, committed: { picks: [{ pickNumber: 1, playerId: 'p1' }] } });
      const moveSession = `move-${sample}`, original = ['a', 'b', 'c', 'd'];
      original.forEach((playerId, index) => receipt(label, moveSession, { id: `setup:${index}`, type: 'queueAdd', playerId }));
      const receipts = [0, 1].map(index => receipt(label, moveSession, { id: `move:${index}`, type: 'queueMove', playerId: 'b', offset: index ? 1 : -1 }));
      scenario.moveConflicts.push({ sample, session: moveSession, original, orders: [original, original], committedAfterReload: original, renderedAfterReload: [original, original], receipts, revisionBefore: 4, revisionAfter: 6 });
    }
    if (label === 'tabs') {
      const issued = Array.from({ length: 120 }, (_, i) => receipt(label, 'reconcile', { id: `b:${i}`, type: 'pick', slot: i + 1, playerId: `r${i}` }));
      const picks = issued.map(row => ({ pickNumber: row.cmd.slot, playerId: row.cmd.playerId, source: 'sleeper-api' }));
      scenario.bursts.reconcile = { issued, provider: picks, committed: { picks }, flippedAt: 36 };
      scenario.lifecycle = [0, 1].map(index => ({ sender: index, receipt: receipt(label, `life-${index}`, { id: 'lifecycle:add', type: 'queueAdd', playerId: 'life' }), focusRecovery: { proven: true }, nativeVisibility: { proven: false } }));
    } else {
      const plan = planSession(Array.from({ length: 300 }, (_, i) => ({ id: `p${i}`, name: `Player ${i}` })), 150);
      const issued = plan.actors.flatMap((commands, actor) => commands.map(cmd => receipt(label, 'slice', cmd, 'ack', { actor: actor ? 'panel' : 'tab0' })));
      const picks = plan.picks.map(cmd => ({ pickNumber: cmd.slot, playerId: cmd.playerId })), queue = plan.queue.map(cmd => cmd.playerId), committed = { present: true, picks, queue };
      scenario.runs.push({ issued, committed, committedBefore: committed, queueDom: { before: [queue, queue], after: [queue, queue] }, pickDom: { before: [picks, picks], after: [picks, picks] }, notSavedVisible: [false, false] });
      const trace = JSON.parse(await readFile(new URL('./worker-stop-without-close.json', import.meta.url), 'utf8'));
      const fixture = workerProtocol(trace); const workerReset = await resetExtensionWorker(fixture.ctxInfo, '1700000100009', fixture.options); await fixture.ctxInfo.worker.dispose();
      scenario.panelSetup = { hostPermission: true, canonicalAppTab: 'http://localhost:3000/draft', runtime: { manifest: { manifest_version: 3 } }, workerReset,
        frameUrl: 'http://localhost:3000/sidepanel?__storageNonce=first', frameUrlAfter: 'http://localhost:3000/sidepanel?__storageNonce=second', nonceBefore: 'first', nonceAfter: 'second',
        before: { present: true, picks: [], queue: [] }, after: { present: true, picks: [], queue: [] } };
    }
    result.scenarios.push(scenario);
  }
  return result;
}
