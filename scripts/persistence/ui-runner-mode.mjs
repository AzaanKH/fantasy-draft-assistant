export function runnerMode(args) {
  const extensionSetupOnly = args.includes('--extension-setup-only');
  const rootTier2Smoke = args.includes('--root-tier2-smoke');
  const rootTier2Preflight = args.includes('--root-tier2-preflight');
  const scoped = ['--extension-setup-only', '--root-tier2-smoke', '--root-tier2-preflight'].filter(arg => args.includes(arg));
  if (scoped.length > 1 || (scoped.length && args.some(arg => ['--gate', '--tier2', '--smoke', '--focused-navigation', '--plan', '--fixture-check', '--prepare-production', '--disconnect-control', '--check'].includes(arg) || arg.startsWith('--scenarios=')))) {
    throw new Error('Dedicated scope cannot be combined with another runner scope');
  }
  return { extensionSetupOnly, rootTier2Smoke, rootTier2Preflight, workload: extensionSetupOnly || rootTier2Preflight ? { suites: 0, seeds: 0, perActor: 0, pickConflicts: 0, moveConflicts: 0,
    bursts: false, control: false, lifecycle: false, burstPicksPerActor: 0 } : rootTier2Smoke ? { suites: 1, seeds: 1, perActor: 150,
    pickConflicts: 20, moveConflicts: 20, bursts: false, control: false, lifecycle: true, burstPicksPerActor: 60 } : {} };
}
