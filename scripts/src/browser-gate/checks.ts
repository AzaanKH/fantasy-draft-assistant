/**
 * Browser gate: every check, in run order, with the label BROWSER_GATE_ONLY matches against.
 */
import { type Browser } from 'playwright';
import { checkAssistantGlance } from './glance.js';
import { checkAssistantAxe, checkDialogFocusReturn, checkDraftAxe, checkSidePanelShellAxe } from './accessibility.js';
import { checkHungPickSave, checkHungQueueSave } from './recovery.js';
import {
  checkAssistantAnswerRoom, checkAssistantColdLoad, checkAssistantColdLoadSleeperLate, checkAssistantHiddenCardKeys,
  checkAssistantSkeletonParity, checkAssistantSuggestions, checkPartlyHiddenCardRetry,
} from './assistant.js';
import { checkAppearanceThenFullBoard, checkBoardFollowsLiveOnResize, checkBoardHeightFollowsResize, checkDockRosterHotkeys, checkLaterRoundBoard } from './board.js';
import { LAPTOP_VIEWPORTS, LATER_ROUND_VIEWPORTS, POOL_WIDTHS, SIDE_PANEL_WIDTHS, THEMES } from './config.js';
import { checkChipContrast, checkFocusRingContrast } from './contrast.js';
import { checkChecklistPool, checkDraftFlow, checkLaptopDraftRoom, checkPhoneWorkspace, checkPoolColumns, checkRouteFailure } from './draft-room.js';
import { checkReducedMotion } from './motion.js';
import { checkFinalPickLabels, checkSidePanelBanner } from './side-panel.js';
import { checkTierSheet } from './tiers.js';
import { VISUAL_CHECKS, checkVisualRoute } from './visual.js';

export interface GateCheck {
  readonly label: string;
  readonly run: (browser: Browser) => Promise<void>;
}

export function gateChecks(): readonly GateCheck[] {
  const checks: GateCheck[] = [];
  const add = (label: string, run: (browser: Browser) => Promise<void>): void => { checks.push({ label, run }); };
  for (const check of VISUAL_CHECKS) {
    for (const width of check.widths) add(`${check.url} @ ${String(width)}px`, (browser) => checkVisualRoute(browser, check, width));
  }
  add('draft workspace @ 390px', checkPhoneWorkspace);
  for (const width of POOL_WIDTHS) add(`pool columns @ ${String(width)}px`, (browser) => checkPoolColumns(browser, width));
  for (const viewport of LAPTOP_VIEWPORTS) {
    const size = `${String(viewport.width)}x${String(viewport.height)}`;
    add(`draft room layout @ ${size}`, (browser) => checkLaptopDraftRoom(browser, viewport));
    add(`position tiers layout @ ${size}`, (browser) => checkTierSheet(browser, viewport));
  }
  for (const viewport of LATER_ROUND_VIEWPORTS) {
    add(`later-round board @ ${String(viewport.width)}x${String(viewport.height)}`, (browser) => checkLaterRoundBoard(browser, viewport));
  }
  add('board default height follows resize', checkBoardHeightFollowsResize);
  add('board keeps team 14 live pick in view through a resize', checkBoardFollowsLiveOnResize);
  add('keys 1-4 with the dock on Roster', checkDockRosterHotkeys);
  add('assistant keys 1-4 never act on hidden cards', checkAssistantHiddenCardKeys);
  add('appearance choice then Full board @ 1280x800', checkAppearanceThenFullBoard);
  add('final-pick labels in the side panel and cards', checkFinalPickLabels);
  add('reduced motion switches off pulse, pick-landed, crossfade and chevron', checkReducedMotion);
  add('assistant suggestions and single analysis @ 1280x800', checkAssistantSuggestions);
  add('assistant cold load with Sleeper late never warns @ 1280x800', checkAssistantColdLoadSleeperLate);
  for (const viewport of LAPTOP_VIEWPORTS) {
    const size = `${String(viewport.width)}x${String(viewport.height)}`;
    add(`assistant skeleton matches loaded @ ${size}`, (browser) => checkAssistantSkeletonParity(browser, viewport));
    add(`assistant cold load shows skeleton @ ${size}`, (browser) => checkAssistantColdLoad(browser, viewport));
    add(`assistant answer room and best-available density @ ${size}`, (browser) => checkAssistantAnswerRoom(browser, viewport));
    for (const theme of THEMES) add(`assistant at a glance @ ${size} ${theme}`, (browser) => checkAssistantGlance(browser, viewport, theme));
    if (viewport.width < 1920) add(`partly hidden card hands its failure to the workspace Retry @ ${size}`, (browser) => checkPartlyHiddenCardRetry(browser, viewport));
    if (viewport.width < 1920) add(`pool footer with checklist @ ${size}`, (browser) => checkChecklistPool(browser, viewport));
  }
  add(`side panel turn banner @ ${SIDE_PANEL_WIDTHS.join('/')}px`, checkSidePanelBanner);
  add('light-theme chip contrast', (browser) => checkChipContrast(browser, 'light'));
  add('dark-theme chip contrast', (browser) => checkChipContrast(browser, 'dark'));
  for (const theme of THEMES) add(`${theme}-theme focus ring contrast`, (browser) => checkFocusRingContrast(browser, theme));
  for (const theme of THEMES) {
    add(`axe /assistant Suggestions and Tiers @ 1280x800 ${theme}`, (browser) => checkAssistantAxe(browser, theme, { width: 1280, height: 800 }));
    // The wide layout adds the pinned rail, its own scroll region.
    add(`axe /assistant Suggestions and Tiers @ 1920x1080 ${theme}`, (browser) => checkAssistantAxe(browser, theme, { width: 1920, height: 1080 }));
    add(`axe /draft ${theme}`, (browser) => checkDraftAxe(browser, theme));
    add(`axe built side panel ${theme}`, (browser) => checkSidePanelShellAxe(browser, theme));
  }
  add('controlled dialog returns focus to its opener', checkDialogFocusReturn);
  add('hung Draft save turns into Retry after 15s', checkHungPickSave);
  add('hung queue save turns into Retry after 15s', checkHungQueueSave);
  add('draft flow', checkDraftFlow);
  add('route failure fallback', checkRouteFailure);
  return checks;
}
