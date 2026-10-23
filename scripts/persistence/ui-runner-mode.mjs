export function runnerMode(args) {
  const extensionSetupOnly = args.includes('--extension-setup-only');
  const rootTier2Smoke = args.includes('--root-tier2-smoke');
  if ((extensionSetupOnly || rootTier2Smoke) && args.some(arg => ['--gate', '--tier2', '--smoke', '--focused-navigation', '--plan', '--fixture-check', '--prepare-production', '--disconnect-control', '--check', ...(rootTier2Smoke ? ['--extension-setup-only'] : ['--root-tier2-smoke'])].includes(arg) || arg.startsWith('--scenarios='))) {
    throw new Error('--extension-setup-only cannot be combined with another runner scope');
  }
  return { extensionSetupOnly, rootTier2Smoke, workload: extensionSetupOnly ? { suites: 0, seeds: 0, perActor: 0, pickConflicts: 0, moveConflicts: 0,
    bursts: false, control: false, lifecycle: false, burstPicksPerActor: 0 } : rootTier2Smoke ? { suites: 1, seeds: 1, perActor: 150,
    pickConflicts: 20, moveConflicts: 20, bursts: false, control: false, lifecycle: true, burstPicksPerActor: 60 } : {} };
}
