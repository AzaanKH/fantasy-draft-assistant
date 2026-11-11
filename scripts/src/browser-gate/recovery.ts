/**
 * Browser gate: a save that never settles turns into a Retry after the 15-second timeout, for a Draft pick and for a
 * queue write (round 12, items B13 and D28). The dev server's fault hooks (web-app/src/workspace/dev-fault-injection.ts)
 * hang exactly the next save.
 */
import { type Browser } from 'playwright';
import { SUGGESTION_CARDS } from './config.js';
import { GateFailure, assert, assertNoConsoleErrors, gatePage, openPausedMockAssistant, watchErrors } from './harness.js';

/** The app's timeout (PICK_SAVE_TIMEOUT_MS and QUEUE_SAVE_TIMEOUT_MS), plus room for the notice to render. */
const HUNG_SAVE_WAIT_MS = 15_000 + 1_500;

export async function checkHungPickSave(browser: Browser): Promise<void> {
  const label = 'Hung Draft save @ 1280x800';
  const page = await gatePage(browser, { viewport: { width: 1280, height: 800 } });
  try {
    const errors = watchErrors(page);
    await openPausedMockAssistant(page);
    const card = page.locator('.suggestion-list .suggestion-row').first();
    await page.locator('.suggestion-list .suggestion-row').nth(SUGGESTION_CARDS - 1).waitFor({ timeout: 20_000 });
    const name = (await card.locator('h3').innerText()).trim();
    const before = await page.locator('.draft-session-pick').first().textContent();
    await page.evaluate(() => { Object.assign(window, { __draftHangNextPickSave: true }); });
    await card.getByRole('button', { name: `Draft ${name}`, exact: true }).click();
    await page.waitForTimeout(1_000);
    assert(await card.getByText('Saving…').count() === 1, `${label}: the hung save does not show Saving… while it waits`);
    // Before the timeout nothing offers Retry; after it the card's own Draft has become Retry with the reason.
    await page.waitForTimeout(HUNG_SAVE_WAIT_MS - 1_000);
    const retry = card.getByRole('button', { name: `Retry drafting ${name}`, exact: true })
      .or(page.locator('aside[aria-label="Pick not saved"]').getByRole('button', { name: 'Retry' }));
    assert(await retry.count() > 0, `${label}: no Retry after ${String(HUNG_SAVE_WAIT_MS / 1000)}s for the hung save of ${name}`);
    assert(await page.getByText(/may not have been saved\. The save did not finish within 15 seconds/).count() > 0, `${label}: the timeout does not say the save may not have finished`);
    await retry.first().click();
    await page.waitForFunction((previous) => document.querySelector('.draft-session-pick')?.textContent !== previous, before, { timeout: 10_000 })
      .catch(() => { throw new GateFailure(`${label}: Retry did not save ${name}`); });
    assertNoConsoleErrors(errors, label);
    console.log(`  ${label}: Retry appeared after the 15s timeout and saved ${name}`);
  } finally {
    await page.close();
  }
}

export async function checkHungQueueSave(browser: Browser): Promise<void> {
  const label = 'Hung queue save @ 1280x800';
  const page = await gatePage(browser, { viewport: { width: 1280, height: 800 } });
  try {
    const errors = watchErrors(page);
    await openPausedMockAssistant(page);
    await page.locator('.suggestion-list .suggestion-row').nth(SUGGESTION_CARDS - 1).waitFor({ timeout: 20_000 });
    const card = page.locator('.suggestion-list .suggestion-row').nth(1);
    const name = (await card.locator('h3').innerText()).trim();
    const queue = card.getByRole('button', { name: `Add ${name} to queue`, exact: true });
    await page.evaluate(() => { Object.assign(window, { __draftHangNextQueueSave: true }); });
    await queue.click();
    await page.waitForTimeout(HUNG_SAVE_WAIT_MS);
    const notice = page.locator('[data-sonner-toast]').filter({ hasText: `${name} may not have been added to your queue` });
    assert(await notice.count() === 1, `${label}: no notice after ${String(HUNG_SAVE_WAIT_MS / 1000)}s for the hung queue save of ${name}`);
    // The notice stays past the toasts' usual 6 seconds, with Retry and Dismiss, until one is chosen.
    await page.waitForTimeout(6_500);
    assert(await notice.count() === 1, `${label}: the failure notice timed out and took its Retry with it`);
    assert(await notice.getByRole('button', { name: 'Dismiss', exact: true }).count() === 1, `${label}: the notice has no Dismiss`);
    await notice.getByRole('button', { name: 'Retry', exact: true }).click();
    await card.getByRole('button', { name: `Remove ${name} from queue`, exact: true }).waitFor({ timeout: 10_000 })
      .catch(() => { throw new GateFailure(`${label}: Retry did not queue ${name}`); });
    assertNoConsoleErrors(errors, label);
    console.log(`  ${label}: notice with Retry and Dismiss after the 15s timeout; Retry queued ${name}`);
  } finally {
    await page.close();
  }
}
