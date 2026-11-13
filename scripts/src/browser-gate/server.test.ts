import { describe, expect, it } from 'vitest';
import { isInfrastructureFailure } from './server.js';

describe('browser gate failure classes', () => {
  it('treats a server that went away, a launch failure or a check not run as infrastructure', () => {
    for (const message of [
      'page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3100/draft',
      'not run: Vite is down and could not be restarted',
      'browserType.launch: Timeout 180000ms exceeded.',
      'Target page, context or browser has been closed',
    ]) expect(isInfrastructureFailure(message)).toBe(true);
  });

  it('keeps assertion failures and failed resources as real failures', () => {
    for (const message of [
      'Assistant @ 1280x800: cards must stay 88px and whole',
      'Draft room: console reported Failed to load resource: the server responded with a status of 404 (http://localhost:3100/data/x.json)',
    ]) expect(isInfrastructureFailure(message)).toBe(false);
  });
});
