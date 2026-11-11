/**
 * Browser gate: the extension side panel's turn banner and final-pick labels.
 */
import { type Browser } from 'playwright';
import { ORIGIN, SIDE_PANEL_WIDTHS } from './config.js';
import { activateStorage, advanceMockToRound, assert, assertNoConsoleErrors, assertNoPageOverflow, clippedControls, clippedText, forEachTheme, gateContext, startMockUntilOnClock, watchErrors } from './harness.js';

/**
 * The side panel's turn row keeps its whole headline and pick detail at extension widths. A mock lives in the
 * tab's memory, so a new tab could never see it: the panel opens in the same document, through the app's own
 * client-side routing, and reads the paused mock at the user's pick.
 */
export async function checkSidePanelBanner(browser: Browser): Promise<void> {
  const context = await gateContext(browser, { viewport: { width: 1280, height: 800 } });
  try {
    const page = await context.newPage();
    const errors = watchErrors(page);
    await page.goto(`${ORIGIN}/draft`);
    await activateStorage(page);
    await startMockUntilOnClock(page);
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.evaluate(() => {
      window.history.pushState(null, '', '/sidepanel');
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });
    const banner = page.locator('.draft-turn-banner[data-variant="compact"]');
    for (const width of SIDE_PANEL_WIDTHS) await forEachTheme(page, async (theme) => {
      await page.setViewportSize({ width, height: 844 });
      await banner.first().waitFor({ timeout: 20_000 });
      assert(await page.locator('.draft-turn-banner[data-variant="compact"][data-state="on-clock"]').count() > 0, `Side panel @ ${String(width)}px ${theme}: the turn banner does not show the paused mock's pick`);
      const clipped = await clippedText(page, '.draft-turn-banner[data-variant="compact"] .draft-turn-banner-text > *');
      const overflow = await banner.first().evaluate((element) => {
        const box = element.getBoundingClientRect();
        const text = element.querySelector('.draft-turn-banner-text')?.getBoundingClientRect();
        return text ? Math.max(0, box.left - text.left, text.right - box.right) : 0;
      });
      assert(clipped.length === 0 && overflow <= 1, `Side panel @ ${String(width)}px ${theme}: the turn banner clips ${clipped.join(', ') || `${String(Math.round(overflow))}px of text`}`);
      const clippedActions = await clippedControls(page, 'button');
      assert(clippedActions.length === 0, `Side panel @ ${String(width)}px ${theme}: buttons clip their content: ${clippedActions.join(', ')}`);
      await assertNoPageOverflow(page, `Side panel @ ${String(width)}px ${theme}`);
      // The compact hero leaves the compare list on the first screen: at least 3 whole rows above the fixed nav.
      await page.locator('section').filter({ hasText: 'Compare available' }).first().locator('button[aria-pressed]').first().waitFor({ timeout: 20_000 });
      const aboveFold = await page.evaluate(() => {
        window.scrollTo(0, 0);
        const nav = document.querySelector('nav[aria-label="Side panel navigation"]');
        const fold = nav && getComputedStyle(nav).position === 'fixed' ? nav.getBoundingClientRect().top : window.innerHeight;
        const list = [...document.querySelectorAll('section')].find((section) => section.textContent?.includes('Compare available'));
        return [...(list?.querySelectorAll('button[aria-pressed]') ?? [])].filter((row) => row.getBoundingClientRect().bottom <= fold + 0.5).length;
      });
      assert(aboveFold >= 3, `Side panel @ ${String(width)}x844 ${theme}: only ${String(aboveFold)} Compare available rows show above the fold; 3 must`);
    });
    assertNoConsoleErrors(errors, 'Side panel');
  } finally {
    await context.close();
  }
}

/**
 * On the manager's final pick every surface says why there is no availability figure: the side panel's hero and
 * compare rows say "No later pick" (never a bare dash), and no card summary calls it "not estimated".
 */
export async function checkFinalPickLabels(browser: Browser): Promise<void> {
  const label = 'Final-pick labels';
  const context = await gateContext(browser, { viewport: { width: 1280, height: 800 } });
  try {
    const page = await context.newPage();
    const errors = watchErrors(page);
    await page.goto(`${ORIGIN}/draft`);
    await activateStorage(page);
    await page.getByRole('button', { name: 'Start mock', exact: true }).click();
    await page.getByLabel('League teams').fill('2');
    await page.getByLabel('Your draft slot').fill('2');
    await page.getByRole('button', { name: 'Start mock draft' }).click();
    const rounds = Number(/(\d+) rounds/.exec(await page.locator('.board-subtitle').first().innerText())?.[1] ?? 0);
    assert(rounds > 0, `${label}: could not read the draft's round count`);
    await advanceMockToRound(page, rounds);
    await page.getByRole('button', { name: 'Pause' }).click();

    await page.getByRole('button', { name: 'Assistant', exact: true }).first().click();
    await page.locator('.rec-workspace:not([aria-busy])').waitFor({ timeout: 20_000 });
    await page.locator('.suggestion-row').first().waitFor({ timeout: 20_000 });
    const summaries = await page.locator('.suggestion-row .suggestion-reason > p:first-child').allInnerTexts();
    assert(summaries.every((summary) => !/not estimated/i.test(summary)), `${label}: a card summary says availability is not estimated on the final pick`);
    const figures = await page.locator('.suggestion-row [data-card-availability]').allInnerTexts();
    assert(figures.length > 0 && figures.every((figure) => figure.trim() === 'No later pick'), `${label}: cards should say "No later pick" on the final pick: ${figures.join(' | ')}`);
    // No verdict on the final pick, so a card with warnings keeps its Details trigger for keyboard users (item 11).
    const warned = await page.evaluate(() => [...document.querySelectorAll('.suggestion-row')].filter((card) => card.querySelector('.suggestion-reason-chips, .status-chip[title]')).map((card) => Boolean(card.querySelector('button.status-chip-trigger'))));
    assert(warned.every(Boolean), `${label}: a card with warnings has no focusable details trigger on the final pick`);

    await page.evaluate(() => {
      window.history.pushState(null, '', '/sidepanel');
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });
    for (const width of SIDE_PANEL_WIDTHS) {
      await page.setViewportSize({ width, height: 844 });
      const hero = page.locator('section').filter({ hasText: 'Your best pick' }).first();
      await hero.waitFor({ timeout: 20_000 });
      // The loading hero says "Your best pick" too, so wait for the loaded label rather than counting once.
      const heroLabel = await hero.getByText('No later pick', { exact: true }).first().waitFor({ timeout: 20_000 }).then(() => true, () => false);
      assert(heroLabel, `Side panel @ ${String(width)}px: the hero does not say "No later pick" on the final pick (${(await hero.innerText()).replace(/\s+/g, ' ').slice(0, 240)})`);
      const rows = page.locator('section').filter({ hasText: 'Compare available' }).first().locator('button[aria-pressed]');
      const texts = await rows.allInnerTexts();
      assert(texts.length > 0 && texts.every((text) => text.includes('No later pick')), `Side panel @ ${String(width)}px: compare rows lack "No later pick": ${texts.map((text) => text.replace(/\s+/g, ' ')).join(' | ')}`);
    }
    assertNoConsoleErrors(errors, label);
  } finally {
    await context.close();
  }
}
