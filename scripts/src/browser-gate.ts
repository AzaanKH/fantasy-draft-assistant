/** Browser gate entry point. Every check uses isolated storage against one pre-warmed Vite and Chromium session. */
import { Effect } from 'effect';
import { chromium, type Browser } from 'playwright';
import { io, runMain } from './effect-runtime.js';
import { gateChecks, type GateCheck, type GateTier } from './browser-gate/checks.js';
import { CHECK_TIMEOUT_MS, GATE_WORKERS, ORIGIN } from './browser-gate/config.js';
import { gatePage, openPausedMockAssistant, runWithDeadline } from './browser-gate/harness.js';
import { GATE_MAX_RUN_MS, isConnectionFailure, isInfrastructureFailure, requireFreePorts, startGateServer, type GateServer } from './browser-gate/server.js';

const formatDuration = (ms: number): string => `${(ms / 1000).toFixed(2)}s`;
const webServer = Effect.acquireRelease(io(startGateServer), (server) => Effect.promise(() => server.stop()));
const browser = Effect.acquireRelease(io(() => chromium.launch({ headless: true })), (instance) => Effect.promise(() => instance.close()));

type Failure = { readonly label: string; readonly message: string; readonly infrastructure: boolean };

/** Load the lazy routes before workers start, letting Vite finish dependency discovery and optimization once. */
async function prewarm(instance: Browser): Promise<void> {
  await runWithDeadline(async () => {
    const page = await gatePage(instance, { viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(`${ORIGIN}/__visual/assistant?state=why`);
      await page.locator('html[data-visual-ready]').waitFor();
      await openPausedMockAssistant(page);
      await page.getByRole('tab', { name: 'Position tiers' }).click();
      await page.locator('.rec-tier-columns').waitFor();
      await page.evaluate(() => {
        window.history.pushState(null, '', '/sidepanel');
        window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      });
      await page.getByRole('navigation', { name: 'Side panel navigation' }).waitFor();
    } finally {
      await page.close();
    }
  }, CHECK_TIMEOUT_MS);
}

async function runTier({ tier, checks, instance, server, started }: {
  tier: GateTier; checks: readonly GateCheck[]; instance: Browser; server: GateServer; started: number;
}): Promise<readonly Failure[]> {
  const tierStarted = Date.now();
  const failures: Failure[] = [];
  const selected = checks.filter((check) => tier === 'full' || check.tier === 'smoke');
  console.log(`Starting ${tier}: ${String(selected.length)} checks, ${String(GATE_WORKERS)} workers.`);
  const run = async (check: GateCheck): Promise<void> => {
    const checkStarted = Date.now();
    const attempt = async (): Promise<string | null> => {
      try {
        await runWithDeadline(() => check.run(instance), CHECK_TIMEOUT_MS);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    let message: string | null;
    if (Date.now() - started >= GATE_MAX_RUN_MS) message = `not run: the gate passed its ${formatDuration(GATE_MAX_RUN_MS)} cap`;
    else if (!await server.healthy() && !await server.restart(`before "${check.label}"`)) message = 'not run: Vite is down and could not be restarted';
    else {
      message = await attempt();
      if (message !== null && isConnectionFailure(message) && !await server.healthy() && await server.restart(`during "${check.label}"`)) {
        console.error(`retry ${check.label} after the Vite restart`);
        message = await attempt();
      }
    }
    const infrastructure = message !== null && isInfrastructureFailure(message);
    console.log(`${message === null ? 'ok  ' : infrastructure ? 'INFRA' : 'FAIL'} [${tier}] ${check.label}${message === null ? '' : `: ${message}`} (${formatDuration(Date.now() - checkStarted)})`);
    if (message !== null) failures.push({ label: check.label, message, infrastructure });
  };
  // Only the built extension checks share filesystem state. Keep those outside the parallel browser checks.
  const pending = selected.filter((check) => !check.serial).values();
  await Promise.all(Array.from({ length: Math.min(GATE_WORKERS, selected.length) }, async () => {
    for (const check of pending) await run(check);
  }));
  for (const check of selected.filter((check) => check.serial)) await run(check);
  const assertions = failures.filter((failure) => !failure.infrastructure);
  const infrastructure = failures.filter((failure) => failure.infrastructure);
  console.log(`[${tier}] Ran ${String(selected.length)} check(s) in ${formatDuration(Date.now() - tierStarted)}; Vite restarts: ${String(server.restarts)}.`);
  for (const [name, group] of [['Assertion', assertions], ['Infrastructure', infrastructure]] as const) {
    if (group.length) console.log(`[${tier}] ${name} failures (${String(group.length)}):\n${group.map((failure) => `  - ${failure.label}: ${failure.message.split('\n')[0] ?? ''}`).join('\n')}`);
  }
  return failures;
}

const program = Effect.scoped(Effect.gen(function* () {
  const started = Date.now();
  const mode = process.env['BROWSER_GATE_TIER'] ?? 'full';
  if (mode !== 'full' && mode !== 'smoke' && mode !== 'tiered') return yield* Effect.fail(new Error('BROWSER_GATE_TIER must be smoke, full, or tiered'));
  const only = process.env['BROWSER_GATE_ONLY'] ? new RegExp(process.env['BROWSER_GATE_ONLY'], 'i') : null;
  const checks = gateChecks().filter((check) => !only || only.test(check.label));
  if (checks.length === 0 || (mode !== 'full' && !checks.some((check) => check.tier === 'smoke'))) return yield* Effect.fail(new Error('No checks selected for this tier'));
  yield* io(requireFreePorts);
  const server = yield* webServer;
  const instance = yield* browser;
  yield* io(() => prewarm(instance));
  console.log(`Vite and dependency pre-warm finished in ${formatDuration(Date.now() - started)}.`);
  let failures = yield* io(() => runTier({ tier: mode === 'full' ? 'full' : 'smoke', checks, instance, server, started }));
  if (mode === 'tiered' && failures.length > 0) {
    console.log('Smoke failed; escalating to full in the same Vite/browser session. The full result determines the exit status.');
    failures = yield* io(() => runTier({ tier: 'full', checks, instance, server, started }));
  }
  console.log(`Total browser gate wall time: ${formatDuration(Date.now() - started)}.`);
  if (failures.length) return yield* Effect.fail(new Error(`${String(failures.filter((failure) => !failure.infrastructure).length)} assertion and ${String(failures.filter((failure) => failure.infrastructure).length)} infrastructure failure(s)`));
  console.log('Browser gate passed.');
}));

runMain(program, 'Browser gate failed:');
