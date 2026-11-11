/**
 * Browser gate: the draft room at laptop and phone sizes, the pool, the real draft flow and route failure recovery.
 */
import { type Browser, type Page } from 'playwright';
import { DESKTOP, MIN_BOARD_ROUNDS, MIN_POOL_ROWS_AT_1366, MIN_POOL_ROWS_WITH_CHECKLIST, MOCK_TIMEOUT_MS, ORIGIN, PHONE, POOL_COLUMNS } from './config.js';
import { activateStorage, assert, assertHeaderStatus, assertNoConsoleErrors, assertNoPageOverflow, assertOneRowHeader, forEachTheme, assertPoolFooterVisible, assertReadableChecklist, gatePage, startMockUntilOnClock, visibleDensity, watchErrors } from './harness.js';

/**
 * Draft room at laptop and desktop sizes: one-row header, unclipped turn banner, a fully visible pool footer,
 * at least three full board rounds, and (at 1366x768) six full pool rows.
 */
/** Board cells whose "On the clock" / "Your turn" / "Your pick in N" text box touches the snake direction arrow (R7-2). */
export async function statusArrowOverlaps(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => [...document.querySelectorAll('.board-empty-pick')].flatMap((cell) => {
    const arrow = cell.querySelector('.board-pick-direction')?.getBoundingClientRect();
    if (!arrow || arrow.width === 0) return [];
    return [...cell.querySelectorAll('.board-clock-label strong, .board-next-pick')].flatMap((text) => {
      const box = text.getBoundingClientRect();
      const width = Math.min(box.right, arrow.right) - Math.max(box.left, arrow.left);
      const height = Math.min(box.bottom, arrow.bottom) - Math.max(box.top, arrow.top);
      return width > 0 && height > 0 ? [`"${(text.textContent ?? '').trim()}" (${width.toFixed(1)}x${height.toFixed(1)}px)`] : [];
    });
  }));
}

export async function checkLaptopDraftRoom(browser: Browser, viewport: { readonly width: number; readonly height: number }): Promise<void> {
  const label = `Draft room @ ${String(viewport.width)}x${String(viewport.height)}`;
  const page = await gatePage(browser, { viewport });
  try {
    const errors = watchErrors(page);
    await page.goto(`${ORIGIN}/draft`);
    await activateStorage(page);
    await page.locator('.draft-pool-footer').getByText(/players shown/).waitFor({ timeout: 20_000 });
    await startMockUntilOnClock(page);
    await forEachTheme(page, async (theme) => {
      const themed = `${label} ${theme}`;
      await assertOneRowHeader(page, themed);
      await assertHeaderStatus(page, themed);
      await assertPoolFooterVisible(page, themed);
      const touching = await statusArrowOverlaps(page);
      assert(touching.length === 0, `${themed}: board status text overlaps the direction arrow: ${touching.join(', ')}`);
      const density = await visibleDensity(page);
      // An open setup checklist takes its room from the board, so the round minimum applies without it.
      if (!density.checklist) assert(density.boardRounds >= MIN_BOARD_ROUNDS, `${themed}: the board shows ${String(density.boardRounds)} full rounds; it needs ${String(MIN_BOARD_ROUNDS)}`);
      if (density.checklist) {
        assert(density.poolRows >= MIN_POOL_ROWS_WITH_CHECKLIST, `${themed}: with the setup checklist open, ${String(density.poolRows)} full pool rows are visible; it needs ${String(MIN_POOL_ROWS_WITH_CHECKLIST)}`);
      } else if (viewport.width === 1366 && viewport.height === 768) {
        assert(density.poolRows >= MIN_POOL_ROWS_AT_1366, `${themed}: ${String(density.poolRows)} full pool rows are visible; it needs ${String(MIN_POOL_ROWS_AT_1366)}`);
      }
      console.log(`  ${themed}: ${String(density.boardRounds)} board rounds, ${String(density.poolRows)} pool rows${density.checklist ? ' (checklist open)' : ''}`);
    });
    assertNoConsoleErrors(errors, label);
  } finally {
    await page.close();
  }
}

/** With the setup checklist open, the pool footer stays in the window and four whole pool rows remain (F7). */
export async function checkChecklistPool(browser: Browser, viewport: { readonly width: number; readonly height: number }): Promise<void> {
  const label = `Draft room with checklist @ ${String(viewport.width)}x${String(viewport.height)}`;
  const page = await gatePage(browser, { viewport });
  try {
    const errors = watchErrors(page);
    await page.goto(`${ORIGIN}/__visual/draft?state=checklist`);
    await page.waitForSelector('html[data-visual-ready]', { timeout: 20_000 });
    await page.locator('.draft-dock-checklist').waitFor();
    await page.locator('.draft-pool-footer').waitFor();
    await assertPoolFooterVisible(page, label);
    const density = await visibleDensity(page);
    assert(density.poolRows >= MIN_POOL_ROWS_WITH_CHECKLIST, `${label}: ${String(density.poolRows)} full pool rows are visible; it needs ${String(MIN_POOL_ROWS_WITH_CHECKLIST)}`);
    assertNoConsoleErrors(errors, label);
    console.log(`  ${label}: ${String(density.poolRows)} pool rows`);
  } finally {
    await page.close();
  }
}

export function footerCount(text: string): number {
  return Number(/(\d+) players shown/.exec(text)?.[1] ?? NaN);
}

/**
 * Search, queue, mock picks and navigation in the real draft workspace. The checked-in
 * data is usually older than the live limit, which also covers browsing while advice is paused.
 */
export async function checkDraftFlow(browser: Browser): Promise<void> {
  const page = await gatePage(browser, { viewport: { width: DESKTOP, height: 900 } });
  try {
    const errors = watchErrors(page);
    await page.goto(`${ORIGIN}/draft`);
    await activateStorage(page);
    const pool = page.locator('.draft-pool');
    const footer = pool.locator('.draft-pool-footer');
    await footer.getByText(/players shown/).waitFor({ timeout: 20_000 });
    const paused = await pool.locator('.draft-pool-paused').count() > 0;
    // A setup checklist at the top of the dock must leave the pool its heading and a row, inside the panel that clips it.
    if (await page.locator('.draft-dock-checklist').count() > 0) {
      const visible = await pool.locator('.draft-pool-scroll').evaluate((element) => {
        const panel = element.closest('.draft-dock-panel')?.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return panel ? Math.min(box.bottom, panel.bottom) - Math.max(box.top, panel.top) : box.height;
      });
      assert(visible >= 105, `The setup checklist leaves ${String(Math.round(visible))}px of the player pool visible; it needs the heading and a row (105px)`);
    }
    const total = footerCount(await footer.innerText());
    assert(total > 60, `Player pool shows ${String(total)} players; it should list the whole undrafted pool`);

    // A defense ranks far outside the 60-player recommendation shortlist.
    await pool.getByRole('button', { name: /^DEF/ }).click();
    const target = (await pool.locator('.draft-pool-name').first().innerText()).trim();
    await pool.getByRole('button', { name: /^All/ }).click();
    await pool.getByRole('textbox').fill(target);
    await pool.locator('.draft-pool-name', { hasText: target }).first().waitFor();
    assert(footerCount(await footer.innerText()) >= 1, `Search for ${target} found nothing`);

    const queue = pool.getByRole('button', { name: `Add ${target} to queue` });
    await queue.click();
    const unqueue = pool.getByRole('button', { name: `Remove ${target} from queue` });
    await unqueue.waitFor();
    assert(await unqueue.getAttribute('aria-pressed') === 'true', `Queueing ${target} did not mark it queued`);
    await unqueue.click();
    await queue.waitFor();

    await page.getByRole('button', { name: 'Start mock', exact: true }).click();
    // CPU teams pick automatically until the user's slot.
    await page.getByRole('button', { name: 'Start mock draft' }).click();
    const draft = pool.getByRole('button', { name: `Draft ${target}` });
    await draft.and(page.locator(':enabled')).waitFor({ timeout: MOCK_TIMEOUT_MS });
    await draft.click();
    await pool.getByText('No available players match these filters.').waitFor();
    await page.locator('.draft-board').getByText(target).first().waitFor();

    await page.getByRole('button', { name: 'Assistant', exact: true }).first().click();
    await page.waitForURL(/\/assistant/);
    await page.locator('.rec-workspace:not([aria-busy])').waitFor({ timeout: 20_000 });
    await page.goBack();
    await page.waitForURL(/\/draft/);
    await page.locator('.draft-board').getByText(target).first().waitFor();

    assert(errors().length === 0, `Draft flow: ${errors().join('; ')}`);
    console.log(`  draft flow: found, queued and drafted ${target} from ${String(total)} players${paused ? ' while advice was paused' : ''}`);
  } finally {
    await page.close();
  }
}

export async function assertPoolColumns(page: Page, label: string): Promise<void> {
  const result = await page.locator('.draft-pool-heading').evaluate((heading, columns) => {
    const hidden = columns.filter((column) => {
      const cell = heading.querySelector(`[data-col="${column}"]`);
      return !cell || cell.getBoundingClientRect().width === 0;
    });
    const scroll = heading.closest('.draft-pool-scroll');
    return { hidden, overflow: scroll ? scroll.scrollWidth - scroll.clientWidth : 0, poolWidth: scroll?.clientWidth ?? 0 };
  }, [...POOL_COLUMNS]);
  assert(result.hidden.length === 0, `${label}: the ${String(result.poolWidth)}px pool hides ${result.hidden.join(', ')}`);
  assert(result.overflow <= 1, `${label}: the pool scrolls sideways by ${String(result.overflow)}px`);
}

/**
 * Pool columns at laptop widths, where the split dock's 360px sidebar narrows the pool: without and
 * with the mock draft's Draft column, every optional column fits without sideways scrolling.
 */
export async function checkPoolColumns(browser: Browser, width: number): Promise<void> {
  const page = await gatePage(browser, { viewport: { width, height: 900 } });
  try {
    const errors = watchErrors(page);
    await page.goto(`${ORIGIN}/draft`);
    await activateStorage(page);
    await page.locator('.draft-pool-footer').getByText(/players shown/).waitFor({ timeout: 20_000 });
    await forEachTheme(page, (theme) => assertPoolColumns(page, `Pool without Draft column @ ${String(width)}px ${theme}`));
    await page.getByRole('button', { name: 'Start mock', exact: true }).click();
    await page.getByRole('button', { name: 'Start mock draft' }).click();
    await page.locator('.draft-pool-table.has-draft-action').waitFor({ timeout: 20_000 });
    await forEachTheme(page, (theme) => assertPoolColumns(page, `Pool with Draft column @ ${String(width)}px ${theme}`));
    assertNoConsoleErrors(errors, `Pool columns @ ${String(width)}px`);
  } finally {
    await page.close();
  }
}

/** The real workspace on a phone: the setup checklist stays readable and nothing overflows. */
export async function checkPhoneWorkspace(browser: Browser): Promise<void> {
  const page = await gatePage(browser, { viewport: { width: PHONE, height: 844 } });
  try {
    const errors = watchErrors(page);
    await page.goto(`${ORIGIN}/draft`);
    await activateStorage(page);
    await page.locator('.draft-pool-footer').getByText(/players shown/).waitFor({ timeout: 20_000 });
    if (await page.locator('.draft-setup-item').count() > 0) await assertReadableChecklist(page, 'Draft workspace @ 390px');
    await assertNoPageOverflow(page, 'Draft workspace @ 390px');
    assertNoConsoleErrors(errors, 'Draft workspace @ 390px');
  } finally {
    await page.close();
  }
}

/**
 * A page that fails to load offers a way back while the draft state stays mounted,
 * and "Reload app" loads it once the network recovers.
 */
export async function checkRouteFailure(browser: Browser): Promise<void> {
  const page = await gatePage(browser, { viewport: { width: DESKTOP, height: 900 } });
  try {
    // The blocked Assistant module, and the error boundary reporting it, are what this check causes on purpose.
    const errors = watchErrors(page, [/AssistantPage\.tsx/, /Failed to fetch dynamically imported module/, /error occurred in the <\w+> component/i, /The above error occurred/, /Importing a module script failed/], [/AssistantPage\.tsx/]);
    const assistantModule = '**/src/features/assistant/AssistantPage.tsx*';
    await page.route(assistantModule, (route) => route.abort());
    await page.goto(`${ORIGIN}/draft`);
    await activateStorage(page);
    await page.getByRole('button', { name: 'Start mock', exact: true }).click();
    await page.getByRole('button', { name: 'Start mock draft' }).click();
    // Pause so CPU picks cannot move the current pick between the two reads.
    await page.getByRole('button', { name: 'Pause' }).click();
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
    await page.locator('.rec-workspace:not([aria-busy])').waitFor({ timeout: 20_000 });
    assertNoConsoleErrors(errors, 'Route failure fallback');
  } finally {
    await page.close();
  }
}
