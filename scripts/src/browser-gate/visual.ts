/**
 * Browser gate: every `/__visual/` fixture route at its widths.
 */
import { type Browser } from 'playwright';
import { ASSISTANT_STATES, DESKTOP, NARROW_WIDTHS, ORIGIN, PHONE } from './config.js';
import { assert, assertNoPageOverflow, assertReadableChecklist, gatePage, watchErrors } from './harness.js';

export interface VisualCheck {
  readonly url: string;
  readonly widths: readonly number[];
}

export const VISUAL_CHECKS: readonly VisualCheck[] = [
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
  ...(['draft', 'assistant', 'sidepanel'] as const).map((state) => ({ url: `/__visual/loading?state=${state}`, widths: [DESKTOP, PHONE] })),
];

export async function checkVisualRoute(browser: Browser, check: VisualCheck, width: number): Promise<void> {
  const label = `${check.url} @ ${String(width)}px`;
  const page = await gatePage(browser, { viewport: { width, height: 900 } });
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
