import { afterEach, beforeEach } from 'vitest';
import { installHeldKeyGuard } from './features/draft-room/held-key-guard';

// Every DOM test runs under the held-key guard, exactly as main.tsx (the app's only entry) installs it before render:
// component key handlers never see a repeated action key, so they do not re-check event.repeat.
if (typeof window !== 'undefined') installHeldKeyGuard(window);

// jsdom has no top layer: no fullscreen element, modal dialog or open popover. floating-ui (Radix tooltips, menus,
// popovers) asks each ancestor of a positioned element whether it matches `:popover-open` or `:modal`, and nwsapi
// answers by walking the whole document for each call: seconds of CPU per open tooltip, spent after the test that
// opened it and counted against the next one. Answer those selectors the way jsdom must, without the walk.
const TOP_LAYER_SELECTORS = new Set([':popover-open', ':modal', ':fullscreen']);
if (typeof Element !== 'undefined') {
  const matches = Object.getOwnPropertyDescriptor(Element.prototype, 'matches')?.value as (this: Element, selector: string) => boolean;
  Element.prototype.matches = function matchesOutsideTopLayer(this: Element, selector: string): boolean {
    return TOP_LAYER_SELECTORS.has(selector) ? false : matches.call(this, selector);
  };
}

// React reports render crashes and jsdom reports uncaught errors through console.error; a test that passes over
// one is hiding a broken tree. React's dev-only "Warning:" messages (act, SSR layout effects) are not crashes and
// are left out. Tests that expect an error stub console.error themselves (vi.spyOn), bypassing this recorder.
const original = console.error;
let reported: string[] = [];

beforeEach(() => {
  reported = [];
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('Warning:')) { original(...args); return; }
    reported.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ').slice(0, 300));
    original(...args);
  };
});

afterEach(() => {
  console.error = original;
  if (reported.length > 0) throw new Error(`Unexpected console.error during the test:\n${reported.join('\n')}`);
});
