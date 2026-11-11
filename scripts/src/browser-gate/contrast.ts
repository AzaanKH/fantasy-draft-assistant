/**
 * Browser gate: composited chip text contrast in both themes.
 */
import { type Browser, type Page } from 'playwright';
import { CONTRAST_SELECTOR, MIN_TEXT_CONTRAST, ORIGIN } from './config.js';
import { activateStorage, assert, assertNoConsoleErrors, gateContext, openPausedMockAssistant, startMockUntilOnClock, watchErrors } from './harness.js';

/** Composited text contrast of every visible chip (and the turn banner headline), via a 1px canvas. */
export async function lowContrastChips(page: Page, minimum: number): Promise<readonly string[]> {
  return page.evaluate(({ limit, selector }) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return ['no 2d canvas'];
    const paint = (color: string): number[] => { context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
    const luminance = (pixel: readonly number[]) => pixel.slice(0, 3).map((value) => value / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0);
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => element.getBoundingClientRect().width > 0)
      .flatMap((element) => {
        const chain: Element[] = [];
        for (let node: Element | null = element; node; node = node.parentElement) chain.unshift(node);
        context.clearRect(0, 0, 1, 1);
        paint('#fff');
        let background: number[] = [];
        for (const node of chain) background = paint(getComputedStyle(node).backgroundColor);
        const foreground = paint(getComputedStyle(element).color);
        const [first, second] = [luminance(foreground), luminance(background)];
        const ratio = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
        return ratio >= limit ? [] : [`"${(element.textContent ?? '').trim().slice(0, 40)}" ${ratio.toFixed(2)}:1`];
      });
  }, { limit: minimum, selector: CONTRAST_SELECTOR });
}

/** Chips, position tags and badges on ordinary and selected cards (suggestions, tiers with a selected row) reach 4.5:1. */
export async function checkChipContrast(browser: Browser, theme: 'light' | 'dark'): Promise<void> {
  const context = await gateContext(browser, { viewport: { width: 1440, height: 900 }, colorScheme: theme });
  try {
    await context.addInitScript((value) => { window.localStorage.setItem('fantasy-draft-theme', value); }, theme);
    const page = await context.newPage();
    const errors = watchErrors(page);
    await page.goto(`${ORIGIN}/draft`);
    await activateStorage(page);
    await startMockUntilOnClock(page);
    await page.getByRole('button', { name: 'Pause' }).click();
    const failures = [...await lowContrastChips(page, MIN_TEXT_CONTRAST)].map((item) => `draft room ${item}`);
    await page.getByRole('button', { name: 'Assistant', exact: true }).first().click();
    await page.locator('.rec-workspace:not([aria-busy])').waitFor({ timeout: 20_000 });
    // The viewed leader's suggestion card is the selected (tinted) card.
    failures.push(...(await lowContrastChips(page, MIN_TEXT_CONTRAST)).map((item) => `assistant ${item}`));
    await page.getByRole('tab', { name: 'Position tiers' }).click();
    await page.locator('.rec-tier-row:not([data-drafted="true"]) .rec-tier-identity').first().click();
    await page.locator('.rec-tiers-analysis').waitFor();
    failures.push(...(await lowContrastChips(page, MIN_TEXT_CONTRAST)).map((item) => `tiers ${item}`));
    assert(failures.length === 0, `${theme === 'light' ? 'Light' : 'Dark'}-theme text below ${String(MIN_TEXT_CONTRAST)}:1: ${failures.slice(0, 8).join('; ')}`);
    assertNoConsoleErrors(errors, `${theme} chip contrast`);
  } finally {
    await context.close();
  }
}

/** A focus indicator must reach this contrast against what surrounds the control (WCAG 2.4.13 / 1.4.11). */
export const MIN_FOCUS_RING_CONTRAST = 3;

/**
 * Focus rings in both themes, sampled across control types (R12-20): primary and outline buttons on a card, a tab,
 * the search input, a select, a list row and a header control. Each is focused by keyboard so :focus-visible
 * applies; the indicator's colour (outline, or the strongest ring colour in its box-shadow) is composited and
 * compared with the background behind the control.
 */
export async function checkFocusRingContrast(browser: Browser, theme: 'light' | 'dark'): Promise<void> {
  const label = `Focus ring contrast @ 1280x800 ${theme}`;
  const context = await gateContext(browser, { viewport: { width: 1280, height: 800 }, colorScheme: theme });
  try {
    await context.addInitScript((value) => { window.localStorage.setItem('fantasy-draft-theme', value); }, theme);
    const page = await context.newPage();
    const errors = watchErrors(page);
    await openPausedMockAssistant(page);
    await page.locator('.suggestion-list .suggestion-row').nth(3).waitFor({ timeout: 20_000 });
    const samples = [
      ['primary button (leader Draft)', '.suggestion-list .suggestion-row [data-suggestion-action] button[aria-label^="Draft "]'],
      ['outline button (card Queue)', '.suggestion-list .suggestion-row [data-suggestion-action] button[aria-label$=" to queue"]'],
      ['card name button', '.suggestion-list .suggestion-select'],
      ['view tab', '#rec-view-suggestions'],
      ['analysis tab', '.rec-analysis [role="tab"][aria-selected="true"]'],
      ['search input', '#rec-view-panel-suggestions .rec-search input'],
      ['select', '.rec-sort select'],
      ['filter button', '.rec-filters button'],
      ['list row', '.rec-pool-list [data-pool-select]'],
      ['header control', '.draft-app-header nav button, .draft-app-header nav a'],
    ] as const;
    const results: string[] = [];
    const weak: string[] = [];
    for (const [name, selector] of samples) {
      const control = page.locator(selector).first();
      if (await control.count() === 0) { weak.push(`${name}: not found (${selector})`); continue; }
      await control.scrollIntoViewIfNeeded();
      // A key press first, so the programmatic focus that follows counts as keyboard focus (:focus-visible).
      await page.keyboard.press('Shift');
      await control.focus();
      await page.waitForTimeout(220);
      const ratio = await control.evaluate((element) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1; canvas.height = 1;
        const context2d = canvas.getContext('2d', { willReadFrequently: true });
        if (!context2d) return null;
        const paint = (color: string): number[] => { context2d.fillStyle = color; context2d.fillRect(0, 0, 1, 1); return [...context2d.getImageData(0, 0, 1, 1).data]; };
        const luminance = (pixel: readonly number[]) => pixel.slice(0, 3).map((value) => value / 255)
          .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
          .reduce((sum, value, index) => sum + value * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0);
        const contrast = (first: readonly number[], second: readonly number[]) => {
          const [a, b] = [luminance(first), luminance(second)];
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        // The indicator is on the control, or on its wrapper when the wrapper draws it (the search field's
        // :focus-within outline around its input).
        const indicatorColors = (node: Element): string[] => {
          const style = getComputedStyle(node);
          const found: string[] = [];
          if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1) found.push(style.outlineColor);
          found.push(...(style.boxShadow.match(/(?:rgba?|oklch|oklab|color)\([^)]*\)|#[0-9a-f]{3,8}/gi) ?? []));
          return found;
        };
        const owner: Element = (element.parentElement && indicatorColors(element).length === 0 && indicatorColors(element.parentElement).length > 0) ? element.parentElement : element;
        const colors = indicatorColors(owner);
        // What surrounds the indicator: the owner's ancestors' backgrounds, composited from the page down.
        const chain: Element[] = [];
        for (let node = owner.parentElement; node; node = node.parentElement) chain.unshift(node);
        context2d.clearRect(0, 0, 1, 1);
        paint('#fff');
        let background: number[] = [];
        for (const node of chain) background = paint(getComputedStyle(node).backgroundColor);
        if (colors.length === 0) return 0;
        // Each candidate painted over the background, so a translucent ring is judged as it looks.
        return Math.max(...colors.map((color) => {
          context2d.clearRect(0, 0, 1, 1);
          paint(`rgb(${background.slice(0, 3).join(',')})`);
          return contrast(paint(color), background);
        }));
      });
      const shown = ratio === null ? 'no canvas' : `${ratio.toFixed(2)}:1`;
      results.push(`${name} ${shown}`);
      if (ratio === null || ratio < MIN_FOCUS_RING_CONTRAST) weak.push(`${name} ${shown}`);
    }
    assert(weak.length === 0, `${label}: focus indicators below ${String(MIN_FOCUS_RING_CONTRAST)}:1: ${weak.join(', ')}`);
    assertNoConsoleErrors(errors, label);
    console.log(`  ${label}: ${results.join(', ')}`);
  } finally {
    await context.close();
  }
}
