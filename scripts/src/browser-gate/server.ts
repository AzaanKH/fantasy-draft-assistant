/**
 * Browser gate: the Vite dev server the checks run against. It lives as long as the run (with a generous overall
 * cap), not a fixed half hour, and a server that dies mid-run is restarted once so the remaining checks continue.
 */
import { http, HttpError } from '@fantasy-draft/shared/http';
import { Processes, type ProcessService } from '@fantasy-draft/shared/node';
import { createConnection } from 'node:net';
import { API_PORT, DATA_ENV, ORIGIN, REPO_ROOT, SERVER_START_TIMEOUT_MS, WEB_PORT } from './config.js';

/** The whole run may take this long (BROWSER_GATE_MAX_MINUTES); the server outlives it slightly so cleanup can finish. */
export const GATE_MAX_RUN_MS = Math.max(1, Number(process.env['BROWSER_GATE_MAX_MINUTES'] ?? 240)) * 60_000;
const SERVER_LIFETIME_MS = GATE_MAX_RUN_MS + 5 * 60_000;
/** Restarts allowed after the first start. */
const MAX_RESTARTS = 1;

const isListening = async (): Promise<boolean> => {
  try {
    await http.text(ORIGIN, { timeoutMs: 20_000, retries: 0, retryAfter: true });
    return true;
  } catch (error) {
    return error instanceof HttpError && error.kind === 'status';
  }
};

const acceptsConnections = (port: number): Promise<boolean> => new Promise((resolve) => {
  const socket = createConnection({ host: 'localhost', port });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => { resolve(false); });
});

/**
 * Fails if something already listens on the gate's web or API port, so checks never run
 * against another server and the app's API proxy never reaches a running sync server.
 */
export async function requireFreePorts(): Promise<void> {
  for (const port of [WEB_PORT, API_PORT]) {
    if (await acceptsConnections(port)) throw new Error(`Port ${String(port)} is already in use; stop that server or set BROWSER_GATE_PORT`);
  }
}

function startVite(): ProcessService {
  return Processes.service('pnpm', ['--filter', 'web-app', 'exec', 'vite', '--port', String(WEB_PORT), '--strictPort'], {
    cwd: REPO_ROOT,
    // The API port points at nothing, so no request can reach a running sync server.
    env: { ...process.env, ...DATA_ENV, DRAFT_WEB_PORT: String(WEB_PORT), DRAFT_API_PORT: String(API_PORT) },
    output: 'ignore', timeoutMs: SERVER_LIFETIME_MS,
  });
}

async function waitForServer(server: ProcessService): Promise<void> {
  const requireRunning = (): void => {
    const exit = server.exit;
    if (exit !== null) throw new Error(`Vite exited with code ${String(exit.code)}`);
  };
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    requireRunning();
    if (await isListening()) {
      requireRunning();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite did not start on ${ORIGIN}`);
}

export interface GateServer {
  /** Whether the server process is alive and answering. */
  healthy(): Promise<boolean>;
  /** Starts a fresh server when the current one died; false when the restart allowance is spent or it fails. */
  restart(reason: string): Promise<boolean>;
  readonly restarts: number;
  stop(): Promise<void>;
}

export async function startGateServer(): Promise<GateServer> {
  let current = startVite();
  try {
    await waitForServer(current);
  } catch (error) {
    await current.stop();
    throw error;
  }
  let restarts = 0;
  return {
    get restarts() { return restarts; },
    async healthy() {
      return current.exit === null && await isListening();
    },
    async restart(reason) {
      if (restarts >= MAX_RESTARTS) return false;
      restarts += 1;
      console.error(`Vite is not answering (${reason}); restarting it (${String(restarts)} of ${String(MAX_RESTARTS)}).`);
      await current.stop();
      current = startVite();
      try {
        await waitForServer(current);
        return true;
      } catch (error) {
        console.error(`Vite restart failed: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    },
    stop: () => current.stop(),
  };
}

/** A failure that came from the environment (the server went away), not from an assertion. */
export function isConnectionFailure(message: string): boolean {
  return /ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|ECONNREFUSED|net::ERR_ABORTED/.test(message);
}

/**
 * A failure the environment caused rather than the app: the server went away, the browser could not launch or
 * closed, a check was not run, or a navigation never got a response. Everything else is an assertion failure.
 */
export function isInfrastructureFailure(message: string): boolean {
  return isConnectionFailure(message)
    || /^not run:|browserType\.launch|Target page, context or browser has been closed|Browser has been closed|page\.goto: Timeout|net::ERR_(?:CONNECTION|EMPTY|ABORTED|NAME_NOT_RESOLVED)|Vite (?:exited|did not start|is down)/.test(message);
}
