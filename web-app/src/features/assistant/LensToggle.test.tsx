import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LENS_BASIS, LensToggle } from './AssistantLayout';

describe('Decision Lens toggle', () => {
  it('offers Ranked Fit first, then Best Pick and Best Player, and marks the selected lens', () => {
    const markup = renderToStaticMarkup(createElement(LensToggle, { lens: 'ranked-fit', onChange: () => undefined }));
    const buttons = [...markup.matchAll(/aria-pressed="(true|false)"[^>]*>([^<]+)</g)].map(([, pressed, label]) => [label, pressed]);
    expect(buttons).toEqual([['Ranked Fit', 'true'], ['Best Pick', 'false'], ['Best Player', 'false']]);
  });

  it('explains each lens in its tooltip', () => {
    const markup = renderToStaticMarkup(createElement(LensToggle, { lens: 'best-pick', onChange: () => undefined }));
    const titles = [...markup.matchAll(/title="([^"]+)"/g)].map(([, title]) => title);
    expect(titles).toEqual([LENS_BASIS['ranked-fit'], LENS_BASIS['best-pick'], LENS_BASIS['best-player']]);
  });
});
