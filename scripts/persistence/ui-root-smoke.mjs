import { auditSession, sessionPasses, auditMoveConflict, auditReconcileBurst, hasProductionProof, completeReceiptLedger } from './ui-adapter.mjs';
import { auditObservedConflict } from './ui-conflict.mjs';
import { workerResetPasses } from './ui-worker.mjs';
import { hasReadinessProof } from './ui-readiness.mjs';

export const ROOT_SMOKE_SCOPE = 'root-tier2-production-smoke';
/** Recovery counts only when a trusted focus reached the receiver after the sender's write was acknowledged. */
export function focusAfterAck(events, receipt) {
  const ackedAt = receipt?.startedAt + receipt?.ms;
  return Number.isFinite(ackedAt) && Array.isArray(events) && events.some(event => event.type === 'focus' && event.trusted && event.at > ackedAt);
}

export const ROOT_SMOKE_PLAN = Object.freeze({ tabs: Object.freeze([['pickConflict', 20], ['moveConflict', 20], ['reconcile', 1], ['lifecycle', 1]]),
  'extension-granted': Object.freeze([['setup', 1], ['slice', 1], ['pickConflict', 20], ['moveConflict', 20]]) });
export function panelSetupPasses(row) {
  if (!row) return false;
  const tab = new URL(row.canonicalAppTab), before = new URL(row.frameUrl), after = new URL(row.frameUrlAfter);
  return row.hostPermission === true && tab.origin === 'http://localhost:3000' && tab.pathname === '/draft' && !tab.searchParams.has('__storageProbe') &&
    [before, after].every(url => url.origin === tab.origin && url.pathname === '/sidepanel') && before.searchParams.get('__storageNonce') === row.nonceBefore && after.searchParams.get('__storageNonce') === row.nonceAfter &&
    row.runtime?.manifest?.manifest_version === 3 && workerResetPasses(row.workerReset) && !!row.nonceBefore && !!row.nonceAfter && row.nonceBefore !== row.nonceAfter &&
    row.before?.present && row.after?.present && JSON.stringify(row.before.picks) === JSON.stringify(row.after.picks) && JSON.stringify(row.before.queue) === JSON.stringify(row.after.queue);
}
const passesStep = (kind, row) => {
  switch (kind) {
    case 'pickConflict': return auditObservedConflict(row).good;
    case 'moveConflict': return auditMoveConflict(row).good;
    case 'reconcile': return row.issued.length === 120 && auditReconcileBurst(row).good;
    case 'lifecycle': return row.length === 2 && row.every(value => value.receipt?.outcome === 'ack' && value.focusRecovery?.proven && focusAfterAck(value.focusRecovery.events, value.receipt));
    case 'setup': return panelSetupPasses(row);
    case 'slice': return row.issued.length === 300 && row.issued.filter(value => value.actor === 'panel').length === 150 && row.issued.filter(value => value.actor === 'tab0').length === 150 && sessionPasses(auditSession(row), 300) && !row.notSavedVisible.some(Boolean);
    default: throw new Error(`Unknown root smoke step ${kind}`);
  }
};
export async function runRootSmokeSteps(label, operations, record) {
  if (!ROOT_SMOKE_PLAN[label]) throw new Error('Unexpected root smoke scenario');
  for (const [kind, count] of ROOT_SMOKE_PLAN[label]) for (let sample = 1; sample <= count; sample++) {
    const row = await operations[kind](sample);
    await record(kind, row, sample);
    if (!passesStep(kind, row)) throw new Error(`${label}: root smoke ${kind} ${sample} failed; STOP without retry`);
  }
}
export function evaluateRootSmoke(result) {
  const failures = [];
  try {
    const m = result.metadata;
    if (m.tier !== ROOT_SMOKE_SCOPE || !m.finished || !hasProductionProof(m)) failures.push('Missing exact production smoke scope or HTTP/build proof');
    if (!hasReadinessProof(m)) failures.push('Missing legitimate readiness fixture HTTP/league proof');
    if (!m.git?.clean || !/^[a-f0-9]{40}$/.test(m.expectedHead ?? '') || m.git.head !== m.expectedHead || m.gitEnd?.head !== m.expectedHead || m.gitEnd.status ||
        !m.sourceStable || !m.sourceHashes || JSON.stringify(m.sourceHashes) !== JSON.stringify(m.sourceHashesEnd)) failures.push('Smoke requires its frozen clean committed SHA');
    if ('gate' in result || m.commandsPerActor !== 150 || m.config?.perActor !== 150 || m.config?.control !== false || m.config?.bursts !== false || m.config?.lifecycle !== true || m.config?.burstPicksPerActor !== 60 || m.config?.suites !== 1 || m.config?.seeds !== 1 || m.config?.pickConflicts !== 20 || m.config?.moveConflicts !== 20) failures.push('Wrong fixed smoke workload');
    if (result.fatal || result.productionNavigationDefect || result.pageErrors.length || result.scenarioErrors.length || result.cleanupErrors.length) failures.push('Runner, navigation, page, scenario or cleanup error');
    if (JSON.stringify(result.scenarios.map(s => s.label)) !== JSON.stringify(Object.keys(ROOT_SMOKE_PLAN))) failures.push('Requires exactly tabs then installed iframe');
    for (const scenario of result.scenarios) {
      const plan = ROOT_SMOKE_PLAN[scenario.label]; if (!plan) { failures.push('Unrequested scenario'); continue; }
      const expected = plan.flatMap(([kind, count]) => Array.from({ length: count }, (_, i) => ({ kind, sample: i + 1 })));
      if (JSON.stringify(scenario.steps) !== JSON.stringify(expected)) failures.push(`${scenario.label}: incomplete or extra smoke steps`);
      for (const [kind, count] of plan) {
        const rows = kind === 'pickConflict' ? scenario.pickConflicts : kind === 'moveConflict' ? scenario.moveConflicts :
          kind === 'reconcile' ? [scenario.bursts.reconcile] : kind === 'lifecycle' ? [scenario.lifecycle] : kind === 'setup' ? [scenario.panelSetup] : scenario.runs;
        if (rows.length !== count || rows.some((row, index) => !passesStep(kind, row) || (['pickConflict', 'moveConflict'].includes(kind) && row.sample !== index + 1))) failures.push(`${scenario.label}: ${kind} evidence incomplete or failed`);
      }
      if (scenario.control || scenario.bursts.mock || (scenario.label === 'tabs' && scenario.runs.length) || (scenario.label === 'extension-granted' && (scenario.bursts.reconcile || scenario.lifecycle))) failures.push('Unrequested workload observed');
      if (!scenario.activation?.completed || !scenario.activation.readOnlyBeforeConfirm || !scenario.activation.importedAll || !scenario.activation.tombstoneAfter || scenario.activation.tombstoneBefore || !scenario.activation.buttonDisabledBeforeCheckbox || !scenario.activation.v1RetainedByteIdentical || !scenario.v1FinalSnapshot ||
          JSON.stringify(scenario.v1AtActivation.filter(([key]) => key.startsWith('fantasy-draft-session'))) !== JSON.stringify(scenario.v1FinalSnapshot.filter(([key]) => key.startsWith('fantasy-draft-session')))) failures.push('Activation or final v1 byte proof missing');
    }
    const moves = new Map(result.scenarios.flatMap(s => s.moveConflicts.map(row => [`${s.label}/${row.session}`, row])));
    const setups = result.commandLog.filter(row => row.cmd.id.startsWith('setup:'));
    if (setups.length !== 160 || setups.some(row => {
      const move = moves.get(`${row.scenario}/${row.session}`), index = Number(row.cmd.id.slice(6));
      return !move || !Number.isSafeInteger(index) || index < 0 || index > 3 || row.cmd.type !== 'queueAdd' || row.cmd.playerId !== move.original[index] || row.outcome !== 'ack';
    })) failures.push('Move setup receipts are incomplete or outside the authorized samples');
    if (result.commandLog.length !== 742 || result.commandStarts.length !== 742) failures.push('Requires exactly 742 case and slice receipts, with no unrequested workload');
    if (!completeReceiptLedger(result)) failures.push('Receipt ledger mismatch');
  } catch (error) { failures.push(`Incomplete raw smoke evidence: ${error.message}`); }
  return { passes: !failures.length, failures, scope: ROOT_SMOKE_SCOPE, fullMatrixClaim: false, nativeVisibility: 'OPEN' };
}
