/**
 * Browser gate: the Assistant's Position tiers cheat sheet and its analysis drawer.
 */
import { type Browser, type Page } from 'playwright';
import { intendedAnalysisHeights } from './assistant.js';
import { DEEP_PLAYER, MIN_TIER_COLUMNS_AT_1920, MIN_TIER_COLUMNS_WITH_ANALYSIS, MIN_TIER_NAME_WIDTH } from './config.js';
import { GateFailure, assert, assertNoConsoleErrors, clippedAnalysisTabs, forEachTheme, gatePage, openPausedMockAssistant, watchErrors } from './harness.js';

/** Cheat-sheet name widths and column rows, so a wrap to 3+2 or a squeezed name fails. */
export async function tierSheetLayout(page: Page): Promise<{ readonly rows: number; readonly columns: number; readonly narrowNames: readonly string[] }> {
  return page.locator('.rec-tier-columns').evaluate((sheet, minimum) => {
    const columns = [...sheet.querySelectorAll(':scope > .rec-tier-column')];
    const rows = new Set(columns.map((column) => Math.round(column.getBoundingClientRect().top))).size;
    const narrowNames = [...sheet.querySelectorAll('.rec-tier-row .rec-candidate-name')]
      .filter((name) => { const width = name.getBoundingClientRect().width; return width > 0 && width < minimum - 0.5; })
      .map((name) => `${(name.textContent ?? '').trim()} (${String(Math.round(name.getBoundingClientRect().width))}px)`);
    return { rows, columns: columns.length, narrowNames };
  }, MIN_TIER_NAME_WIDTH);
}

/** Tier columns past the sheet's visible edge, and whether a visible "More columns" cue tells the user so. */
export async function tierColumnsOffscreen(page: Page): Promise<{ readonly hidden: readonly string[]; readonly cue: boolean }> {
  return page.locator('.rec-tier-columns').evaluate((sheet) => {
    const box = sheet.getBoundingClientRect();
    const hidden = [...sheet.querySelectorAll(':scope > .rec-tier-column')]
      .filter((column) => { const edge = column.getBoundingClientRect(); return edge.right > box.right + 1 || edge.left < box.left - 1; })
      .map((column) => column.getAttribute('data-key') ?? '?');
    const cue = [...document.querySelectorAll('[data-tier-scroll-cue]')].some((control) => {
      const edge = control.getBoundingClientRect();
      return edge.width > 0 && edge.height > 0 && getComputedStyle(control).visibility !== 'hidden';
    });
    return { hidden, cue };
  });
}

/** Tier rows whose name box runs into the flag or % beside it. */
export async function tierNameOverlaps(page: Page): Promise<readonly string[]> {
  return page.locator('.rec-tier-row:not([data-drafted="true"])').evaluateAll((rows) => rows.flatMap((row) => {
    const name = row.querySelector('.rec-candidate-name')?.getBoundingClientRect();
    const next = [row.querySelector('.rec-tier-flags .status-chip'), row.querySelector('.rec-candidate-value')]
      .map((element) => element?.getBoundingClientRect())
      .find((box) => box !== undefined && box.width > 0);
    if (!name || name.width === 0 || !next) return [];
    return name.right > next.left + 0.5 ? [`${(row.querySelector('.rec-candidate-name')?.textContent ?? '').trim()} (${(name.right - next.left).toFixed(2)}px)`] : [];
  }));
}

/**
 * The tier drawer keeps the suggestions view's height model across row switches (R8-1: 730 → 730 → 700px with the
 * drawer itself scrolling): the window-bounded drawer height on every row, one analysis height, and the tab answer
 * as the only scroller.
 */
export async function checkTierAnalysisHeight(page: Page, label: string): Promise<void> {
  const { drawer: intended } = await intendedAnalysisHeights(page);
  const rows = page.locator('.rec-tier-column[data-key="OVERALL"] .rec-tier-row:not([data-drafted="true"]) .rec-tier-identity');
  const measured: { drawer: number; analysis: number; scrolls: boolean }[] = [];
  for (const index of [0, 3, 1, 5]) {
    await rows.nth(index).click();
    await page.waitForTimeout(200);
    measured.push(await page.evaluate(() => {
      const drawer = document.querySelector('.rec-tiers-analysis');
      const analysis = drawer?.querySelector(':scope > .rec-analysis');
      return {
        drawer: Math.round(drawer?.getBoundingClientRect().height ?? 0),
        analysis: Math.round(analysis?.getBoundingClientRect().height ?? 0),
        scrolls: drawer ? drawer.scrollHeight > drawer.clientHeight + 1 : true,
      };
    }));
  }
  const summary = measured.map((item) => `${String(item.drawer)}/${String(item.analysis)}px`).join(' → ');
  assert(measured.every((item) => Math.abs(item.drawer - intended) <= 1), `${label}: the tier drawer should be ${String(intended)}px on every row; measured drawer/analysis ${summary}`);
  assert(new Set(measured.map((item) => item.analysis)).size === 1, `${label}: the tier analysis height changes across rows: ${summary}`);
  assert(measured.every((item) => !item.scrolls), `${label}: the tier drawer itself scrolls; only the tab answer may`);
  console.log(`  ${label}: tier drawer/analysis ${summary}`);
}

/**
 * A search that matches only Overall and WR declares two grid tracks, not five, so "More columns" never scrolls into
 * empty space (R9-5): the sheet's tracks equal its rendered columns, and with those columns fitting there is no
 * sideways overflow and no enabled scroll cue.
 */
export async function checkSparseTierSearch(page: Page, label: string): Promise<void> {
  const search = page.locator('.rec-tiers .rec-search input');
  await search.fill(DEEP_PLAYER);
  await page.waitForFunction(() => (document.querySelectorAll('.rec-tier-columns > .rec-tier-column').length) < 5, null, { timeout: 5_000 })
    .catch(() => { throw new GateFailure(`${label}: searching ${DEEP_PLAYER} still renders five tier columns`); });
  await page.waitForTimeout(300);
  const sparse = await page.locator('.rec-tier-columns').evaluate((sheet) => {
    const columns = [...sheet.querySelectorAll(':scope > .rec-tier-column')];
    const tracks = getComputedStyle(sheet).gridTemplateColumns.split(' ').filter(Boolean).length;
    const width = columns.reduce((sum, column) => sum + column.getBoundingClientRect().width, 0);
    const cue = document.querySelector<HTMLButtonElement>('[data-tier-scroll-cue][data-side="end"]');
    return { columns: columns.length, count: Number(sheet.getAttribute('data-count')), tracks, fits: width <= sheet.clientWidth + 1, overflow: sheet.scrollWidth - sheet.clientWidth, cue: cue !== null && !cue.disabled };
  });
  assert(sparse.columns > 0 && sparse.count === sparse.columns && sparse.tracks === sparse.columns, `${label}: ${DEEP_PLAYER} renders ${String(sparse.columns)} columns but the sheet declares ${String(sparse.count)} (${String(sparse.tracks)} grid tracks)`);
  assert(!sparse.fits || (sparse.overflow <= 1 && !sparse.cue), `${label}: ${String(sparse.columns)} fitting columns still overflow by ${String(sparse.overflow)}px${sparse.cue ? ' with "More columns" enabled' : ''}`);
  console.log(`  ${label}: ${DEEP_PLAYER} search, ${String(sparse.columns)} columns and tracks, ${String(sparse.overflow)}px overflow`);
  await search.fill('');
}

/** Assistant cheat sheet: five columns on one row and readable names, before and after opening the analysis. */
export async function checkTierSheet(browser: Browser, viewport: { readonly width: number; readonly height: number }): Promise<void> {
  const sheetLabel = `Position tiers @ ${String(viewport.width)}x${String(viewport.height)}`;
  const page = await gatePage(browser, { viewport });
  try {
    const errors = watchErrors(page);
    await openPausedMockAssistant(page);
    await page.getByRole('tab', { name: 'Position tiers' }).click();
    await page.locator('.rec-tier-columns').waitFor({ timeout: 20_000 });
    await forEachTheme(page, async (theme) => {
    const label = `${sheetLabel} ${theme}`;
    for (const state of ['closed', 'open'] as const) {
      if (state === 'open') {
        await page.locator('.rec-tier-row:not([data-drafted="true"]) .rec-tier-identity').first().click();
        await page.locator('.rec-tiers-analysis').waitFor();
      }
      const layout = await tierSheetLayout(page);
      assert(layout.columns === 5, `${label}, analysis ${state}: ${String(layout.columns)} tier columns rendered; expected Overall, QB, RB, WR and TE`);
      assert(layout.rows === 1, `${label}, analysis ${state}: the five columns wrapped onto ${String(layout.rows)} rows`);
      const overlaps = await tierNameOverlaps(page);
      assert(overlaps.length === 0, `${label}, analysis ${state}: names overlap their flags or %: ${overlaps.slice(0, 5).join(', ')}`);
      assert(layout.narrowNames.length === 0, `${label}, analysis ${state}: names narrower than ${String(MIN_TIER_NAME_WIDTH)}px: ${layout.narrowNames.slice(0, 5).join(', ')}`);
      const offscreen = await tierColumnsOffscreen(page);
      assert(offscreen.hidden.length === 0 || offscreen.cue, `${label}, analysis ${state}: ${offscreen.hidden.join(', ')} off-screen with no "More columns" cue`);
      if (offscreen.hidden.length > 0) {
        // The cue must actually reveal the hidden columns, not just announce them.
        const sheet = page.locator('.rec-tier-columns');
        const before = await sheet.evaluate((element) => element.scrollLeft);
        await page.locator('[data-tier-scroll-cue][data-side="end"]').click();
        await page.waitForFunction((start) => (document.querySelector('.rec-tier-columns')?.scrollLeft ?? start) > start + 20, before, { timeout: 3_000 });
        await sheet.evaluate((element) => { element.scrollLeft = 0; });
        console.log(`  ${label}, analysis ${state}: ${offscreen.hidden.join(', ')} behind the "More columns" cue`);
      }
      if (state === 'open') {
        const covered = await tierColumnsUnderDrawer(page);
        assert(covered.length === 0, `${label}: the analysis drawer covers ${covered.join(', ')}`);
        const clipped = await clippedAnalysisTabs(page);
        assert(clipped.length === 0, `${label}: analysis tab labels are clipped: ${clipped.join(', ')}`);
        await checkTierAnalysisHeight(page, label);
        // Back to the first column, after any smooth "More columns" scroll above has finished.
        await page.waitForTimeout(600);
        await page.locator('.rec-tier-columns').evaluate((sheet) => { sheet.scrollTo({ left: 0, behavior: 'instant' }); });
        await page.waitForFunction(() => document.querySelector('.rec-tier-columns')?.scrollLeft === 0, null, { timeout: 3_000 });
        const whole = await page.locator('.rec-tier-columns').evaluate((sheet) => {
          const box = sheet.getBoundingClientRect();
          return [...sheet.querySelectorAll(':scope > .rec-tier-column')].filter((column) => {
            const edge = column.getBoundingClientRect();
            return edge.left >= box.left - 1 && edge.right <= box.right + 1;
          }).length;
        });
        const required = viewport.width >= 1920 ? MIN_TIER_COLUMNS_AT_1920 : MIN_TIER_COLUMNS_WITH_ANALYSIS;
        assert(whole >= required, `${label}: only ${String(whole)} whole tier columns beside the analysis; at least ${String(required)} must show`);
        console.log(`  ${label}: ${String(whole)} whole tier columns beside the analysis`);
        // The search changes the sheet, not its colours: once is enough.
        if (theme === 'light') await checkSparseTierSearch(page, label);
      }
    }
    // Close the analysis so the next theme starts from the same closed sheet.
    await page.locator('.rec-tiers-analysis-close').click();
    await page.locator('.rec-tiers-analysis').waitFor({ state: 'detached' });
    });
    assertNoConsoleErrors(errors, sheetLabel);
  } finally {
    await page.close();
  }
}

/** Tier columns (or parts of them) that sit underneath the open analysis drawer instead of beside it. */
export async function tierColumnsUnderDrawer(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const drawer = document.querySelector('.rec-tiers-analysis')?.getBoundingClientRect();
    const sheet = document.querySelector('.rec-tier-columns')?.getBoundingClientRect();
    if (!drawer || !sheet) return ['no drawer or sheet'];
    // Columns scrolled sideways are clipped by the sheet, so the sheet's own edge is what must clear the drawer.
    const visibleRight = Math.min(sheet.right, window.innerWidth);
    return [...document.querySelectorAll('.rec-tier-column')].flatMap((column) => {
      const box = column.getBoundingClientRect();
      const right = Math.min(box.right, visibleRight);
      const overlaps = box.width > 0 && right > drawer.left + 1 && box.left < drawer.right - 1 && box.bottom > drawer.top && box.top < drawer.bottom;
      return overlaps ? [column.querySelector('.rec-tier-title')?.textContent?.trim() ?? 'a column'] : [];
    });
  });
}
