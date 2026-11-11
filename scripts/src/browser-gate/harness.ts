/**
 * Browser gate helpers shared by every area: pages with the esbuild name shim, assertions, console watching and common app steps.
 */
import { type Browser, type BrowserContext, type Page } from 'playwright';
import { MOCK_TIMEOUT_MS, ORIGIN, THEMES, type GateTheme } from './config.js';

/**
 * tsx compiles this file with esbuild's keepNames, which wraps named functions in `__name(...)`. Callbacks passed to
 * page.evaluate are serialized with that call inside, so the page needs a no-op `__name` before any evaluate runs.
 */
export const NAME_SHIM = 'globalThis.__name = globalThis.__name || ((target) => target);';

export async function gatePage(browser: Browser, options: Parameters<Browser['newPage']>[0]): Promise<Page> {
  const page = await browser.newPage(options);
  await page.addInitScript(NAME_SHIM);
  return page;
}

export async function gateContext(browser: Browser, options: Parameters<Browser['newContext']>[0]): Promise<BrowserContext> {
  const context = await browser.newContext(options);
  await context.addInitScript(NAME_SHIM);
  return context;
}

/** A page in one theme: the app's stored choice and the system preference both say it, so neither wins by default. */
export async function gateThemedPage(browser: Browser, viewport: { readonly width: number; readonly height: number }, theme: 'light' | 'dark'): Promise<Page> {
  const page = await gatePage(browser, { viewport, colorScheme: theme });
  await page.addInitScript((value) => { window.localStorage.setItem('fantasy-draft-theme', value); }, theme);
  return page;
}

export class GateFailure extends Error {}

/**
 * Runs `measure` once per theme on the same page: the app follows the system colour scheme live (the gate never
 * stores a theme choice), so flipping it re-themes the page without reloading or replaying the draft.
 */
export async function forEachTheme(page: Page, measure: (theme: GateTheme) => Promise<void>): Promise<void> {
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForFunction((name) => document.documentElement.classList.contains(name), theme, { timeout: 5_000 })
      .catch(() => { throw new GateFailure(`the page did not switch to the ${theme} theme`); });
    await page.waitForTimeout(100);
    await measure(theme);
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new GateFailure(message);
}

/**
 * Resources that may fail to load in every check, each with its reason. Any other failed request is an error.
 * - `/api/`: the gate never starts the sync server (its API port points at nothing, see server.ts), so the app's
 *   optional calls to it (market ADP, sync status, shadow logging) fail, and the app handles that as "unavailable".
 */
export const EXPECTED_FAILED_RESOURCES: readonly RegExp[] = [/^https?:\/\/localhost:\d+\/api\//];

/**
 * Collects uncaught page errors, console errors and console warnings (React's included) while a check runs. Every
 * check installs it. `expected` names messages a check causes on purpose (such as a module it blocks);
 * `expectedResources` names URLs a check fails on purpose, beyond EXPECTED_FAILED_RESOURCES. A "Failed to load
 * resource" error for any other URL fails the check.
 */
export function watchErrors(page: Page, expected: readonly RegExp[] = [], expectedResources: readonly RegExp[] = []): () => readonly string[] {
  const errors: string[] = [];
  const isExpected = (text: string): boolean => expected.some((pattern) => pattern.test(text));
  const allowed = [...EXPECTED_FAILED_RESOURCES, ...expectedResources];
  page.on('pageerror', (error) => { if (!isExpected(error.message)) errors.push(error.message); });
  page.on('console', (message) => {
    const type = message.type();
    const text = message.text();
    if (type === 'error' && text.startsWith('Failed to load resource')) {
      const url = message.location().url;
      if (!allowed.some((pattern) => pattern.test(url))) errors.push(`${text} (${url || 'unknown URL'})`);
      return;
    }
    if (isExpected(text)) return;
    if (type === 'error') errors.push(text);
    else if (type === 'warning') errors.push(`warning: ${text}`);
  });
  return () => errors;
}

export function assertNoConsoleErrors(errors: () => readonly string[], label: string): void {
  assert(errors().length === 0, `${label}: console reported ${errors().slice(0, 3).join('; ')}`);
}

export async function assertNoPageOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 0, `${label}: page overflows horizontally by ${String(overflow)}px`);
}

/** Each checklist action sits on its own row below the copy, and the copy keeps the row's width. */
export async function assertReadableChecklist(page: Page, label: string): Promise<void> {
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

/**
 * Activates IndexedDB storage when the page asks for it. A browser with nothing saved activates itself, and a v1
 * build or a second route in an already activated context shows the app, so the gate waits for whichever comes first.
 */
export async function activateStorage(page: Page): Promise<void> {
  const review = page.locator('[data-storage-activation="review"]');
  await review.or(page.locator('.draft-app-header')).first().waitFor({ timeout: 30_000 });
  if (!(await review.isVisible())) return;
  await page.getByRole('checkbox', { name: 'I have closed other draft tabs and side panels' }).check();
  await page.getByRole('button', { name: 'Activate IndexedDB', exact: true }).click();
  await review.waitFor({ state: 'detached' });
}

/** Starts a mock and waits for the user's own pick, so the turn banner shows its loudest, longest copy. */
export async function startMockUntilOnClock(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start mock', exact: true }).click();
  await page.getByRole('button', { name: 'Start mock draft' }).click();
  await page.locator('.draft-turn-banner[data-state="on-clock"]').first().waitFor({ timeout: MOCK_TIMEOUT_MS });
}

/** Elements matching `selector` whose text is cut off (ellipsized or clipped by their own box). */
export async function clippedText(page: Page, selector: string): Promise<readonly string[]> {
  return page.locator(selector).evaluateAll((elements) => elements
    .filter((element) => element.getBoundingClientRect().width > 0 && element.scrollWidth > element.clientWidth + 1)
    .map((element) => `"${(element.textContent ?? '').trim()}" (${String(element.clientWidth)}px of ${String(element.scrollWidth)}px)`));
}

/** Visible buttons whose icon or label extends past their own box. */
export async function clippedControls(page: Page, selector: string): Promise<readonly string[]> {
  return page.locator(selector).evaluateAll((buttons) => buttons.flatMap((button) => {
    const box = button.getBoundingClientRect();
    if (box.width === 0) return [];
    const outside = [...button.querySelectorAll('svg')].some((child) => {
      const inner = child.getBoundingClientRect();
      return inner.width > 0 && (inner.left < box.left - 0.5 || inner.right > box.right + 0.5);
    });
    return outside || button.scrollWidth > button.clientWidth + 1 ? [`"${(button.textContent ?? '').trim().slice(0, 30)}"`] : [];
  }));
}

/** The header keeps navigation, the turn banner and controls on one row from 1280px up. */
export async function assertOneRowHeader(page: Page, label: string): Promise<void> {
  const header = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
    return { header: rect('.draft-app-header'), nav: rect('.draft-app-header nav'), context: rect('.draft-header-context'), controls: rect('.draft-header-controls'), banner: rect('.draft-app-header .draft-turn-banner') };
  });
  assert(header.header && header.nav && header.context && header.controls, `${label}: header parts are missing`);
  assert(header.header.height <= 64, `${label}: header is ${String(Math.round(header.header.height))}px tall; it should stay one row (at most 64px)`);
  assert(header.context.top < header.nav.bottom - 1 && header.controls.top < header.nav.bottom - 1, `${label}: header context or controls wrapped below navigation`);
  if (header.banner) {
    assert(header.banner.left >= header.nav.right - 1 && header.banner.right <= header.controls.left + 1, `${label}: the turn banner overlaps navigation or header controls`);
  }
  const clipped = await clippedText(page, '.draft-app-header .draft-turn-banner-text > *');
  assert(clipped.length === 0, `${label}: turn banner text is cut off: ${clipped.join(', ')}`);
}

/** The shared header names the draft's mode and its sync state, both whole and on screen, at every desktop size (R12-17). */
export async function assertHeaderStatus(page: Page, label: string): Promise<void> {
  const parts = await page.evaluate(() => ['.draft-session-mode', '.draft-session-sync'].map((selector) => {
    const element = document.querySelector(`.draft-app-header ${selector}`);
    const box = element?.getBoundingClientRect();
    return { selector, text: element?.textContent?.trim() ?? '', shown: box !== undefined && box.width > 0 && box.right <= window.innerWidth && element !== null && element.scrollWidth <= element.clientWidth + 1 };
  }));
  const missing = parts.filter((part) => !part.shown || part.text === '');
  assert(missing.length === 0, `${label}: the header does not show ${missing.map((part) => part.selector).join(' and ')} (${parts.map((part) => `"${part.text}"`).join(', ')})`);
}

/** The pool footer (count, keyboard help, ordering) sits fully inside its panel and the window. */
export async function assertPoolFooterVisible(page: Page, label: string): Promise<void> {
  const footer = await page.locator('.draft-pool-footer').evaluate((element) => {
    const box = element.getBoundingClientRect();
    const panel = element.closest('.draft-dock-panel')?.getBoundingClientRect();
    const help = element.querySelector('.draft-pool-shortcuts')?.getBoundingClientRect();
    return { bottom: box.bottom, panelBottom: panel?.bottom ?? box.bottom, viewport: window.innerHeight, helpRight: help?.right ?? 0, right: box.right, helpWidth: help?.width ?? 0 };
  });
  const limit = Math.min(footer.panelBottom, footer.viewport);
  assert(footer.bottom <= limit + 1, `${label}: the pool footer is cut off by ${String(Math.round(footer.bottom - limit))}px`);
  assert(footer.helpWidth > 0 && footer.helpRight <= footer.right + 1, `${label}: the keyboard help is clipped`);
}

/** Rows and rounds fully visible inside their scrollers, below sticky headers. */
export async function visibleDensity(page: Page): Promise<{ readonly poolRows: number; readonly boardRounds: number; readonly checklist: boolean }> {
  return page.evaluate(() => {
    const fullyInside = (element: Element, top: number, bottom: number) => {
      const box = element.getBoundingClientRect();
      return box.height > 0 && box.top >= top - 1 && box.bottom <= bottom + 1;
    };
    const visibleBottom = (element: Element) => Math.min(element.getBoundingClientRect().bottom, window.innerHeight);
    const pool = document.querySelector('.draft-pool-scroll');
    const poolTop = pool?.querySelector('.draft-pool-heading')?.getBoundingClientRect().bottom ?? 0;
    const poolRows = pool ? [...pool.querySelectorAll('[data-player-row]')].filter((row) => fullyInside(row, poolTop, visibleBottom(pool))).length : 0;
    const board = document.querySelector('.board-scroll');
    const boardTop = board?.querySelector('.board-team-header')?.getBoundingClientRect().bottom ?? 0;
    const boardRounds = board ? [...board.querySelectorAll('.board-round')].filter((round) => fullyInside(round, boardTop, visibleBottom(board))).length : 0;
    return { poolRows, boardRounds, checklist: document.querySelector('.draft-dock-checklist') !== null };
  });
}

/**
 * Analysis tabs not fully visible: a label wider than its own tab, or a tab cut off by any ancestor that clips or
 * scrolls (R7-1: the strip clipped "Roster needs" by 20px while each tab's own box still fit its label).
 */
export async function clippedAnalysisTabs(page: Page): Promise<readonly string[]> {
  return page.locator('.rec-tiers-analysis [role="tab"]').evaluateAll((tabs) => tabs.flatMap((tab) => {
    const box = tab.getBoundingClientRect();
    const name = (tab.textContent ?? '').trim();
    if (tab.scrollWidth > tab.clientWidth + 1) return [`${name} (label wider than tab)`];
    for (let ancestor = tab.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const edge = ancestor.getBoundingClientRect();
      const cut = Math.max(edge.left - box.left, box.right - edge.right);
      if (cut > 0.5) return [`${name} (${cut.toFixed(1)}px outside ${ancestor.className || ancestor.tagName})`];
    }
    return [];
  }));
}

/** A paused mock at the user's pick, then the Assistant: recommendations show even with stale checked-in data. */
export async function openPausedMockAssistant(page: Page): Promise<void> {
  await page.goto(`${ORIGIN}/draft`);
  await activateStorage(page);
  await startMockUntilOnClock(page);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Assistant', exact: true }).first().click();
  await page.locator('.rec-workspace:not([aria-busy])').waitFor({ timeout: 20_000 });
}

/** Drafts the first available player at each of the user's turns until the live pick reaches `round`. */
export async function advanceMockToRound(page: Page, round: number): Promise<void> {
  const pick = page.locator('.board-current-pick').first();
  for (let turn = 0; turn < round + 1; turn += 1) {
    await page.locator('.draft-turn-banner[data-state="on-clock"]').first().waitFor({ timeout: MOCK_TIMEOUT_MS });
    const label = await pick.innerText();
    if (Number(/(\d+)\.\d+/.exec(label)?.[1] ?? 0) >= round) return;
    await page.locator('.draft-pool [data-player-row] button[aria-label^="Draft "]:enabled').first().click();
    await page.waitForFunction((previous) => document.querySelector('.board-current-pick')?.textContent !== previous, label, { timeout: MOCK_TIMEOUT_MS });
  }
  throw new GateFailure(`The mock did not reach round ${String(round)}`);
}
