import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LeadHeading, LensToggle } from './AssistantLayout';

describe('Decision Lens toggle', () => {
  it('offers Ranked Fit first, then Best Pick and Best Player, and marks the selected lens', () => {
    const markup = renderToStaticMarkup(createElement(LensToggle, { lens: 'ranked-fit', onChange: () => undefined }));
    const buttons = [...markup.matchAll(/aria-pressed="(true|false)"[^>]*>([^<]+)</g)].map(([, pressed, label]) => [label, pressed]);
    expect(buttons).toEqual([['Ranked Fit', 'true'], ['Best Pick', 'false'], ['Best Player', 'false']]);
  });

  it('names the lens in the suggestions heading', () => {
    expect(renderToStaticMarkup(createElement(LeadHeading, { lens: 'ranked-fit' }))).toContain('Your Ranked Fit');
    expect(renderToStaticMarkup(createElement(LeadHeading, { lens: 'best-pick' }))).toContain('Your Best Pick');
  });
});
