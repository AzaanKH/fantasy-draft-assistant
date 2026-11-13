/**
 * Browser gate: axe accessibility scans (round 12, item C19). Each route runs in both themes and fails on any
 * serious or critical violation: /assistant (Suggestions and Position tiers), /draft, and the built extension side
 * panel's shell (its pairing, loading and error states, served from extension/dist with mocked Chrome APIs).
 */
import AxeBuilder from '@axe-core/playwright';
import { Processes } from '@fantasy-draft/shared/node';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type Browser, type Page } from 'playwright';
import { ORIGIN, REPO_ROOT, SUGGESTION_CARDS, type GateTheme } from './config.js';
import { activateStorage, assert, assertNoConsoleErrors, gateContext, openPausedMockAssistant, startMockUntilOnClock, watchErrors } from './harness.js';

const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

/** Serious and critical violations on the page as it is now, one line each with the first few offending nodes. */
async function blockingViolations(page: Page): Promise<{ readonly blocking: readonly string[]; readonly minor: number; readonly minorIds: readonly string[] }> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  const blocking = results.violations.filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ''));
  return {
    blocking: blocking.map((violation) => `${violation.id} (${violation.impact ?? '?'}): ${violation.nodes.slice(0, 3).map((node) => node.target.join(' ')).join(' | ')}`),
    minor: results.violations.length - blocking.length,
    minorIds: results.violations.filter((violation) => !BLOCKING_IMPACTS.has(violation.impact ?? '')).map((violation) => `${violation.id}: ${violation.nodes.slice(0, 2).map((node) => node.target.join(' ')).join(' | ')}`),
  };
}

async function themedContext(browser: Browser, theme: GateTheme, viewport = { width: 1280, height: 800 }) {
  const context = await gateContext(browser, { viewport, colorScheme: theme });
  await context.addInitScript((value) => { window.localStorage.setItem('fantasy-draft-theme', value); }, theme);
  return context;
}

export async function checkAssistantAxe(browser: Browser, theme: GateTheme, viewport: { readonly width: number; readonly height: number }): Promise<void> {
  const label = `axe /assistant @ ${String(viewport.width)}x${String(viewport.height)} ${theme}`;
  const context = await themedContext(browser, theme, viewport);
  try {
    const page = await context.newPage();
    const errors = watchErrors(page);
    await openPausedMockAssistant(page);
    await page.locator('.suggestion-list .suggestion-row').nth(SUGGESTION_CARDS - 1).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(300);
    const suggestions = await blockingViolations(page);
    await page.getByRole('tab', { name: 'Position tiers' }).click();
    await page.locator('.rec-tier-columns').waitFor({ timeout: 20_000 });
    await page.locator('.rec-tier-row:not([data-drafted="true"]) .rec-tier-identity').first().click();
    await page.locator('.rec-tiers-analysis').waitFor();
    await page.waitForTimeout(300);
    const tiers = await blockingViolations(page);
    const failures = [...suggestions.blocking.map((line) => `Suggestions: ${line}`), ...tiers.blocking.map((line) => `Tiers: ${line}`)];
    assert(failures.length === 0, `${label}: serious or critical violations: ${failures.join('; ')}`);
    assertNoConsoleErrors(errors, label);
    console.log(`  ${label}: Suggestions 0 serious/critical (${String(suggestions.minor)} minor${suggestions.minorIds.length ? `: ${suggestions.minorIds.join('; ')}` : ''}), Tiers 0 serious/critical (${String(tiers.minor)} minor${tiers.minorIds.length ? `: ${tiers.minorIds.join('; ')}` : ''})`);
  } finally {
    await context.close();
  }
}

export async function checkDraftAxe(browser: Browser, theme: GateTheme): Promise<void> {
  const label = `axe /draft @ 1280x800 ${theme}`;
  const context = await themedContext(browser, theme);
  try {
    const page = await context.newPage();
    const errors = watchErrors(page);
    await page.goto(`${ORIGIN}/draft`);
    await activateStorage(page);
    await startMockUntilOnClock(page);
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.waitForTimeout(500);
    const draft = await blockingViolations(page);
    assert(draft.blocking.length === 0, `${label}: serious or critical violations: ${draft.blocking.join('; ')}`);
    assertNoConsoleErrors(errors, label);
    console.log(`  ${label}: 0 serious/critical (${String(draft.minor)} minor${draft.minorIds.length ? `: ${draft.minorIds.join('; ')}` : ''})`);
  } finally {
    await context.close();
  }
}

const EXTENSION_ORIGIN = 'http://side-panel.gate.test';
const CONTENT_TYPES: Readonly<Record<string, string>> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };

/** Builds the extension once per run, so the scan sees the shell as it ships. */
let extensionBuild: Promise<unknown> | null = null;

export async function checkSidePanelShellAxe(browser: Browser, theme: GateTheme): Promise<void> {
  const label = `axe built side panel @ 390x844 ${theme}`;
  extensionBuild ??= Processes.run('pnpm', ['--filter', 'extension', 'build'], { cwd: REPO_ROOT, timeoutMs: 180_000, output: 'ignore' });
  await extensionBuild;
  const dist = path.join(REPO_ROOT, 'extension', 'dist');
  const context = await themedContext(browser, theme, { width: 390, height: 844 });
  try {
    // The shell's Chrome APIs: unpaired, no stored address, so it shows the pairing state first.
    await context.addInitScript(() => {
      const noop = () => undefined;
      Object.assign(window, {
        chrome: {
          storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() }, onChanged: { addListener: noop } },
          runtime: { sendMessage: () => Promise.resolve({ success: false }), onMessage: { addListener: noop }, openOptionsPage: noop },
          tabs: { create: () => Promise.resolve({}), query: () => Promise.resolve([]), update: () => Promise.resolve({}) },
          windows: { update: () => Promise.resolve({}) },
          permissions: { contains: () => Promise.resolve(true) },
        },
      });
    });
    await context.route(`${EXTENSION_ORIGIN}/**`, async (route) => {
      const file = path.join(dist, new URL(route.request().url()).pathname);
      if (!file.startsWith(dist)) return route.abort();
      let body: Buffer | null = null;
      try {
        body = await readFile(file);
      } catch {
        // A file the build did not emit answers 404, like a real server.
      }
      await route.fulfill(body === null ? { status: 404, body: '' } : { body, contentType: CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream' });
    });
    // The embedded app is not part of this scan (its own routes are scanned above).
    await context.route((url) => url.origin !== EXTENSION_ORIGIN, (route) => route.abort());
    const page = await context.newPage();
    const errors = watchErrors(page, [/Rejected background draft state/], [/./]);
    await page.goto(`${EXTENSION_ORIGIN}/sidepanel.html`);
    await page.locator('.sidepanel-shell').waitFor({ timeout: 10_000 });
    const failures: string[] = [];
    let minor = 0;
    const minorIds = new Set<string>();
    for (const state of ['pairing-state', 'loading-state', 'error-state'] as const) {
      // Each state on its own, as the shell shows them.
      // The shell makes hidden overlays inert too; mirror that, so axe scans the shown state's contents.
      const accessible = await page.evaluate((shown) => {
        for (const id of ['pairing-state', 'loading-state', 'error-state']) {
          const element = document.getElementById(id);
          if (!element) continue;
          element.hidden = id !== shown;
          element.toggleAttribute('inert', id !== shown);
        }
        const target = document.getElementById(shown);
        return target !== null && !target.hidden && target.closest('[inert]') === null && target.getBoundingClientRect().height > 0;
      }, state);
      assert(accessible, `${label}: the ${state} could not be shown for the scan`);
      const result = await blockingViolations(page);
      minor += result.minor;
      for (const id of result.minorIds) minorIds.add(id);
      failures.push(...result.blocking.map((line) => `${state}: ${line}`));
    }
    assert(failures.length === 0, `${label}: serious or critical violations: ${failures.join('; ')}`);
    assertNoConsoleErrors(errors, label);
    console.log(`  ${label}: pairing, loading and error states 0 serious/critical (${String(minor)} minor${minorIds.size ? `: ${[...minorIds].join('; ')}` : ''})`);
  } finally {
    await context.close();
  }
}

/**
 * A dialog opened from state, with no DialogTrigger (League setup, opened from the header status popover), hands
 * focus back to the control that started it when it closes, instead of dropping it on the page body (R12-21).
 */
export async function checkDialogFocusReturn(browser: Browser): Promise<void> {
  const label = 'Dialog focus return @ 1280x800';
  const context = await gateContext(browser, { viewport: { width: 1280, height: 800 } });
  try {
    const page = await context.newPage();
    const errors = watchErrors(page);
    await page.goto(`${ORIGIN}/draft`);
    await activateStorage(page);
    await page.locator('.draft-pool-footer').getByText(/players shown/).waitFor({ timeout: 20_000 });
    const status = page.locator('.draft-app-header .draft-session-status');
    await status.click();
    await page.getByRole('dialog', { name: 'Draft session details' }).getByRole('button', { name: 'League setup', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'League setup' });
    await dialog.waitFor({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached', timeout: 10_000 });
    await page.waitForTimeout(100);
    const focused = await page.evaluate(() => {
      const active = document.activeElement;
      return { onStatus: active?.classList.contains('draft-session-status') === true, name: active?.tagName ?? 'none', label: active?.getAttribute('aria-label')?.slice(0, 40) ?? '' };
    });
    assert(focused.onStatus, `${label}: focus went to ${focused.name} "${focused.label}" instead of the header status button that opened League setup`);
    assertNoConsoleErrors(errors, label);
    console.log(`  ${label}: Escape on League setup returned focus to the header status button`);
  } finally {
    await context.close();
  }
}
