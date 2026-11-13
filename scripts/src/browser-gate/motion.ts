/**
 * Browser gate: recorded motion with and without reduced motion.
 */
import { type Browser } from 'playwright';
import { MOCK_TIMEOUT_MS, ORIGIN } from './config.js';
import { activateStorage, assert, assertNoConsoleErrors, gateContext, startMockUntilOnClock, watchErrors } from './harness.js';

/** Records every WAAPI animation, CSS animation and CSS transition the page starts, with a short target name. */
export const MOTION_RECORDER = `(() => {
  const records = [];
  const describe = (element, pseudo) => element instanceof Element
    ? element.tagName.toLowerCase() + (element.id ? '#' + element.id : '') + (typeof element.className === 'string' && element.className ? '.' + element.className.trim().split(/\\s+/).join('.') : '') + (pseudo || '')
    : String(element);
  const ancestry = (element) => { const names = []; for (let node = element; node instanceof Element; node = node.parentElement) names.push(describe(node)); return names.join(' < '); };
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    records.push({ kind: 'waapi', name: '', target: ancestry(this), pseudo: (options && options.pseudoElement) || '' });
    return animate.call(this, keyframes, options);
  };
  document.addEventListener('animationstart', (event) => { records.push({ kind: 'animation', name: event.animationName, target: ancestry(event.target), pseudo: event.pseudoElement || '' }); }, true);
  document.addEventListener('transitionrun', (event) => { records.push({ kind: 'transition', name: event.propertyName, target: ancestry(event.target), pseudo: event.pseudoElement || '' }); }, true);
  window.__motionRecords = records;
})();`;

export interface MotionRecord { readonly kind: 'waapi' | 'animation' | 'transition'; readonly name: string; readonly target: string; readonly pseudo: string }
/** The element itself: the first entry of the recorded ancestry. */
export const ownTarget = (record: MotionRecord): string => record.target.split(' < ')[0] ?? '';

/**
 * The four motions reduced motion must switch off, matched by how each is built (not by colour transitions on the
 * same elements, which are feedback and stay): the WAAPI ring pulse, the pick-landed keyframes and row slide, the
 * analysis opacity fade, and the chevron's transform transition.
 */
export const REDUCED_MOTIONS: readonly { readonly name: string; readonly matches: (record: MotionRecord) => boolean }[] = [
  { name: 'turn pulse', matches: (record) => record.kind === 'waapi' && record.pseudo === '::after' && /draft-turn-banner|board-current-pick/.test(ownTarget(record)) },
  { name: 'pick landed', matches: (record) => (record.kind === 'animation' && /^draft-(pool-row-leave|roster-filled)$/.test(record.name))
    || (record.kind === 'transition' && record.name === 'transform' && record.target.includes('draft-pool-rows')) },
  { name: 'analysis crossfade', matches: (record) => record.kind === 'waapi' && /^section\.rec-analysis/.test(ownTarget(record)) },
  { name: 'Full reasoning chevron', matches: (record) => record.kind === 'transition' && record.name === 'transform' && ownTarget(record).startsWith('svg') && record.target.includes('rec-details') },
];

/** Drives the turn pulse, a pick landing, an analysis subject change and the Full reasoning chevron; returns what moved. */
export async function recordMotions(browser: Browser, reducedMotion: 'reduce' | 'no-preference'): Promise<readonly MotionRecord[]> {
  const context = await gateContext(browser, { viewport: { width: 1440, height: 900 }, reducedMotion });
  try {
    await context.addInitScript(MOTION_RECORDER);
    const page = await context.newPage();
    const errors = watchErrors(page);
    await page.goto(`${ORIGIN}/draft`);
    await activateStorage(page);
    await startMockUntilOnClock(page);
    const before = await page.locator('.board-current-pick').first().innerText();
    await page.locator('.draft-pool [data-player-row] button[aria-label^="Draft "]:enabled').first().click();
    await page.waitForFunction((previous) => document.querySelector('.board-current-pick')?.textContent !== previous, before, { timeout: MOCK_TIMEOUT_MS });
    await page.locator('.draft-turn-banner[data-state="on-clock"]').first().waitFor({ timeout: MOCK_TIMEOUT_MS });
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.getByRole('button', { name: 'Assistant', exact: true }).first().click();
    await page.locator('.suggestion-list .suggestion-row').nth(1).waitFor({ timeout: 20_000 });
    await page.locator('.suggestion-list .suggestion-row').nth(1).locator('[data-suggestion-select]').click();
    // A card's Full reasoning opens the Why tab with the reasoning expanded; closing it turns the chevron.
    await page.locator('.suggestion-list .suggestion-row').first().locator('.suggestion-reason-toggle').click();
    await page.locator('.rec-side .rec-details[open] > summary').click();
    await page.waitForTimeout(400);
    assertNoConsoleErrors(errors, `Motion (${reducedMotion})`);
    return await page.evaluate(() => (window as unknown as { __motionRecords: MotionRecord[] }).__motionRecords);
  } finally {
    await context.close();
  }
}

/**
 * Under prefers-reduced-motion (Playwright's CSS media emulation, not an injected flag) the turn pulse, pick-landed
 * motion, analysis crossfade and chevron do not run. The same flow without the preference must show each one, so
 * the check cannot pass by recording nothing.
 */
export async function checkReducedMotion(browser: Browser): Promise<void> {
  const normal = await recordMotions(browser, 'no-preference');
  const silent = REDUCED_MOTIONS.filter((motion) => !normal.some(motion.matches)).map((motion) => motion.name);
  assert(silent.length === 0, `Motion control: ${silent.join(', ')} did not run with motion allowed, so the reduced-motion check would prove nothing`);
  const reduced = await recordMotions(browser, 'reduce');
  const running = REDUCED_MOTIONS.flatMap((motion) => reduced.filter(motion.matches).slice(0, 2)
    .map((record) => `${motion.name}: ${record.kind} ${record.name} on ${ownTarget(record)}${record.pseudo}`));
  assert(running.length === 0, `Reduced motion still animates: ${running.join('; ')}`);
}
