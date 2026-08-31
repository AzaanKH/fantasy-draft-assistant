import { describe, expect, it } from 'vitest';
import { getAppHref, getAppPath, getAppRoute } from './app-route';

describe('app route', () => {
  it('resolves the dedicated assistant route', () => {
    expect(getAppRoute('/assistant')).toBe('assistant');
    expect(getAppRoute('/assistant/decision')).toBe('assistant');
  });

  it('resolves the extension side-panel route', () => {
    expect(getAppRoute('/sidepanel')).toBe('sidepanel');
    expect(getAppRoute('/sidepanel/live')).toBe('sidepanel');
    expect(getAppPath('sidepanel')).toBe('/sidepanel');
  });

  it('keeps draft as the default surface', () => {
    expect(getAppRoute('/')).toBe('draft');
    expect(getAppRoute('/draft')).toBe('draft');
    expect(getAppPath('draft')).toBe('/draft');
    expect(getAppPath('assistant')).toBe('/assistant');
  });

  it('preserves live-sync parameters across Draft and Assistant navigation', () => {
    const search = '?provider=sleeper&draftId=draft-1&position=5';

    expect(getAppHref('assistant', search)).toBe(`/assistant${search}`);
    expect(getAppHref('draft', search)).toBe(`/draft${search}`);
  });
});
