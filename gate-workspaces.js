export const gateWorkspaces = [
  { directory: 'shared', globals: 'node', environment: 'node' },
  { directory: 'web-app', globals: 'browser', environment: 'node', testGlobals: true },
  { directory: 'server', globals: 'node', environment: 'node' },
  { directory: 'extension', globals: 'extension', environment: 'jsdom' },
  { directory: 'scripts', globals: 'node', environment: 'node' },
  { directory: 'cli', globals: 'node', environment: 'node' },
];

export const testPolicy = { restoreMocks: true, unstubGlobals: true, unstubEnvs: true };
