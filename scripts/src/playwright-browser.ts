import { Effect } from 'effect';
import { chromium, type Page } from 'playwright';
import { io } from './effect-runtime.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** A headless Chromium page whose browser closes on success, failure, or Ctrl-C. */
export const withBrowserPage = <A, E>(use: (page: Page) => Effect.Effect<A, E>): Effect.Effect<A, E | Error> =>
  Effect.acquireUseRelease(
    io(() => chromium.launch({ headless: true })),
    (browser) => io(async () => (await browser.newContext({ userAgent: USER_AGENT })).newPage()).pipe(Effect.flatMap(use)),
    (browser) => Effect.promise(() => browser.close()),
  );
