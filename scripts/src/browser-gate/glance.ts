/**
 * Browser gate: the Assistant answers "who do I take, and can I wait?" at a glance (round 12, item A1). On the first
 * Suggestions load, with no page scroll and no interaction, the decision hero states the call, its action, the lens
 * and the turn, whole. One scroll past the hero then brings the existing page (cards, analysis, strip) on screen
 * together, whole, with no analysis scroll, at each laptop and desktop size in both themes.
 */
import { type Browser } from 'playwright';
import { assertCardsKeepHeight, decisionFacts, scrollPastHero } from './assistant.js';
import { MAX_CARD_CHIPS, SUGGESTION_CARDS } from './config.js';
import { assert, assertHeaderStatus, assertNoConsoleErrors, forEachTheme, gatePage, openPausedMockAssistant, watchErrors } from './harness.js';

interface HeroFacts {
  readonly missing: readonly string[];
  readonly nextTurns: readonly string[];
  readonly scrolled: number;
}

interface GlanceFacts {
  readonly missing: readonly string[];
  /** Teams whose needs the laptop strip names (0 at 1600px and wider, where the rail lists them). */
  readonly teams: number;
}

export async function checkAssistantGlance(browser: Browser, viewport: { readonly width: number; readonly height: number }): Promise<void> {
  const page = await gatePage(browser, { viewport });
  try {
    const errors = watchErrors(page);
    await openPausedMockAssistant(page);
    await page.locator('.suggestion-list .suggestion-row').nth(SUGGESTION_CARDS - 1).waitFor({ timeout: 20_000 });
    // openPausedMockAssistant clicks through the header; put focus and scroll back where a first load leaves them.
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
    await page.waitForTimeout(300);
    await forEachTheme(page, async (theme) => {
      const label = `Assistant at a glance @ ${String(viewport.width)}x${String(viewport.height)} ${theme}`;
      const hero = await page.evaluate((): HeroFacts => {
        const missing: string[] = [];
        const header = document.querySelector('.draft-app-header')?.getBoundingClientRect().bottom ?? 0;
        /** Wholly inside the window below the sticky header, its own text uncut and not hidden by a clipping ancestor. */
        const shown = (element: Element | null | undefined): element is HTMLElement => {
          if (!(element instanceof HTMLElement)) return false;
          const box = element.getBoundingClientRect();
          if (box.width === 0 || box.height === 0 || box.top < header - 1 || box.bottom > window.innerHeight + 1 || box.right > window.innerWidth + 1) return false;
          if (element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX !== 'visible') return false;
          for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor);
            if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
            const edge = ancestor.getBoundingClientRect();
            if (box.top < edge.top - 1 || box.bottom > edge.bottom + 1 || box.left < edge.left - 1 || box.right > edge.right + 1) return false;
          }
          return true;
        };
        const need = (name: string, element: Element | null | undefined, pattern?: RegExp): void => {
          if (!shown(element)) { missing.push(`hero ${name} (not wholly on screen)`); return; }
          const text = (element.textContent ?? '').trim();
          if (pattern && !pattern.test(text)) missing.push(`hero ${name} ("${text.slice(0, 60)}")`);
        };
        const call = document.querySelector('.rec-workspace > section.call');
        // The paused mock is on the clock: the app's own on-clock banner, then the pick and the next turn.
        need('on-the-clock banner', call?.querySelector('.draft-turn-banner[data-state="on-clock"]'), /on the clock/i);
        need('next turn', call?.querySelector('[data-next-turn]'), /^Next turn in \d+ picks? \(\d+\.\d+\)$/);
        const lens = call?.querySelector('[role="group"][aria-label="Decision lens"]');
        need('lens toggle', lens);
        if (lens && lens.querySelectorAll('button[aria-pressed="true"]').length !== 1) missing.push('hero lens toggle has no single selected lens');
        need('call', call?.querySelector('h1'), /^Draft \S/);
        need('reason', call?.querySelector('.call-why'), /\w/);
        // Companion mode makes picks in the provider's room: its instruction stands in for the action.
        const companion = call?.querySelector('[data-provider-instruction]');
        if (companion) need('provider instruction', companion, /^Make the pick in /);
        else need('primary action', call?.querySelector('.call-actions .rec-action'), /^(Draft \S|Record pick)/);
        need('second action', call?.querySelector('.call-secondary'), /(picks \S|Compare options)/);
        need('gone-by figure', call?.querySelector('.call-stat'), /^\d{1,3}%gone by \d+\.\d+$/);
        const nextTurns = [...document.querySelectorAll('[data-next-turn]')].filter(shown).map((element) => (element.textContent ?? '').trim());
        return { missing, nextTurns, scrolled: window.scrollY };
      });
      assert(hero.scrolled === 0, `${label}: the page scrolled on load (${String(hero.scrolled)}px)`);
      assert(hero.missing.length === 0, `${label}: the decision hero is not whole on first load: ${hero.missing.join('; ')}`);
      await scrollPastHero(page);
      const facts = await page.evaluate((cardCount): GlanceFacts => {
        const missing: string[] = [];
        const header = document.querySelector('.draft-app-header')?.getBoundingClientRect().bottom ?? 0;
        /** Wholly inside the window below the sticky header, with its own text uncut, and not hidden by a clipping ancestor. */
        const shown = (element: Element | null | undefined): element is HTMLElement => {
          if (!(element instanceof HTMLElement)) return false;
          const box = element.getBoundingClientRect();
          if (box.width === 0 || box.height === 0 || box.top < header - 1 || box.bottom > window.innerHeight + 1 || box.right > window.innerWidth + 1) return false;
          if (element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX !== 'visible') return false;
          for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor);
            if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
            const edge = ancestor.getBoundingClientRect();
            if (box.top < edge.top - 1 || box.bottom > edge.bottom + 1 || box.left < edge.left - 1 || box.right > edge.right + 1) return false;
          }
          return true;
        };
        const need = (name: string, element: Element | null | undefined, pattern?: RegExp): void => {
          if (!shown(element)) { missing.push(`${name} (not wholly on screen)`); return; }
          const text = (element.textContent ?? '').trim();
          if (pattern && !pattern.test(text)) missing.push(`${name} ("${text.slice(0, 60)}")`);
        };
        const cards = [...document.querySelectorAll('.suggestion-list .suggestion-row')];
        const leader = cards[0];
        // The leader: name, position/team, verdict, "at <pick>" availability and the legal primary action.
        need('leader name', leader?.querySelector('h3'));
        need('leader position and team', leader?.querySelector('.suggestion-meta'), /^[A-Z]{1,3}\d* · [A-Z]{2,3}/);
        need('leader verdict chip', leader?.querySelector('.suggestion-verdict'), /Take now|Can wait|Likely available/);
        need('leader availability %', leader?.querySelector('[data-card-availability] strong'), /^\d{1,3}%$/);
        need('leader availability pick', leader?.querySelector('[data-card-availability] span'), /^available at \d+\.\d+$/);
        // Companion mode makes picks in the provider's room: its instruction stands in for the action.
        const companion = document.querySelector('.rec-side [data-provider-instruction]');
        if (companion) need('provider instruction', companion, /^Make the pick in /);
        else need('leader primary action', leader?.querySelector('[data-suggestion-action] button'), /^(Draft|Record pick)$/);
        // Cards 2-4: the %, and a verdict chip only when it differs from the leader's (a chip all four repeat says nothing).
        const leaderVerdict = (leader?.querySelector('.suggestion-verdict [aria-hidden="true"]')?.textContent ?? '').trim();
        cards.slice(1, cardCount).forEach((card, index) => {
          const verdict = card.querySelector('.suggestion-verdict');
          if (verdict) {
            need(`card ${String(index + 2)} verdict`, verdict, /Take now|Can wait|Likely available/);
            if ((verdict.querySelector('[aria-hidden="true"]')?.textContent ?? '').trim() === leaderVerdict) missing.push(`card ${String(index + 2)} repeats the leader's verdict ("${leaderVerdict}")`);
          }
          need(`card ${String(index + 2)} %`, card.querySelector('[data-card-availability] strong'), /^\d{1,3}%$/);
        });
        // The analysis: verdict and a one-line reason, the waiting cost with its unit, the fallback name and points, and fit.
        const analysis = document.querySelector('.rec-side > .rec-analysis');
        need('analysis verdict', analysis?.querySelector('.rec-decision-head .suggestion-verdict'));
        const reason = analysis?.querySelector('.rec-decision-reason');
        need('analysis reason', reason, /\w/);
        if (reason instanceof HTMLElement && reason.getBoundingClientRect().height > 20) missing.push(`analysis reason wraps past one line (${String(Math.round(reason.getBoundingClientRect().height))}px)`);
        need('waiting cost', analysis?.querySelector('[data-waiting-cost]'), /^\d+\.\d pts$/);
        need('fallback name', analysis?.querySelector('[data-fallback] strong'), /\w/);
        need('fallback points', analysis?.querySelector('[data-fallback] .rec-muted'), /^[+−-]?\d+ pts/);
        need('roster fit', analysis?.querySelector('[data-roster-fit]'), /\w/);
        // Below the rail breakpoint, who picks before you is in the strip, whole, with the roster-context note.
        const needs = document.querySelector('[data-upcoming-needs]');
        let teams = 0;
        if (window.innerWidth < 1600 && needs) {
          const compact = needs.querySelector('[aria-hidden="true"]');
          // The line itself is the clipping box: it must hold its whole text.
          need('opponent needs', needs, /^Before you: (T\d|all \d+ teams)/);
          need('roster-context note', document.querySelector('[data-upcoming-note]'), /not used in the % estimates/);
          // "T6–8 all open" names three teams; "T7 RB·WR · T8 QB" two.
          // The start of a draft says it in one sentence: "all 11 teams need every position".
          const everyone = /all (\d+) teams/.exec(compact?.textContent ?? '')?.[1];
          teams = everyone ? Number(everyone) : [...(compact?.textContent ?? '').matchAll(/T(\d+)(?:–(\d+))?/g)].reduce((sum, match) => sum + (match[2] ? Number(match[2]) - Number(match[1]) + 1 : 1), 0);
        }
        return { missing, teams };
      }, SUGGESTION_CARDS);
      if (viewport.width < 1600) assert(facts.teams >= 2, `${label}: the strip names the needs of ${String(facts.teams)} team(s); it must show at least 2`);
      assert(facts.missing.length === 0, `${label}: not all visible together without scrolling: ${facts.missing.join('; ')}`);
      // "Next turn in N picks (R.PP)": the same count everywhere it is shown.
      const counts = new Set(hero.nextTurns.map((text) => /^Next turn in (\d+) picks? \(\d+\.\d+\)$/.exec(text)?.[1] ?? `unparsed "${text}"`));
      assert(counts.size === 1 && ![...counts][0]?.startsWith('unparsed'), `${label}: the next-turn count differs between places: ${hero.nextTurns.join(' | ')}`);
      const answerScroll = await page.evaluate(() => document.querySelector('.rec-side .rec-answer')?.scrollTop ?? 0);
      assert(answerScroll === 0, `${label}: the analysis scrolled on load (${String(answerScroll)}px)`);
      await assertHeaderStatus(page, label);
      // Every card is whole at its own height (leader 104px, the rest 66px) with at most two chips, at every size (R12-27).
      await assertCardsKeepHeight(page, label);
      const crowded = (await decisionFacts(page)).cardChips.flatMap((count, index) => count > MAX_CARD_CHIPS ? [`card ${String(index + 1)} has ${String(count)}`] : []);
      assert(crowded.length === 0, `${label}: cards show more than ${String(MAX_CARD_CHIPS)} chips: ${crowded.join(', ')}`);
      assertNoConsoleErrors(errors, label);
      console.log(`  ${label}: hero whole on load, then all glance facts visible; ${hero.nextTurns[0] ?? ''} in ${String(hero.nextTurns.length)} place(s); ${String(facts.teams)} opponent team(s) named`);
      await page.evaluate(() => { window.scrollTo(0, 0); });
    });
  } finally {
    await page.close();
  }
}
