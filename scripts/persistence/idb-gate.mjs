import { failsGate } from './audit.mjs';
import { auditBlocked } from './blocked-adapter.mjs';

export function checkIdbGate(results) {
  const failures = [];
  if (results.metadata?.store !== 'idb' || results.metadata.suites !== 3 || results.metadata.seeds !== 5 || results.metadata.commandsPerActor !== 300) failures.push('Requires IDB with three suites, five seeds and 300 commands per actor');
  if (results.reloadBoundaryReplacements?.length !== 0) failures.push('Missing or nonempty document replacement ledger');
  if (failsGate(results)) failures.push('A durability, conflict, setup or browser invariant failed');
  const labels = ['tabs', 'extension-granted', 'extension-no-permission', 'hostname-split'];
  if (JSON.stringify(results.scenarios.map(s => s.label).sort()) !== JSON.stringify(labels.sort())) failures.push('Requires all four scenarios');
  for (const scenario of results.scenarios) {
    if (['tabs', 'extension-granted'].includes(scenario.label)) {
      if (scenario.runs.length !== 15 || new Set(scenario.runs.map(run => `${run.suite}:${run.seed}`)).size !== 15 || scenario.runs.some(run => run.issued.length !== 600)) failures.push(`${scenario.label}: incomplete 9,000-command schedule`);
      for (const kind of ['pick', 'move']) {
        const samples = scenario.conflicts.filter(row => row.kind === kind);
        if (samples.length < (kind === 'move' ? 100 : 20) || new Set(samples.map(row => row.sample)).size !== samples.length || samples.some(row => !row.checks.good)) failures.push(`${scenario.label}: incomplete or failed ${kind} samples`);
      }
      if (scenario.label === 'tabs' && (scenario.lifecycle?.length !== 2 || scenario.lifecycle.some(row => !row.after.events.some(event => event.type === 'focus' && event.trusted)))) failures.push('Missing bidirectional trusted focus proof');
      if (scenario.label === 'extension-granted' && (!scenario.noAppStartup?.noAppBefore || !scenario.noAppStartup.ready || scenario.noAppStartup.helperTabsAfter || !scenario.noAppStartup.receipt.receipt.accepted)) failures.push('Missing panel-alone helper proof');
    } else {
      if (!scenario.blocked) { failures.push(`${scenario.label}: missing blocked-workspace evidence`); continue; }
      const checks = auditBlocked(scenario.blocked.issued, scenario.blocked.before, scenario.blocked.after);
      if (checks.attempted !== 300 || checks.acknowledged || checks.rejected !== 300 || !checks.explicitSetupError || !checks.unchanged) failures.push(`${scenario.label}: failed blocked-workspace proof`);
    }
  }
  return { passes: failures.length === 0, failures };
}
