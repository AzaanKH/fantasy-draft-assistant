/**
 * Browser gate: renders every `/__visual/` fixture and walks a short draft flow in the
 * real app. It starts its own Vite dev server and never contacts a draft provider.
 * Needs `playwright install chromium`.
 *
 * By default the app runs on the checked-in demo data with IndexedDB storage, so the tier, geometry and
 * recommendation checks are never blocked by stale local data. `BROWSER_GATE_DATA=local` uses the local data
 * instead. Any console error or warning (React's included) fails the check that saw it.
 *
 * The checks live in `browser-gate/` by area; this file only runs them. BROWSER_GATE_ONLY=<regex> runs only the
 * checks whose label matches. BROWSER_GATE_MAX_MINUTES caps the whole run (default 240).
 */
import { Effect } from 'effect';
import { chromium } from 'playwright';
import { io, runMain } from './effect-runtime.js';
import { gateChecks } from './browser-gate/checks.js';
import { GATE_MAX_RUN_MS, isConnectionFailure, isInfrastructureFailure, requireFreePorts, startGateServer } from './browser-gate/server.js';

const formatDuration = (ms: number): string => `${String(Math.floor(ms / 60_000))}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`;

const webServer = Effect.acquireRelease(io(startGateServer), (server) => Effect.promise(() => server.stop()));

const browser = Effect.acquireRelease(
  io(() => chromium.launch({ headless: true })),
  (instance) => Effect.promise(() => instance.close()),
);

const program = Effect.scoped(Effect.gen(function* () {
  const started = Date.now();
  yield* io(requireFreePorts);
  const server = yield* webServer;
  const instance = yield* browser;
  const failures: { readonly label: string; readonly message: string; readonly infrastructure: boolean }[] = [];
  const only = process.env['BROWSER_GATE_ONLY'] ? new RegExp(process.env['BROWSER_GATE_ONLY'], 'i') : null;
  const checks = gateChecks().filter((check) => !only || only.test(check.label));

  for (const check of checks) {
    const outcome = yield* io(async (): Promise<string | null> => {
      if (Date.now() - started > GATE_MAX_RUN_MS) return `not run: the gate passed its ${formatDuration(GATE_MAX_RUN_MS)} cap`;
      // A server that died between checks is restarted before the next one, so later checks are not all refused.
      if (!await server.healthy() && !await server.restart(`before "${check.label}"`)) return 'not run: Vite is down and could not be restarted';
      const attempt = async (): Promise<string | null> => {
        try {
          await check.run(instance);
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      };
      const checkStarted = Date.now();
      let message = await attempt();
      // Refused because the server died during this check: restart it once and run the check again.
      if (message !== null && isConnectionFailure(message) && !await server.healthy() && await server.restart(`during "${check.label}"`)) {
        console.error(`retry ${check.label} after the Vite restart`);
        message = await attempt();
      }
      const status = message === null ? 'ok  ' : isInfrastructureFailure(message) ? 'INFRA' : 'FAIL';
      console.log(`${status} ${check.label}${message === null ? '' : `: ${message}`} (${formatDuration(Date.now() - checkStarted)})`);
      return message;
    });
    if (outcome !== null) failures.push({ label: check.label, message: outcome, infrastructure: isInfrastructureFailure(outcome) });
  }

  console.log(`Ran ${String(checks.length)} check(s) in ${formatDuration(Date.now() - started)}; Vite restarts: ${String(server.restarts)}.`);
  const infrastructure = failures.filter((failure) => failure.infrastructure);
  const assertions = failures.filter((failure) => !failure.infrastructure);
  // Environmental failures (server down, launch or navigation timeouts) are listed apart from real assertion failures.
  if (assertions.length > 0) console.log(`Assertion failures (${String(assertions.length)}):\n${assertions.map((failure) => `  - ${failure.label}: ${failure.message.split('\n')[0] ?? ''}`).join('\n')}`);
  if (infrastructure.length > 0) console.log(`Infrastructure failures (${String(infrastructure.length)}), not app defects; rerun them:\n${infrastructure.map((failure) => `  - ${failure.label}: ${failure.message.split('\n')[0] ?? ''}`).join('\n')}`);
  if (failures.length > 0) return yield* Effect.fail(new Error(`${String(assertions.length)} assertion and ${String(infrastructure.length)} infrastructure failure(s)`));
  console.log('Browser gate passed.');
}));

runMain(program, 'Browser gate failed:');
