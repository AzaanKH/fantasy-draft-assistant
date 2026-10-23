export function runnerMode(args) {
  const extensionSetupOnly = args.includes('--extension-setup-only');
  if (extensionSetupOnly && args.some(arg => ['--gate', '--tier2', '--smoke', '--focused-navigation', '--plan', '--fixture-check', '--prepare-production', '--disconnect-control', '--check'].includes(arg) || arg.startsWith('--scenarios='))) {
    throw new Error('--extension-setup-only cannot be combined with another runner scope');
  }
  return { extensionSetupOnly, workload: extensionSetupOnly ? { suites: 0, seeds: 0, perActor: 0, pickConflicts: 0, moveConflicts: 0,
    bursts: false, control: false, lifecycle: false, burstPicksPerActor: 0 } : {} };
}
