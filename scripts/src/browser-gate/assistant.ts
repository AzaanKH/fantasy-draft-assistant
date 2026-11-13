/**
 * Browser gate: the Assistant's suggestions, analysis geometry, cold load and failure recovery.
 */
import { type Browser, type Page } from 'playwright';
import { ANALYSIS_MAX_HEIGHT, ANALYSIS_MIN_HEIGHT, ASSISTANT_RAIL_BREAKPOINT, CARD_CHIP_SELECTOR, CARD_HEIGHT, LEAD_CARD_HEIGHT, MAX_CARD_CHIPS, MAX_COLD_LOAD_CLS, MIN_ANSWER_HEIGHT, MIN_POOL_ROWS_ABOVE_FOLD, MOCK_TIMEOUT_MS, ORIGIN, RAIL_SUMMARY_HEIGHT, ROW_MAX_HEIGHT, ROW_MIN_HEIGHT, SIDE_GAP, SUGGESTION_CARDS, TIER_CLOSE_HEIGHT } from './config.js';
import { GateFailure, activateStorage, assert, assertNoConsoleErrors, clippedText, forEachTheme, gateContext, gatePage, openPausedMockAssistant, watchErrors } from './harness.js';
import { THEMES } from './config.js';

/**
 * On the Assistant the page-wide keys act only on a card that is on screen (item 1): with search results in place of
 * the cards (focus moved off the search to a result) or with the tier view open, 1-4 draft nothing. Back on the
 * cards, 1 drafts, so the check cannot pass with keys that never work.
 */
export async function checkAssistantHiddenCardKeys(browser: Browser): Promise<void> {
  const label = 'Assistant keys 1-4 with the cards hidden @ 1280x800';
  const page = await gatePage(browser, { viewport: { width: 1280, height: 800 } });
  try {
    const errors = watchErrors(page);
    await openPausedMockAssistant(page);
    await page.locator('.suggestion-list .suggestion-row').nth(SUGGESTION_CARDS - 1).waitFor({ timeout: 20_000 });
    const pick = page.locator('.draft-session-pick').first();
    const before = await pick.innerText();
    const unchanged = async (situation: string): Promise<void> => {
      for (const key of ['1', '2', '3', '4']) await page.keyboard.press(key);
      await page.waitForTimeout(1_000);
      assert(await pick.innerText() === before, `${label}: ${situation}, a number key drafted a hidden card (${before} → ${await pick.innerText()})`);
    };
    await page.locator('#rec-view-panel-suggestions .rec-search input').fill('a');
    await page.locator('.rec-pool-list .rec-candidate-identity').first().click();
    assert(await page.locator('.suggestion-list').count() === 0, `${label}: the cards stayed beside the search results`);
    await unchanged('with search results replacing the cards');
    await page.locator('#rec-view-panel-suggestions .rec-search input').press('Escape');

    await page.getByRole('tab', { name: 'Position tiers' }).click();
    await page.locator('.rec-tier-row:not([data-drafted="true"]) .rec-tier-identity').first().click();
    await page.locator('.rec-tiers-analysis').waitFor();
    await unchanged('in Position tiers with the tier analysis focused');

    await page.getByRole('tab', { name: 'Suggestions', exact: true }).click();
    await page.locator('.suggestion-list .suggestion-row').nth(SUGGESTION_CARDS - 1).waitFor({ timeout: 20_000 });
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
    await page.keyboard.press('1');
    await page.waitForFunction((previous) => document.querySelector('.draft-session-pick')?.textContent !== previous, before, { timeout: 10_000 })
      .catch(() => { throw new GateFailure(`${label}: with the cards on screen, 1 did not draft (control)`); });
    assertNoConsoleErrors(errors, label);
  } finally {
    await page.close();
  }
}

/** How often the page states the analysis subject's timing facts, and whether the analysis follows the selected card. */
export async function decisionFacts(page: Page): Promise<{
  readonly decisions: number;
  readonly availability: number;
  readonly waitingCost: number;
  readonly fallback: number;
  readonly selectedCardPercent: number;
  readonly cardPercents: number;
  readonly cards: number;
  readonly timingSummaries: number;
  readonly analysisHeight: number;
  readonly vor: number;
  readonly subject: string;
  readonly selected: string;
  readonly cardChips: readonly number[];
  /** Figures ("45 pts", "72%") the verdict's reason states; the cost and the % each have their own place. */
  readonly reasonFigures: readonly string[];
  /** The waiting cost's value ("45.0 pts" → 45), and how often that figure appears elsewhere in the decision block. */
  readonly costRepeats: number;
}> {
  return page.evaluate((chips) => {
    const panel = document.querySelector('#rec-analysis-panel')?.textContent ?? '';
    return {
      // Scoped to the elements that state each fact, never the verdict's screen-reader rule text (its 50%/70%).
      decisions: document.querySelectorAll('.rec-workspace .rec-decision').length,
      availability: document.querySelectorAll('.rec-workspace [data-availability]').length,
      waitingCost: document.querySelectorAll('.rec-workspace [data-waiting-cost]').length,
      fallback: document.querySelectorAll('.rec-workspace [data-fallback]').length,
      // A numeric "72%", never a dash: the card's own estimate, read from its text rather than counted as an element.
      selectedCardPercent: [...document.querySelectorAll('.suggestion-row[data-selected] [data-card-availability] strong')].filter((figure) => /^\d{1,3}%$/.test(figure.textContent?.trim() ?? '')).length,
      cardPercents: [...document.querySelectorAll('.suggestion-row [data-card-availability] strong')].filter((figure) => /^\d{1,3}%$/.test(figure.textContent?.trim() ?? '')).length,
      cards: document.querySelectorAll('.suggestion-row').length,
      // A card's line adds a new fact; the chip and the big figure already say whether the player lasts.
      timingSummaries: [...document.querySelectorAll('.suggestion-row .suggestion-reason > p:first-child')].filter((line) => /%|gone by|still there|available at/i.test(line.textContent ?? '')).length,
      analysisHeight: Math.round((document.querySelector('.rec-side > .rec-analysis')?.getBoundingClientRect().height ?? 0) * 10) / 10,
      vor: panel.match(/VOR [+-]?\d/g)?.length ?? 0,
      subject: document.querySelector('.rec-analysis-name')?.textContent?.trim() ?? '',
      selected: document.querySelector('.suggestion-row[data-selected] .suggestion-select')?.textContent?.trim() ?? '',
      // Every chip a card shows (verdict, Details, reason, risk, injury), badges and position tags too (R8-3).
      cardChips: [...document.querySelectorAll('.suggestion-row')].map((card) => card.querySelectorAll(chips).length),
      reasonFigures: (document.querySelector('.rec-side .rec-decision-reason')?.textContent ?? '').match(/\d+(\.\d+)?\s?(pts?|points|%)/g) ?? [],
      costRepeats: (() => {
        const block = document.querySelector('.rec-side .rec-decision');
        const cost = /^(\d+)(\.\d)? pts$/.exec(block?.querySelector('[data-waiting-cost]')?.textContent?.trim() ?? '');
        if (!block || !cost) return 0;
        // Visible text outside the cost's own cell and the fallback (whose points are a different figure).
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        let text = '';
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.parentElement;
          if (!parent || parent.closest('.sr-only, [data-waiting-cost], [data-fallback], [role="tooltip"]')) continue;
          text += ` ${node.textContent ?? ''}`;
        }
        const value = Number(`${cost[1] ?? ''}${cost[2] ?? ''}`);
        return [...text.matchAll(/(\d+(?:\.\d+)?)\s?(?:pts?|points)/g)].filter((match) => Math.round(Number(match[1])) === Math.round(value)).length;
      })(),
    };
  }, CARD_CHIP_SELECTOR);
}

/** The heights assistant.css intends for this window: the suggestions analysis and the tier drawer. */
export async function intendedAnalysisHeights(page: Page): Promise<{ readonly analysis: number; readonly drawer: number }> {
  const { innerHeight, innerWidth, header } = await page.evaluate(() => ({
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    header: document.querySelector('.draft-app-header')?.getBoundingClientRect().height ?? 0,
  }));
  const available = innerHeight - header - 32;
  const summary = innerWidth >= ASSISTANT_RAIL_BREAKPOINT ? 0 : RAIL_SUMMARY_HEIGHT + SIDE_GAP;
  return {
    analysis: Math.min(ANALYSIS_MAX_HEIGHT, Math.max(ANALYSIS_MIN_HEIGHT, available - summary)),
    drawer: Math.min(ANALYSIS_MAX_HEIGHT + TIER_CLOSE_HEIGHT, Math.max(ANALYSIS_MIN_HEIGHT, available)),
  };
}

export async function assertSingleDecision(page: Page, label: string): Promise<void> {
  const facts = await decisionFacts(page);
  assert(facts.decisions === 1, `${label}: ${String(facts.decisions)} take-now-or-wait blocks; there must be exactly one`);
  const repeats = ([['waiting cost', facts.waitingCost], ['fallback', facts.fallback]] as const)
    .filter(([, times]) => times !== 1);
  assert(repeats.length === 0, `${label}: each timing fact must appear once: ${repeats.map(([fact, times]) => `${fact} ${String(times)}x`).join(', ')}`);
  // The card's big figure is the page's only availability display: every card shows it so the four compare, and
  // neither the analysis nor a card's reason line restates it.
  assert(facts.cardPercents === facts.cards && (facts.cards === 0 || facts.selectedCardPercent === 1), `${label}: ${String(facts.cardPercents)} of ${String(facts.cards)} cards show a numeric availability % (selected: ${String(facts.selectedCardPercent)})`);
  assert(facts.availability === 0, `${label}: the analysis repeats the card's availability figure`);
  assert(facts.timingSummaries === 0, `${label}: ${String(facts.timingSummaries)} card reason lines restate availability`);
  assert(facts.vor <= 1, `${label}: the analysis repeats VOR (${String(facts.vor)}x)`);
  // Each timing value is stated once: the verdict's reason names no figure, and the waiting cost appears only in its cell.
  assert(facts.reasonFigures.length === 0, `${label}: the verdict reason repeats a figure shown elsewhere: ${facts.reasonFigures.join(', ')}`);
  assert(facts.costRepeats === 0, `${label}: the waiting cost is stated ${String(facts.costRepeats + 1)} times in the decision block`);
  const crowded = facts.cardChips.flatMap((count, index) => count > MAX_CARD_CHIPS ? [`card ${String(index + 1)} has ${String(count)}`] : []);
  assert(crowded.length === 0, `${label}: cards show more than ${String(MAX_CARD_CHIPS)} chips: ${crowded.join(', ')}`);
  assert(facts.selected === '' || facts.subject === facts.selected, `${label}: the analysis shows ${facts.subject} while ${facts.selected} is selected`);
}

/** The leader is exactly LEAD_CARD_HEIGHT tall, every other card CARD_HEIGHT, and all are wholly on screen below the sticky header. */
export async function assertCardsKeepHeight(page: Page, label: string): Promise<void> {
  const cards = await page.evaluate(() => {
    const top = document.querySelector('.draft-app-header')?.getBoundingClientRect().bottom ?? 0;
    return [...document.querySelectorAll('.suggestion-list > li')].map((card) => {
      const box = card.getBoundingClientRect();
      return { name: card.querySelector('h3')?.textContent?.trim() ?? '?', height: Math.round(box.height * 10) / 10, whole: box.top >= top - 1 && box.bottom <= window.innerHeight + 1 };
    });
  });
  const off = cards.filter((card, index) => Math.abs(card.height - (index === 0 ? LEAD_CARD_HEIGHT : CARD_HEIGHT)) > 0.5 || !card.whole);
  assert(cards.length === SUGGESTION_CARDS && off.length === 0, `${label}: the leader must stay ${String(LEAD_CARD_HEIGHT)}px, the other cards ${String(CARD_HEIGHT)}px, all whole: ${cards.map((card) => `${card.name} ${String(card.height)}px${card.whole ? '' : ' (cut)'}`).join(', ')}`);
}

/**
 * At 1280x800 the Assistant shows all four suggestion cards whole, and its analysis states each fact once: after
 * selecting every card repeatedly and resizing across the rail breakpoint, one decision block remains (F1). At
 * 1920x1080 no card name is truncated (F4).
 */
export async function checkAssistantSuggestions(browser: Browser): Promise<void> {
  const label = 'Assistant @ 1280x800';
  const page = await gatePage(browser, { viewport: { width: 1280, height: 800 } });
  try {
    const errors = watchErrors(page);
    await openPausedMockAssistant(page);
    await page.locator('.suggestion-list .suggestion-row').nth(SUGGESTION_CARDS - 1).waitFor({ timeout: 20_000 });
    const cards = await page.evaluate(() => {
      const top = document.querySelector('.draft-app-header')?.getBoundingClientRect().bottom ?? 0;
      return [...document.querySelectorAll('.suggestion-list .suggestion-row')].map((card) => {
        const box = card.getBoundingClientRect();
        return { name: card.querySelector('h3')?.textContent?.trim() ?? '?', whole: box.top >= top - 1 && box.bottom <= window.innerHeight + 1, bottom: Math.round(box.bottom) };
      });
    });
    assert(cards.length === SUGGESTION_CARDS, `${label}: ${String(cards.length)} suggestion cards rendered; expected ${String(SUGGESTION_CARDS)}`);
    const cut = cards.filter((card) => !card.whole);
    assert(cut.length === 0, `${label}: cards not fully visible: ${cut.map((card) => `${card.name} (bottom ${String(card.bottom)}px)`).join(', ')}`);

    const analysis = page.locator('section[aria-label="Viewed player analysis"]');
    assert(await analysis.count() === 1, `${label}: ${String(await analysis.count())} analysis areas; there must be exactly one`);
    await forEachTheme(page, async (theme) => {
      await assertCardsKeepHeight(page, `${label} ${theme}, first load`);
      await assertSingleDecision(page, `${label} ${theme}, first load`);
      const cut = await cutFactValues(page);
      assert(cut.length === 0, `${label} ${theme}: analysis fact values are cut off: ${cut.join('; ')}`);
    });
    // Full reasoning opens the analysis's Why tab with the reasoning expanded; the card itself never grows (R9-3), so
    // card 4 stays whole and its key keeps working.
    await page.locator('.suggestion-list .suggestion-row').first().locator('.suggestion-reason-toggle').click();
    assert(await page.locator('#rec-tab-why[aria-selected="true"]').count() === 1, `${label}: Full reasoning did not open Why this player?`);
    assert(await page.locator('.rec-side .rec-analysis details[data-full-reasoning][open]').count() === 1, `${label}: Full reasoning did not expand the reasoning in the analysis`);
    await assertCardsKeepHeight(page, `${label}, after Full reasoning`);
    await page.locator('.suggestion-list .suggestion-row').nth(1).locator('[data-suggestion-select]').click();
    await page.locator('.suggestion-list .suggestion-row').nth(2).hover();
    await assertCardsKeepHeight(page, `${label}, after selecting and hovering`);
    await assertSingleDecision(page, `${label}, first load`);
    assert(!(await page.getByText('Deep analysis').count()), `${label}: the separate Deep analysis card is back`);

    const selectButtons = page.locator('.suggestion-list .suggestion-select');
    for (const [round, width] of [[1, ASSISTANT_RAIL_BREAKPOINT + 100], [2, 1280], [3, ASSISTANT_RAIL_BREAKPOINT + 100]] as const) {
      // The analysis keeps its intended, window-bounded height whichever card is its subject (R7-3: it grew from 732
      // to 854px), and the pinned column never scrolls: the tab answer is the only scroller.
      const { analysis: intended } = await intendedAnalysisHeights(page);
      const heights: number[] = [];
      for (const index of [1, 2, 3, 0]) {
        await selectButtons.nth(index).click();
        await assertSingleDecision(page, `${label}, round ${String(round)} after selecting card ${String(index + 1)}`);
        heights.push((await decisionFacts(page)).analysisHeight);
        const cut = await cutFactValues(page);
        assert(cut.length === 0, `${label}, round ${String(round)}, card ${String(index + 1)}: analysis fact values are cut off: ${cut.join('; ')}`);
      }
      const off = heights.filter((height) => Math.abs(height - intended) > 1);
      assert(off.length === 0, `${label}, round ${String(round)}: the analysis should be ${String(intended)}px for this window on every card; measured ${heights.join(' / ')}px`);
      const side = await page.evaluate(() => {
        const column = document.querySelector('.rec-side');
        const summary = document.querySelector('.rec-side-summary')?.getBoundingClientRect();
        return {
          scrolls: column ? column.scrollHeight > column.clientHeight + 1 : true,
          summary: summary && summary.height > 0 ? { top: summary.top, bottom: summary.bottom } : null,
          wide: window.innerWidth >= 1600, height: window.innerHeight,
        };
      });
      assert(!side.scrolls, `${label}, round ${String(round)}: the analysis column scrolls; only the tab answer may`);
      assert(side.wide || (side.summary !== null && side.summary.top >= 0 && side.summary.bottom <= side.height), `${label}, round ${String(round)}: the "Next turn · Queue" summary is not on screen below the rail breakpoint`);
      if (!side.wide) {
        // Teams pick before the manager's 2.08 here, so the strip names them and what they still need (round 11 item 7).
        const strip = await page.locator('[data-upcoming-needs] [aria-hidden="true"]').textContent() ?? '';
        assert(/^Before you: (T\d+(–\d+)? ([A-Z·]+|all open|set)|all \d+ teams need every position)/.test(strip.trim()), `${label}, round ${String(round)}: the strip does not say what the teams before your pick need ("${strip}")`);
        const clipped = await clippedText(page, '.rec-side-summary-line');
        assert(clipped.length === 0, `${label}, round ${String(round)}: summary lines are cut off: ${clipped.join(', ')}`);
      }
      await page.setViewportSize({ width, height: width > 1280 ? 900 : 800 });
      await page.waitForTimeout(150);
      await assertSingleDecision(page, `${label}, round ${String(round)} after resizing to ${String(width)}px`);
    }

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(150);
    const truncated = await clippedText(page, '.suggestion-list .suggestion-select');
    assert(truncated.length === 0, `Assistant @ 1920x1080: card names are truncated: ${truncated.join(', ')}`);
    await assertSingleDecision(page, 'Assistant @ 1920x1080');
    assertNoConsoleErrors(errors, label);
  } finally {
    await page.close();
  }
}

/** Box heights of the suggestion cards and the analysis, loaded or loading. */
export async function assistantGeometry(page: Page): Promise<{ readonly cards: readonly number[]; readonly analysis: number }> {
  return page.evaluate(() => ({
    cards: [...document.querySelectorAll('.suggestion-list > li')].map((card) => Math.round(card.getBoundingClientRect().height * 10) / 10),
    analysis: Math.round(document.querySelector('.rec-analysis')?.getBoundingClientRect().height ?? 0),
  }));
}

/** At every desktop size the loading Assistant's cards are exactly as tall as the loaded ones, so nothing moves (F3). */
export async function checkAssistantSkeletonParity(browser: Browser, viewport: { readonly width: number; readonly height: number }): Promise<void> {
  for (const theme of THEMES) await checkSkeletonParityInTheme(browser, viewport, theme);
}

async function checkSkeletonParityInTheme(browser: Browser, viewport: { readonly width: number; readonly height: number }, theme: (typeof THEMES)[number]): Promise<void> {
  const label = `Assistant skeleton @ ${String(viewport.width)}x${String(viewport.height)} ${theme}`;
  const measure = async (url: string) => {
    const page = await gatePage(browser, { viewport, colorScheme: theme });
    try {
      const errors = watchErrors(page);
      await page.goto(`${ORIGIN}${url}`);
      await page.waitForSelector('html[data-visual-ready]', { timeout: 20_000 });
      await page.locator('.suggestion-list > li').nth(SUGGESTION_CARDS - 1).waitFor({ timeout: 20_000 });
      assertNoConsoleErrors(errors, `${label} (${url})`);
      return { ...await assistantGeometry(page), intended: (await intendedAnalysisHeights(page)).analysis };
    } finally {
      await page.close();
    }
  };
  const skeleton = await measure('/__visual/loading?state=assistant');
  const loaded = await measure('/__visual/assistant?state=why');
  // Equal is not enough: both must be the intended sizes, so a loading and loaded state that grew together still fail.
  const wrongCards = loaded.cards.filter((height, index) => Math.abs(height - (index === 0 ? LEAD_CARD_HEIGHT : CARD_HEIGHT)) > 0.5);
  assert(wrongCards.length === 0, `${label}: loaded cards are ${loaded.cards.join('/')}px; the leader must be ${String(LEAD_CARD_HEIGHT)}px and the rest ${String(CARD_HEIGHT)}px`);
  assert(Math.abs(loaded.analysis - loaded.intended) <= 1, `${label}: the loaded analysis is ${String(loaded.analysis)}px; this window intends ${String(loaded.intended)}px`);
  assert(skeleton.cards.length === SUGGESTION_CARDS && loaded.cards.length === SUGGESTION_CARDS, `${label}: ${String(skeleton.cards.length)} loading and ${String(loaded.cards.length)} loaded cards`);
  const mismatched = skeleton.cards.flatMap((height, index) => {
    const actual = loaded.cards[index] ?? 0;
    return Math.abs(height - actual) > 1 ? [`card ${String(index + 1)} ${String(height)}px loading vs ${String(actual)}px loaded`] : [];
  });
  assert(mismatched.length === 0, `${label}: ${mismatched.join(', ')}`);
  assert(Math.abs(skeleton.analysis - loaded.analysis) <= 1, `${label}: analysis is ${String(skeleton.analysis)}px loading vs ${String(loaded.analysis)}px loaded`);
  console.log(`  ${label}: cards ${loaded.cards.join('/')}px, analysis ${String(loaded.analysis)}px`);
}

/** Data JSON the app fetches at startup; the cold-load check holds these until it has measured the skeleton. */
export const isDataUrl = ({ pathname }: URL): boolean => pathname.includes('/data/') && pathname.endsWith('.json');

/**
 * A real cold open of the Assistant with every data request held: the page shows its loading skeleton, never the
 * data-failure notice, and the cards and analysis keep their heights when the data arrives (F3).
 */
export async function checkAssistantColdLoad(browser: Browser, viewport: { readonly width: number; readonly height: number }): Promise<void> {
  const label = `Assistant cold load @ ${String(viewport.width)}x${String(viewport.height)}`;
  const page = await gatePage(browser, { viewport });
  try {
    const errors = watchErrors(page);
    await page.goto(`${ORIGIN}/draft`);
    await activateStorage(page);
    // A buffered layout-shift observer from the very start of the Assistant navigation, kept through the data
    // release (R8-4: header controls and the font swap moved the header before the skeleton settled).
    await page.addInitScript(() => {
      const shifts: { value: number; sources: string[] }[] = [];
      Object.assign(window, { __layoutShifts: shifts });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: { node?: Node | null }[] })[]) {
          if (entry.hadRecentInput) continue;
          shifts.push({ value: entry.value, sources: (entry.sources ?? []).map((source) => source.node instanceof Element ? `${source.node.tagName.toLowerCase()}.${source.node.getAttribute('class')?.slice(0, 40) ?? ''}` : '?') });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    const held: (() => void)[] = [];
    let released = false;
    await page.route(isDataUrl, async (route) => {
      if (released || !['fetch', 'xhr'].includes(route.request().resourceType())) return route.continue();
      await new Promise<void>((resolve) => { held.push(resolve); });
      return route.continue();
    });
    await page.goto(`${ORIGIN}/assistant`);
    await page.locator('.rec-workspace[aria-busy="true"] .suggestion-list > li').nth(SUGGESTION_CARDS - 1).waitFor({ timeout: 20_000 });
    // Give a premature failure notice time to replace the skeleton before measuring.
    await page.waitForTimeout(500);
    assert(held.length > 0, `${label}: no data request was held`);
    assert(await page.locator('.rec-workspace[aria-busy="true"]').count() === 1, `${label}: the skeleton left while data was pending`);
    assert(await page.getByText('did not load').count() === 0 && await page.locator('.draft-setup-item').count() === 0, `${label}: pending data shows a failure notice`);
    const skeleton = await assistantGeometry(page);
    released = true;
    for (const resolve of held.splice(0)) resolve();
    await page.locator('.rec-workspace:not([aria-busy]) .suggestion-list > li').nth(SUGGESTION_CARDS - 1).waitFor({ timeout: 20_000 });
    const loaded = await assistantGeometry(page);
    assert(skeleton.cards.length === SUGGESTION_CARDS && loaded.cards.length === SUGGESTION_CARDS, `${label}: ${String(skeleton.cards.length)} loading and ${String(loaded.cards.length)} loaded cards`);
    const mismatched = skeleton.cards.flatMap((height, index) => {
      const actual = loaded.cards[index] ?? 0;
      return Math.abs(height - actual) > 1 ? [`card ${String(index + 1)} ${String(height)}px loading vs ${String(actual)}px loaded`] : [];
    });
    assert(mismatched.length === 0, `${label}: ${mismatched.join(', ')}`);
    assert(Math.abs(skeleton.analysis - loaded.analysis) <= 1, `${label}: analysis is ${String(skeleton.analysis)}px loading vs ${String(loaded.analysis)}px loaded`);
    await page.waitForTimeout(500);
    const shifts = await page.evaluate(() => (window as unknown as { __layoutShifts?: { value: number; sources: string[] }[] }).__layoutShifts ?? null);
    assert(shifts !== null, `${label}: the layout-shift observer did not run`);
    const cls = shifts.reduce((sum, shift) => sum + shift.value, 0);
    assert(cls < MAX_COLD_LOAD_CLS, `${label}: cold-load CLS is ${cls.toFixed(5)} (limit ${String(MAX_COLD_LOAD_CLS)}): ${shifts.map((shift) => `${shift.value.toFixed(5)} ${shift.sources.join(' + ')}`).join('; ')}`);
    assertNoConsoleErrors(errors, label);
    console.log(`  ${label}: cards ${loaded.cards.join('/')}px, analysis ${String(loaded.analysis)}px, CLS ${cls.toFixed(5)}`);
  } finally {
    await page.close();
  }
}

/** A 12-team mock at slot 12, paused on its own pick 1.12, opened in the Assistant. */
export async function openSlotTwelveAssistant(page: Page): Promise<void> {
  await page.goto(`${ORIGIN}/draft`);
  await activateStorage(page);
  await page.getByRole('button', { name: 'Start mock', exact: true }).click();
  await page.getByLabel('Your draft slot').fill('12');
  await page.getByRole('button', { name: 'Start mock draft' }).click();
  await page.locator('.draft-turn-banner[data-state="on-clock"]').first().waitFor({ timeout: MOCK_TIMEOUT_MS });
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Assistant', exact: true }).first().click();
  await page.locator('.rec-workspace:not([aria-busy]) .suggestion-list .suggestion-row').nth(SUGGESTION_CARDS - 1).waitFor({ timeout: 20_000 });
}

/**
 * "Who do I take, and can I wait?" at a glance on a laptop (item A9): for the slot-12 leader, at least
 * MIN_ANSWER_HEIGHT of the tab answer is on screen before any scrolling, the analysis keeps its intended height and
 * the "Next turn" strip shows the same pick count as the context bar.
 */
/**
 * Analysis fact values ("69.3 pts", a risk label) that are cut off or squeezed: ellipsized inside their own box, past
 * their fact row, or over their label. Measured on the text itself, with no whole-pixel tolerance, because a 1.4px
 * shortfall already turned "69.3 pts" into "69.3 p…" (R10-1).
 */
export async function cutFactValues(page: Page): Promise<readonly string[]> {
  return page.locator('.rec-side .rec-decision-facts > div').evaluateAll((rows) => rows.flatMap((row) => {
    const value = row.querySelector('dd');
    const label = row.querySelector('dt');
    if (!value || !label || value.getBoundingClientRect().width === 0) return [];
    // Only text a sighted user sees: screen-reader-only spans sit outside the layout and would skew the box.
    const walker = document.createTreeWalker(value, NodeFilter.SHOW_TEXT);
    const rects: DOMRect[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest('.sr-only') || !node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      rects.push(...range.getClientRects());
    }
    if (rects.length === 0) return [];
    const text = { left: Math.min(...rects.map((rect) => rect.left)), right: Math.max(...rects.map((rect) => rect.right)), top: Math.min(...rects.map((rect) => rect.top)) };
    const textWidth = text.right - text.left;
    const box = value.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const style = getComputedStyle(value);
    const name = `${(label.textContent ?? '').trim()}: "${(value.textContent ?? '').trim()}"`;
    const problems: string[] = [];
    if (style.overflowX !== 'visible' && textWidth > box.width + 0.25) problems.push(`clipped (${textWidth.toFixed(1)}px of text in ${box.width.toFixed(1)}px)`);
    // A wrapping value (the fallback, a long risk) may take several lines; only its right edge must stay in the row.
    if (text.right > rowBox.right + 0.25) problems.push(`runs ${(text.right - rowBox.right).toFixed(1)}px past its row`);
    if (text.top < label.getBoundingClientRect().bottom - 1 && text.left < label.getBoundingClientRect().right - 0.25 && !row.classList.contains('rec-decision-fallback')) problems.push('overlaps its label');
    return problems.length > 0 ? [`${name} ${problems.join(', ')}`] : [];
  }));
}

/** Best available rows wholly inside the window below the sticky header, before any scrolling. */
export async function poolRowsAboveFold(page: Page): Promise<number> {
  return page.evaluate(() => {
    const header = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
    return [...document.querySelectorAll('.rec-pool-list [data-player-row]')].filter((row) => {
      const box = row.getBoundingClientRect();
      return box.height > 0 && box.top >= header - 0.5 && box.bottom <= window.innerHeight + 0.5;
    }).length;
  });
}

export async function checkAssistantAnswerRoom(browser: Browser, viewport: { readonly width: number; readonly height: number }): Promise<void> {
  const label = `Assistant answer room @ ${String(viewport.width)}x${String(viewport.height)}`;
  const page = await gatePage(browser, { viewport });
  try {
    const errors = watchErrors(page);
    await openSlotTwelveAssistant(page);
    const { analysis: intended } = await intendedAnalysisHeights(page);
    const wide = viewport.width >= ASSISTANT_RAIL_BREAKPOINT;
    // Measured in the second theme as well, so a theme-only size change (a font weight, a border) cannot hide.
    const roomIn = (): Promise<{ visible: number; analysis: number; strip: string; stripShown: boolean; context: string }> => page.evaluate(() => {
      const answer = document.querySelector('.rec-side .rec-answer')?.getBoundingClientRect();
      const analysis = document.querySelector('.rec-side > .rec-analysis')?.getBoundingClientRect();
      const strip = document.querySelector('[data-rail-summary]');
      const stripBox = strip?.getBoundingClientRect();
      return {
        visible: answer ? Math.round(Math.min(answer.bottom, window.innerHeight) - answer.top) : 0,
        analysis: Math.round(analysis?.height ?? 0),
        strip: strip?.textContent ?? '',
        stripShown: stripBox !== undefined && stripBox.height > 0 && stripBox.top >= 0 && stripBox.bottom <= window.innerHeight,
        context: document.querySelector('.rec-context-pick [data-next-turn]')?.textContent ?? '',
      };
    });
    let room = await roomIn();
    await forEachTheme(page, async (theme) => {
      const themed = await roomIn();
      assert(themed.visible >= MIN_ANSWER_HEIGHT, `${label} ${theme}: only ${String(themed.visible)}px of the answer is visible before scrolling; it needs ${String(MIN_ANSWER_HEIGHT)}px`);
      assert(Math.abs(themed.analysis - intended) <= 1, `${label} ${theme}: the analysis is ${String(themed.analysis)}px; this window intends ${String(intended)}px`);
      if (theme === 'light') room = themed;
    });
    assert(room.visible >= MIN_ANSWER_HEIGHT, `${label}: only ${String(room.visible)}px of the answer is visible before scrolling; it needs ${String(MIN_ANSWER_HEIGHT)}px`);
    assert(Math.abs(room.analysis - intended) <= 1, `${label}: the analysis is ${String(room.analysis)}px; this window intends ${String(intended)}px`);
    // The next turn is said once, in the bar at the top of the page; the strip never repeats it.
    assert(/in \d+ pick/.test(room.context), `${label}: the bar does not say when the next turn is ("${room.context}")`);
    if (!wide) {
      assert(room.stripShown, `${label}: the queue and roster strip is not on screen`);
      assert(!room.strip.includes('Next turn'), `${label}: the strip repeats the next turn the bar already states ("${room.strip}")`);
      // At 1.12 the next turn is 2.01 with nobody picking in between, so the strip has no "Before your pick" line.
      assert(!room.strip.includes('Before you'), `${label}: the strip lists teams before a back-to-back pick ("${room.strip}")`);
    }
    const rows = await poolRowsAboveFold(page);
    // Best available rows stay one line (name, then its tags), between the 40px row floor and 44px, so a long name or
    // tag never doubles a row (item 11), and the large windows show whole rows before any scrolling (round 12, A4).
    const offRows = await page.locator('.rec-pool-list [data-player-row] .rec-candidate').evaluateAll((items, [min, max]) => items
      .map((item) => {
        const name = item.querySelector('.rec-candidate-name');
        const lines = name ? Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight || '20')) : 1;
        return { name: name?.textContent ?? '', height: item.getBoundingClientRect().height, lines };
      })
      .filter((item) => item.height < (min ?? 40) - 0.5 || item.height > (max ?? 44) + 0.5 || item.lines > 1).map((item) => `${item.name} ${item.height.toFixed(1)}px, ${String(item.lines)} line(s)`), [ROW_MIN_HEIGHT, ROW_MAX_HEIGHT]);
    assert(offRows.length === 0, `${label}: best available rows must be one line, ${String(ROW_MIN_HEIGHT)}-${String(ROW_MAX_HEIGHT)}px: ${offRows.slice(0, 4).join(', ')}`);
    const minRows = MIN_POOL_ROWS_ABOVE_FOLD[viewport.height] ?? 0;
    assert(rows >= minRows, `${label}: ${String(rows)} whole best-available row(s) above the fold; this window needs ${String(minRows)}`);
    // Every card's take-or-wait facts keep their full value, whichever card is the subject.
    const cut: string[] = [];
    const cards = page.locator('.suggestion-list [data-suggestion-select]');
    for (let index = 0; index < await cards.count(); index += 1) {
      await cards.nth(index).click();
      await page.waitForFunction((position) => document.querySelectorAll('.suggestion-list .suggestion-row')[position]?.hasAttribute('data-selected') === true, index);
      cut.push(...(await cutFactValues(page)).map((problem) => `card ${String(index + 1)} ${problem}`));
    }
    assert(cut.length === 0, `${label}: analysis fact values are cut off: ${cut.join('; ')}`);
    assertNoConsoleErrors(errors, label);
    console.log(`  ${label}: ${String(room.visible)}px of the answer visible, analysis ${String(room.analysis)}px, ${room.context}, ${String(rows)} best-available row(s) above the fold`);
  } finally {
    await page.close();
  }
}

/**
 * A card scrolled partly under the sticky header, with its own Draft/Retry hidden there, hands a failed save to the
 * workspace notice, whose Retry is on screen and saves the same player (R9-2). The card still intersects the
 * viewport, so a reporter that counted any intersection kept the failure on a Retry nobody could see.
 */
export async function checkPartlyHiddenCardRetry(browser: Browser, viewport: { readonly width: number; readonly height: number }): Promise<void> {
  const label = `Partly hidden card Retry @ ${String(viewport.width)}x${String(viewport.height)}`;
  const context = await gateContext(browser, { viewport });
  try {
    const page = await context.newPage();
    const errors = watchErrors(page);
    await openSlotTwelveAssistant(page);
    const first = page.locator('.suggestion-list .suggestion-row').first();
    const name = (await first.locator('h3').innerText()).trim();
    const before = await page.locator('.draft-session-pick').first().textContent();
    // Leave 13px of the card below the header: its actions, centered in the card, sit wholly under the header.
    await page.evaluate(() => {
      const header = document.querySelector('.draft-app-header')?.getBoundingClientRect().bottom ?? 0;
      const card = document.querySelector('.suggestion-list .suggestion-row')?.getBoundingClientRect();
      if (card) window.scrollBy(0, card.bottom - (header + 13));
    });
    await page.waitForTimeout(300);
    const placement = await page.evaluate(() => {
      const header = document.querySelector('.draft-app-header')?.getBoundingClientRect().bottom ?? 0;
      const card = document.querySelector('.suggestion-list .suggestion-row')?.getBoundingClientRect();
      const action = document.querySelector('.suggestion-list .suggestion-row [data-suggestion-action] button')?.getBoundingClientRect();
      return { header, cardBottom: card?.bottom ?? 0, actionBottom: action?.bottom ?? 0 };
    });
    assert(placement.cardBottom > placement.header && placement.actionBottom <= placement.header + 1, `${label}: could not place the card partly under the header (${JSON.stringify(placement)})`);
    // The dev server's fault hook (web-app/src/workspace/dev-fault-injection.ts) fails exactly the next Draft save.
    await page.evaluate(() => { Object.assign(window, { __draftFailNextPickSave: true }); });
    // A pointer cannot reach a control under the header; the click stands in for a key press or an earlier click.
    await page.evaluate(() => { document.querySelector<HTMLButtonElement>('.suggestion-list .suggestion-row [data-suggestion-action] button')?.click(); });
    const notice = page.locator('aside[aria-label="Pick not saved"]');
    await notice.waitFor({ timeout: 10_000 }).catch(() => { throw new GateFailure(`${label}: the failed save for ${name} shows no workspace notice while the card's own Retry is hidden`); });
    const retry = notice.getByRole('button', { name: 'Retry' });
    const shown = await retry.evaluate((button) => {
      const box = button.getBoundingClientRect();
      const header = document.querySelector('.draft-app-header')?.getBoundingClientRect().bottom ?? 0;
      return box.height > 0 && box.top >= header - 1 && box.bottom <= window.innerHeight + 1;
    });
    assert(shown, `${label}: the workspace notice's Retry is not fully on screen`);
    await retry.click();
    await page.waitForFunction((previous) => document.querySelector('.draft-session-pick')?.textContent !== previous, before, { timeout: 10_000 })
      .catch(() => { throw new GateFailure(`${label}: the workspace Retry did not save ${name}`); });
    assertNoConsoleErrors(errors, label);
    console.log(`  ${label}: card bottom ${String(Math.round(placement.cardBottom))}px under a ${String(Math.round(placement.header))}px header; workspace Retry saved ${name}`);
  } finally {
    await context.close();
  }
}

/**
 * R9-1, deterministically: the Sleeper directory answers a second after FantasyPros and the identity map. The page
 * holds its skeleton until every merge input has settled and never warns about unmatched players.
 */
export async function checkAssistantColdLoadSleeperLate(browser: Browser): Promise<void> {
  const label = 'Assistant cold load with Sleeper late @ 1280x800';
  const page = await gatePage(browser, { viewport: { width: 1280, height: 800 } });
  try {
    const errors = watchErrors(page);
    await page.goto(`${ORIGIN}/draft`);
    await activateStorage(page);
    await page.route((url) => url.pathname.endsWith('/data/sleeper-adp.json'), async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await route.continue();
    });
    await page.goto(`${ORIGIN}/assistant`);
    await page.locator('.rec-workspace:not([aria-busy]) .suggestion-list > li').nth(SUGGESTION_CARDS - 1).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(500);
    assertNoConsoleErrors(errors, label);
    await assertCardsKeepHeight(page, label);
  } finally {
    await page.close();
  }
}
