import { hasProductionProof } from './ui-adapter.mjs';
import { panelSetupPasses } from './ui-root-smoke.mjs';
import { hasReadinessProof } from './ui-readiness.mjs';

export const PREFLIGHT_SCOPE = 'root-tier2-reachability';
export const PREFLIGHT_PLAN = { tabs: ['conflict', 'move', 'reconcile', 'lifecycle-sender0', 'lifecycle-sender1'],
  'extension-granted': ['setup', 'slice', 'conflict', 'move'] };

export function assertNoPreflightWorkload(result) {
  if (result.commandStarts.length || result.commandLog.length) throw new Error('Reachability requires zero workload commands and zero receipts');
}
export function assertWorkloadAllowed(preflight) {
  if (preflight) throw new Error('Reachability cannot issue a workload command');
}
export async function inspectControl(locator, name) {
  await locator.waitFor({ state: 'visible', timeout: 15000 });
  const visible = await locator.isVisible(), enabled = await locator.isEnabled();
  if (!visible || !enabled) throw new Error(`${name}: ${visible ? 'disabled' : 'not visible'}`);
  return { name, visible, enabled };
}
export async function inspectAssistantMoves(ctx, name) {
  await ctx.getByRole('heading', { name: 'Your queue', exact: true }).waitFor({ timeout: 15000 });
  return Promise.all(['up', 'down'].map(direction => {
    const label = `Move ${name} ${direction} in queue`;
    return inspectControl(ctx.getByRole('button', { name: label, exact: true }), label);
  }));
}

export async function runReconcilePhases(commands, run, recover) {
  const first = (await Promise.all(commands.map((rows, actor) => run(rows.slice(0, 18), actor)))).flat();
  if (first.length !== 36 || first.some(row => row.outcome !== 'ack')) throw new Error('Reconcile burst failed before recovery; preserve original receipts');
  await recover(first.length);
  const remaining = (await Promise.all(commands.map((rows, actor) => run(rows.slice(18), actor)))).flat();
  return [...first, ...remaining];
}

export function evaluateReachability(result) {
  const failures = [];
  try {
    assertNoPreflightWorkload(result);
    const m = result.metadata;
    if (m.tier !== PREFLIGHT_SCOPE || !m.finished || m.smoke !== false || !hasProductionProof(m)) failures.push('Missing production reachability scope or build/HTTP proof');
    if (!hasReadinessProof(m)) failures.push('Missing legitimate readiness fixture HTTP/league proof');
    if (!/^[a-f0-9]{40}$/.test(m.expectedHead) || !m.sourceStable || !m.git.clean || m.git.head !== m.expectedHead || m.gitEnd.head !== m.expectedHead || m.gitEnd.status ||
        JSON.stringify(m.sourceHashes) !== JSON.stringify(m.sourceHashesEnd)) failures.push('Reachability requires a frozen clean exact head');
    if (result.fatal || result.productionNavigationDefect || result.pageErrors.length || result.scenarioErrors.length || result.cleanupErrors.length ||
        'gate' in result || 'rootSmoke' in result) failures.push('Reachability errors or workload claim');
    if (m.commandsPerActor !== 0 || m.plan?.sessionCommands !== 0 || ['suites', 'seeds', 'perActor', 'pickConflicts', 'moveConflicts', 'burstPicksPerActor'].some(key => m.config[key] !== 0) ||
        ['bursts', 'control', 'lifecycle'].some(key => m.config[key] !== false)) failures.push('Reachability workload configuration must be zero');
    if (JSON.stringify(result.scenarios.map(row => row.label)) !== JSON.stringify(Object.keys(PREFLIGHT_PLAN))) failures.push('Both ordinary tabs and installed iframe must be inspected');
    for (const scenario of result.scenarios) {
      if (scenario.runs.length || scenario.pickConflicts.length || scenario.moveConflicts.length || Object.keys(scenario.bursts).length || scenario.lifecycle) failures.push('Workload evidence cannot masquerade as reachability');
      if (JSON.stringify(scenario.reachability.map(row => row.kind)) !== JSON.stringify(PREFLIGHT_PLAN[scenario.label])) failures.push('Incomplete reachability controls');
      if (!scenario.activation?.completed || !scenario.activation.v1RetainedByteIdentical || !scenario.v1FinalSnapshot ||
          JSON.stringify(scenario.v1AtActivation.filter(([key]) => key.startsWith('fantasy-draft-session'))) !== JSON.stringify(scenario.v1FinalSnapshot.filter(([key]) => key.startsWith('fantasy-draft-session')))) failures.push('Activation or v1 retention missing');
      for (const row of scenario.reachability) {
        if (row.kind === 'setup') { if (!panelSetupPasses(row.proof) || row.proof.openControl?.name !== 'Open local workspace' || !row.proof.openControl.visible || !row.proof.openControl.enabled) failures.push('Installed iframe setup failed'); }
        else {
          const count = row.kind === 'move' || row.kind === 'slice' ? 4 : 2;
          if (row.controls?.length !== count || row.controls.some(value => !value.name || !value.visible || !value.enabled)) failures.push(`${row.kind}: unavailable first command control`);
          if (['conflict', 'slice', 'reconcile'].includes(row.kind) && (row.barrier?.length !== 2 || row.commands?.length !== 2 || row.barrier.some((value, index) =>
            value.slot !== String(row.commands[index].slot) || value.player !== row.commands[index].playerId || value.disabled || !value.visible || value.clicks.length))) failures.push('Pick controls did not select the intended preflight commands');
          if (['conflict', 'slice', 'reconcile'].includes(row.kind) && row.controls.slice(0, 2).some(value => value.name !== 'Record Provisional Pick')) failures.push('Missing Record controls');
          if (row.kind === 'move' && (row.seedQueue?.length !== 4 || row.controls.some((value, index) => !new RegExp(`^Move .+ ${index % 2 ? 'down' : 'up'} in queue$`).test(value.name)))) failures.push('Move setup did not expose the actual Assistant controls');
          if (row.kind === 'slice' && (row.plannedSlice?.total !== 300 || row.plannedSlice.perActor !== 150 || row.commands[0].slot !== 1 || row.commands[1].slot !== 76 ||
              row.controls.slice(2).some(value => !/^Add .+ to local shortlist$/.test(value.name)))) failures.push('Slice preflight must inspect exactly the 150-per-actor plan');
          if (row.kind.startsWith('lifecycle') && (row.senderSession === row.receiverSession || !row.senderSession || !row.receiverSession ||
              !/^Add .+ to local shortlist$/.test(row.controls[0].name) || !/^Remove .+ from local shortlist$/.test(row.controls[1].name))) failures.push('Lifecycle requires explicit sender and queued-receiver fixture selectors');
        }
        if (row.kind === 'reconcile' && (!row.restoredWithoutDialog || !row.recovery?.noOpenDialogs || !row.recovery.manualControlsAbsent ||
            row.recovery.committed.manualContinuityBaselineAt !== null || !(row.recovery.committed.lastConfirmedSyncAt > 0))) failures.push('Provider recovery did not retire manual controls');
      }
    }
  } catch (error) { failures.push(error.message); }
  return { passes: !failures.length, failures, scope: PREFLIGHT_SCOPE, workloadCommands: result.commandStarts.length,
    consumed: false, fullMatrixClaim: false, smokeClaim: false, nativeVisibility: 'OPEN' };
}
