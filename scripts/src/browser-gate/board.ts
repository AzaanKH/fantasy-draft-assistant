/**
 * Browser gate: the draft board's height, live-pick following, dock hotkeys and the Appearance menu.
 */
import { type Browser, type Page } from 'playwright';
import { LATER_ROUND, MIN_BOARD_ROUNDS, MOCK_TIMEOUT_MS, ORIGIN } from './config.js';
import { statusArrowOverlaps } from './draft-room.js';
import { GateFailure, activateStorage, advanceMockToRound, assert, assertNoConsoleErrors, forEachTheme, gatePage, startMockUntilOnClock, visibleDensity, watchErrors } from './harness.js';

/** Late in the draft the board still shows the live round and the next two whole at laptop heights. */
export async function checkLaterRoundBoard(browser: Browser, viewport: { readonly width: number; readonly height: number }): Promise<void> {
  const label = `Board at pick ${String(LATER_ROUND)}.05 @ ${String(viewport.width)}x${String(viewport.height)}`;
  const page = await gatePage(browser, { viewport });
  try {
    const errors = watchErrors(page);
    await page.goto(`${ORIGIN}/draft`);
    await activateStorage(page);
    await startMockUntilOnClock(page);
    await advanceMockToRound(page, LATER_ROUND);
    await page.getByRole('button', { name: 'Pause' }).click();
    // Let the follow-live smooth scroll settle.
    await page.waitForTimeout(800);
    await forEachTheme(page, async (theme) => {
      const themed = `${label} ${theme}`;
      const density = await visibleDensity(page);
      assert(density.boardRounds >= MIN_BOARD_ROUNDS, `${themed}: the board shows ${String(density.boardRounds)} full rounds; it needs ${String(MIN_BOARD_ROUNDS)}`);
      const touching = await statusArrowOverlaps(page);
      assert(touching.length === 0, `${themed}: board status text overlaps the direction arrow: ${touching.join(', ')}`);
      // The default 12-team board fits without sideways scrolling from 1280px, and every cell stays readable.
      const fit = await boardFit(page);
      assert(fit.overflow <= 1, `${themed}: the 12-team board scrolls sideways by ${String(fit.overflow)}px (team columns ${String(fit.columnWidth)}px)`);
      assert(fit.clipped.length === 0, `${themed}: board cells clip their text: ${fit.clipped.slice(0, 6).join(', ')}`);
      console.log(`  ${themed}: ${String(density.boardRounds)} board rounds, ${String(fit.columnWidth)}px team columns, no sideways scroll`);
    });
    assertNoConsoleErrors(errors, label);
  } finally {
    await page.close();
  }
}

/** Sideways overflow of the board, its team column width, and visible pick cells whose name or position is cut off. */
export async function boardFit(page: Page): Promise<{ readonly overflow: number; readonly columnWidth: number; readonly clipped: readonly string[] }> {
  return page.evaluate(() => {
    const board = document.querySelector<HTMLElement>('.board-scroll');
    if (!board) return { overflow: Number.POSITIVE_INFINITY, columnWidth: 0, clipped: ['no board'] };
    const box = board.getBoundingClientRect();
    const clipped = [...board.querySelectorAll<HTMLElement>('.board-player-name, .board-player-meta')].flatMap((text) => {
      const rect = text.getBoundingClientRect();
      if (rect.width === 0 || rect.bottom <= box.top || rect.top >= box.bottom) return [];
      const shown = [...text.children].find((child) => getComputedStyle(child).display !== 'none' && !getComputedStyle(child).clipPath.includes('inset')) ?? text;
      return text.scrollWidth > text.clientWidth + 1 || text.scrollHeight > text.clientHeight + 1
        ? [`"${(shown.textContent ?? '').trim()}" (${String(text.clientWidth)}px box, ${String(text.scrollWidth)}x${String(text.scrollHeight)} content)`]
        : [];
    });
    return {
      overflow: Math.round(board.scrollWidth - board.clientWidth),
      columnWidth: Math.round(board.querySelector('.board-team-header')?.getBoundingClientRect().width ?? 0),
      clipped,
    };
  });
}

/** Without a dragged height, the board's default follows the window from 1280x800 to 1440x900 and 1920x1080. */
export async function checkBoardHeightFollowsResize(browser: Browser): Promise<void> {
  const page = await gatePage(browser, { viewport: { width: 1280, height: 800 } });
  try {
    const errors = watchErrors(page);
    await page.goto(`${ORIGIN}/draft`);
    await activateStorage(page);
    await page.evaluate(() => { window.localStorage.removeItem('draft-board-height'); });
    await page.reload();
    await activateStorage(page);
    await page.locator('.draft-pool-footer').getByText(/players shown/).waitFor({ timeout: 20_000 });
    const measure = () => page.evaluate(() => ({
      board: Math.round(Number.parseFloat(document.querySelector<HTMLElement>('.board-scroll')?.style.getPropertyValue('--draft-board-height') ?? '0')),
      expected: Math.round(Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--board-default-height'))),
    }));
    const heights: number[] = [];
    for (const size of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(150);
      const { board, expected } = await measure();
      assert(board === expected, `Board height @ ${String(size.width)}x${String(size.height)} is ${String(board)}px; the window default is ${String(expected)}px`);
      heights.push(board);
    }
    assert(new Set(heights).size > 1, `The board stayed ${String(heights[0])}px through every resize`);
    console.log(`  board default height: ${heights.join(' -> ')}px`);
    assertNoConsoleErrors(errors, 'Board height follows resize');
  } finally {
    await page.close();
  }
}

/** Where the on-clock slot sits against its board's visible area (right of the sticky round column). */
export async function liveSlotPlacement(page: Page): Promise<{ readonly visible: boolean; readonly scrollLeft: number; readonly detail: string; readonly jump: boolean }> {
  return page.evaluate(() => {
    const board = document.querySelector<HTMLElement>('.board-scroll');
    const slot = board?.querySelector('.board-slot.is-on-clock');
    if (!board || !slot) return { visible: false, scrollLeft: 0, detail: 'no board or live slot', jump: false };
    const box = board.getBoundingClientRect();
    const live = slot.getBoundingClientRect();
    const left = box.left + (Number(board.dataset.roundColumnWidth) || 56);
    return {
      visible: live.left >= left - 1 && live.right <= box.right + 1,
      scrollLeft: board.scrollLeft,
      detail: `live slot x=${String(Math.round(live.left))}-${String(Math.round(live.right))}, board x=${String(Math.round(left))}-${String(Math.round(box.right))}, scrollLeft=${String(board.scrollLeft)}`,
      jump: document.querySelector('.board-jump-live') !== null,
    };
  });
}

/** Shrinks the window the way a drag does, through many intermediate widths, then lets it settle. */
export async function dragResize(page: Page, from: number, to: number, height: number): Promise<void> {
  for (let width = from; width > to; width -= 24) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(8);
  }
  await page.setViewportSize({ width: to, height });
  await page.waitForTimeout(1000);
}

/**
 * A 14-team mock paused with pick 1.14 live (12 teams now fit at 1280px, so 14 is the case that still scrolls
 * sideways): shrinking the window from 1920x900 to 1280x900 without scrolling keeps the live slot in view in both
 * board views (R5-9). In the full board, scrolling it away first keeps following paused.
 */
export async function checkBoardFollowsLiveOnResize(browser: Browser): Promise<void> {
  const page = await gatePage(browser, { viewport: { width: 1920, height: 900 } });
  try {
    const errors = watchErrors(page);
    await page.goto(`${ORIGIN}/draft`);
    await activateStorage(page);
    await page.getByRole('button', { name: 'Start mock', exact: true }).click();
    await page.getByLabel('League teams').fill('14');
    await page.getByLabel('Your draft slot').fill('14');
    await page.getByRole('button', { name: 'Start mock draft' }).click();
    await page.locator('.draft-turn-banner[data-state="on-clock"]').first().waitFor({ timeout: MOCK_TIMEOUT_MS });
    await page.getByRole('button', { name: 'Pause' }).click();
    const pick = await page.locator('.board-current-pick').first().innerText();
    assert(pick.includes('1.14'), `Board resize: the live pick is ${pick}, not 1.14`);
    for (const view of ['Current pick', 'Full board'] as const) {
      await page.setViewportSize({ width: 1920, height: 900 });
      await page.getByRole('button', { name: view }).click();
      await page.waitForTimeout(800);
      await dragResize(page, 1920, 1280, 900);
      const placement = await liveSlotPlacement(page);
      assert(placement.visible && placement.scrollLeft > 0, `Board resize (${view}) 1920x900 -> 1280x900: ${placement.detail}`);
    }
    // Full board, scrolled away on purpose: a resize keeps the pause and its Jump to live pick.
    await page.locator('.board-scroll').hover();
    await page.mouse.wheel(-2000, 0);
    await page.locator('.board-jump-live').waitFor({ timeout: 5_000 });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    await dragResize(page, 1440, 1280, 900);
    const paused = await liveSlotPlacement(page);
    assert(paused.jump && !paused.visible, `Board resize after scrolling away: following resumed (${paused.detail})`);
    // Current pick keeps a deliberate scroll-away the same way, until Jump to live pick.
    await page.getByRole('button', { name: 'Current pick' }).click();
    await page.waitForTimeout(800);
    await page.locator('.board-scroll').hover();
    await page.mouse.wheel(-2000, 0);
    await page.locator('.board-jump-live').waitFor({ timeout: 5_000 });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    await dragResize(page, 1440, 1280, 900);
    const currentPaused = await liveSlotPlacement(page);
    assert(currentPaused.jump && !currentPaused.visible, `Board resize (Current pick) after scrolling away: following resumed (${currentPaused.detail})`);
    await page.locator('.board-jump-live').click();
    await page.waitForTimeout(800);
    const resumed = await liveSlotPlacement(page);
    assert(resumed.visible && !resumed.jump, `Board (Current pick): Jump to live pick did not return to the live slot (${resumed.detail})`);
    assertNoConsoleErrors(errors, 'Board resize');
  } finally {
    await page.close();
  }
}

/**
 * Keys 1-4 act page-wide on the clock even while the dock shows Roster, whose tabs unmount the Suggestions list.
 * Pressing 1 with nothing focused drafts the top suggestion: the turn moves on.
 */
export async function checkDockRosterHotkeys(browser: Browser): Promise<void> {
  const label = 'Keys 1-4 with the dock on Roster @ 1440x900';
  const page = await gatePage(browser, { viewport: { width: 1440, height: 900 } });
  try {
    const errors = watchErrors(page);
    await page.goto(`${ORIGIN}/draft`);
    await activateStorage(page);
    await startMockUntilOnClock(page);
    await page.getByRole('button', { name: 'Pause' }).click();
    const rosterTab = page.locator('.draft-dock-tabs [role="tab"]').filter({ hasText: 'Roster' });
    assert(await rosterTab.getAttribute('data-state') === 'active', `${label}: the dock did not open on Roster`);
    assert(await page.locator('.draft-dock [data-suggestion-list]').count() === 0, `${label}: the Suggestions list is mounted while Roster is open`);
    // Each key on its own turn: press it with nothing focused, then let the CPU teams pick until the clock returns.
    for (const key of ['1', '2', '3', '4']) {
      if (key !== '1') {
        // A pick of your own may already resume the mock; only a still-paused one needs Resume.
        const resume = page.getByRole('button', { name: 'Resume' });
        if (await resume.count() > 0) await resume.first().click();
        await page.locator('.draft-turn-banner[data-state="on-clock"]').first().waitFor({ timeout: MOCK_TIMEOUT_MS });
        await page.getByRole('button', { name: 'Pause' }).click();
      }
      const before = await page.locator('.board-current-pick').first().innerText();
      const mine = await page.locator('.draft-dock .draft-roster-slot .draft-roster-name').count();
      await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
      await page.keyboard.press(key);
      await page.waitForFunction((previous) => document.querySelector('.board-current-pick')?.textContent !== previous, before, { timeout: 10_000 })
        .catch(() => { throw new GateFailure(`${label}: pressing ${key} did not draft (still ${before})`); });
      const after = await page.locator('.draft-dock .draft-roster-slot .draft-roster-name').count();
      assert(after === mine + 1, `${label}: pressing ${key} did not add a player to your roster (${String(mine)} → ${String(after)})`);
    }
    assertNoConsoleErrors(errors, label);
  } finally {
    await page.close();
  }
}

/**
 * After an Appearance choice at 1280x800 the tooltip stays closed and nothing of it intercepts the neighbouring
 * Full board control (R8-2): a real pointer click on Full board switches the board view.
 */
export async function checkAppearanceThenFullBoard(browser: Browser): Promise<void> {
  const label = 'Appearance then Full board @ 1280x800';
  const page = await gatePage(browser, { viewport: { width: 1280, height: 800 } });
  try {
    const errors = watchErrors(page);
    await page.goto(`${ORIGIN}/draft`);
    await activateStorage(page);
    for (const theme of ['Dark', 'Light'] as const) {
      await page.locator('button[aria-label^="Appearance"]').click();
      await page.getByRole('menuitemradio', { name: theme }).click();
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Appearance') === true, null, { timeout: 3_000 });
      await page.waitForTimeout(600);
      assert(await page.locator('[data-slot="tooltip-content"]').count() === 0, `${label}: the Appearance tooltip reopened after choosing ${theme}`);
      const fullBoard = page.getByRole('button', { name: 'Full board' });
      const currentPick = page.getByRole('button', { name: 'Current pick' });
      // Playwright's click fails when another element would receive it, so this proves nothing covers the control.
      await fullBoard.click({ timeout: 3_000 }).catch(() => { throw new GateFailure(`${label}: after ${theme}, the Full board click was intercepted`); });
      assert(await fullBoard.getAttribute('aria-pressed') === 'true', `${label}: after ${theme}, Full board did not switch the board view`);
      await currentPick.click();
    }
    assertNoConsoleErrors(errors, label);
  } finally {
    await page.close();
  }
}
