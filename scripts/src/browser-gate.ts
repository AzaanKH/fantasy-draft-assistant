/**
 * Browser gate: renders every `/__visual/` fixture and walks a short draft flow in the
 * real app with the checked-in data. It starts its own Vite dev server and never
 * contacts a draft provider. Usage: `pnpm browser:gate` (needs `playwright install chromium`).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { chromium, type Browser, type Page } from 'playwright';
import { io, runMain } from './effect-runtime.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WEB_PORT = Number(process.env['BROWSER_GATE_PORT'] ?? 3100);
const API_PORT = WEB_PORT + 1;
const ORIGIN = `http://localhost:${String(WEB_PORT)}`;
const SERVER_START_TIMEOUT_MS = 60_000;
const MOCK_TIMEOUT_MS = 60_000;
const ASSISTANT_STATES = ['wait', 'compare', 'roster', 'why'] as const;
const DESKTOP = 1280;
const PHONE = 390;
/** Widths at which the readiness checklist must keep its copy readable. */
const NARROW_WIDTHS = [360, 390, 400] as const;

interface VisualCheck {
  readonly url: string;
  readonly widths: readonly number[];
}

const VISUAL_CHECKS: readonly VisualCheck[] = [
  { url: '/__visual/header?state=draft', widths: [DESKTOP, PHONE] },
  { url: '/__visual/header?state=assistant', widths: [DESKTOP, PHONE] },
  { url: '/__visual/board', widths: [DESKTOP] },
  ...ASSISTANT_STATES.map((state) => ({ url: `/__visual/assistant?state=${state}`, widths: [DESKTOP] })),
  { url: '/__visual/mobile/draft', widths: [PHONE] },
  ...ASSISTANT_STATES.map((state) => ({ url: `/__visual/mobile/assistant?state=${state}`, widths: [PHONE] })),
  ...(['idle', 'running', 'failed'] as const).map((refresh) => ({
    url: `/__visual/readiness?state=blocked&refresh=${refresh}`,
    widths: [DESKTOP, ...NARROW_WIDTHS],
  })),
  { url: '/__visual/readiness?state=ready', widths: [DESKTOP, PHONE] },
];

class GateFailure extends Error {}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new GateFailure(message);
}

/** Collects uncaught page errors and console errors while a check runs. */
function watchErrors(page: Page): () => readonly string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => { errors.push(error.message); });
  page.on('console', (message) => {
    // Requests the gate fails on purpose, and the absent API server, are not app errors.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text());
  });
  return () => errors;
}

async function assertNoPageOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 0, `${label}: page overflows horizontally by ${String(overflow)}px`);
}

/** Each checklist action sits on its own row below the copy, and the copy keeps the row's width. */
async function assertReadableChecklist(page: Page, label: string): Promise<void> {
  const items = await page.locator('.draft-setup-item').evaluateAll((elements) => elements.map((item) => {
    const body = item.querySelector('.draft-setup-body')?.getBoundingClientRect();
    const action = item.querySelector(':scope > .draft-setup-action, :scope > .draft-setup-actions')?.getBoundingClientRect();
    return { item: item.getBoundingClientRect().width, body: body && { width: body.width, bottom: body.bottom }, actionTop: action?.top };
  }));
  assert(items.length > 0, `${label}: no checklist items rendered`);
  for (const { item, body, actionTop } of items) {
    assert(body, `${label}: checklist item has no copy`);
    assert(body.width >= item * 0.8, `${label}: checklist copy is only ${String(Math.round(body.width))}px of a ${String(Math.round(item))}px row`);
    if (actionTop !== undefined) assert(actionTop >= body.bottom - 1, `${label}: checklist action shares a row with its copy`);
  }
}

async function checkVisualRoute(browser: Browser, check: VisualCheck, width: number): Promise<void> {
  const label = `${check.url} @ ${String(width)}px`;
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  try {
    const errors = watchErrors(page);
    await page.goto(`${ORIGIN}${check.url}`);
    await page.waitForSelector('html[data-visual-ready]', { timeout: 20_000 });
    const text = await page.locator('[data-visual-screen]').innerText();
    assert(!text.includes('Visual fixture not found'), `${label}: unknown fixture`);
    assert(text.trim().length > 0, `${label}: rendered an empty page`);
    assert(errors().length === 0, `${label}: ${errors().join('; ')}`);
    await assertNoPageOverflow(page, label);
    if (check.url.includes('state=blocked') && width < DESKTOP) await assertReadableChecklist(page, label);
  } finally {
    await page.close();
  }
}

function footerCount(text: string): number {
  return Number(/(\d+) players shown/.exec(text)?.[1] ?? NaN);
}

/**
 * Search, queue, mock picks and navigation in the real draft workspace. The checked-in
 * data is usually older than the live limit, which also covers browsing while advice is paused.
 */
async function checkDraftFlow(browser: Browser): Promise<void> {
  const page = await browser.newPage({ viewport: { width: DESKTOP, height: 900 } });
  try {
    const errors = watchErrors(page);
    await page.goto(`${ORIGIN}/draft`);
    const pool = page.locator('.draft-pool');
    const footer = pool.locator('.draft-pool-footer');
    await footer.getByText(/players shown/).waitFor({ timeout: 20_000 });
    const paused = await pool.locator('.draft-pool-paused').count() > 0;
    const total = footerCount(await footer.innerText());
    assert(total > 60, `Player pool shows ${String(total)} players; it should list the whole undrafted pool`);

    // A defense ranks far outside the 60-player recommendation shortlist.
    await pool.getByRole('button', { name: /^DEF/ }).click();
    const target = (await pool.locator('.draft-pool-name').first().innerText()).trim();
    await pool.getByRole('button', { name: /^All/ }).click();
    await pool.getByRole('textbox').fill(target);
    await pool.locator('.draft-pool-name', { hasText: target }).first().waitFor();
    assert(footerCount(await footer.innerText()) >= 1, `Search for ${target} found nothing`);

    const queue = pool.getByRole('button', { name: `Add ${target} to local shortlist` });
    await queue.click();
    const unqueue = pool.getByRole('button', { name: `Remove ${target} from local shortlist` });
    assert(await unqueue.getAttribute('aria-pressed') === 'true', `Queueing ${target} did not mark it queued`);
    await unqueue.click();
    await queue.waitFor();

    await page.getByRole('button', { name: 'Start mock', exact: true }).click();
    await page.getByRole('button', { name: 'Start mock draft' }).click();
    await page.getByRole('button', { name: 'To my pick' }).click();
    const draft = pool.getByRole('button', { name: `Draft ${target}` });
    await draft.and(page.locator(':enabled')).waitFor({ timeout: MOCK_TIMEOUT_MS });
    await draft.click();
    await pool.getByText('No available players match these filters.').waitFor();
    await page.locator('.draft-board').getByText(target).first().waitFor();

    await page.getByRole('button', { name: 'Assistant', exact: true }).first().click();
    await page.waitForURL(/\/assistant/);
    await page.locator('.rec-workspace').waitFor({ timeout: 20_000 });
    await page.goBack();
    await page.waitForURL(/\/draft/);
    await page.locator('.draft-board').getByText(target).first().waitFor();

    assert(errors().length === 0, `Draft flow: ${errors().join('; ')}`);
    console.log(`  draft flow: found, queued and drafted ${target} from ${String(total)} players${paused ? ' while advice was paused' : ''}`);
  } finally {
    await page.close();
  }
}

/** The real workspace on a phone: the setup checklist stays readable and nothing overflows. */
async function checkPhoneWorkspace(browser: Browser): Promise<void> {
  const page = await browser.newPage({ viewport: { width: PHONE, height: 844 } });
  try {
    await page.goto(`${ORIGIN}/draft`);
    await page.locator('.draft-pool-footer').getByText(/players shown/).waitFor({ timeout: 20_000 });
    if (await page.locator('.draft-setup-item').count() > 0) await assertReadableChecklist(page, 'Draft workspace @ 390px');
    await assertNoPageOverflow(page, 'Draft workspace @ 390px');
  } finally {
    await page.close();
  }
}

/**
 * A page that fails to load offers a way back while the draft state stays mounted,
 * and "Reload app" loads it once the network recovers.
 */
async function checkRouteFailure(browser: Browser): Promise<void> {
  const page = await browser.newPage({ viewport: { width: DESKTOP, height: 900 } });
  try {
    const assistantModule = '**/src/features/assistant/AssistantPage.tsx*';
    await page.route(assistantModule, (route) => route.abort());
    await page.goto(`${ORIGIN}/draft`);
    await page.getByRole('button', { name: 'Start mock', exact: true }).click();
    await page.getByRole('button', { name: 'Start mock draft' }).click();
    await page.getByRole('button', { name: 'CPU pick' }).click();
    const currentPick = await page.locator('.board-current-pick').first().innerText();
    await page.getByRole('button', { name: 'Assistant', exact: true }).first().click();
    await page.getByRole('alert').getByText('This page couldn’t load').waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Back to draft board' }).click();
    await page.locator('.draft-board').waitFor();
    const restoredPick = await page.locator('.board-current-pick').first().innerText();
    assert(restoredPick === currentPick, `Route failure lost draft state: ${currentPick} became ${restoredPick}`);

    await page.getByRole('button', { name: 'Assistant', exact: true }).first().click();
    await page.getByRole('alert').getByText('This page couldn’t load').waitFor({ timeout: 20_000 });
    // The browser keeps the failed module, so recovery is a reload that fetches it again.
    await page.unroute(assistantModule);
    await page.getByRole('button', { name: 'Reload app' }).click();
    await page.locator('.rec-workspace').waitFor({ timeout: 20_000 });
  } finally {
    await page.close();
  }
}

const isListening = async (): Promise<boolean> => {
  try {
    await fetch(ORIGIN);
    return true;
  } catch {
    return false;
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
const requireFreePorts = io(async () => {
  for (const port of [WEB_PORT, API_PORT]) {
    if (await acceptsConnections(port)) throw new Error(`Port ${String(port)} is already in use; stop that server or set BROWSER_GATE_PORT`);
  }
});

const waitForServer = (server: ChildProcess): Effect.Effect<void, Error> => io(async () => {
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite exited with code ${String(server.exitCode)}`);
    if (await isListening()) {
      if (server.exitCode !== null) throw new Error(`Vite exited with code ${String(server.exitCode)}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite did not start on ${ORIGIN}`);
});

const webServer = Effect.acquireRelease(
  Effect.sync(() => spawn('pnpm', ['--filter', 'web-app', 'exec', 'vite', '--port', String(WEB_PORT), '--strictPort'], {
    cwd: REPO_ROOT,
    // The API port points at nothing, so no request can reach a running sync server.
    env: { ...process.env, DRAFT_WEB_PORT: String(WEB_PORT), DRAFT_API_PORT: String(API_PORT) },
    // Its proxy logs every request to the absent API server, so output is dropped; a failed start shows as an exit code.
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  })),
  (server) => Effect.callback((resume: (effect: Effect.Effect<void>) => void) => {
    if (server.exitCode !== null || server.pid === undefined) {
      resume(Effect.void);
      return;
    }
    server.once('exit', () => { resume(Effect.void); });
    try {
      if (process.platform === 'win32') server.kill();
      else process.kill(-server.pid, 'SIGTERM');
    } catch {
      resume(Effect.void);
    }
  }),
);

const browser = Effect.acquireRelease(
  io(() => chromium.launch({ headless: true })),
  (instance) => Effect.promise(() => instance.close()),
);

const program = Effect.scoped(Effect.gen(function* () {
  yield* requireFreePorts;
  const server = yield* webServer;
  yield* waitForServer(server);
  const instance = yield* browser;
  const failures: string[] = [];
  const run = (label: string, check: () => Promise<void>) => io(check).pipe(
    Effect.tap(() => Effect.sync(() => { console.log(`ok   ${label}`); })),
    Effect.catch((error: Error) => Effect.sync(() => {
      failures.push(`${label}: ${error.message}`);
      console.error(`FAIL ${label}: ${error.message}`);
    })),
  );

  for (const check of VISUAL_CHECKS) {
    for (const width of check.widths) {
      yield* run(`${check.url} @ ${String(width)}px`, () => checkVisualRoute(instance, check, width));
    }
  }
  yield* run('draft workspace @ 390px', () => checkPhoneWorkspace(instance));
  yield* run('draft flow', () => checkDraftFlow(instance));
  yield* run('route failure fallback', () => checkRouteFailure(instance));

  if (failures.length > 0) return yield* Effect.fail(new Error(`${String(failures.length)} browser check(s) failed`));
  console.log('Browser gate passed.');
}));

runMain(program, 'Browser gate failed:');
