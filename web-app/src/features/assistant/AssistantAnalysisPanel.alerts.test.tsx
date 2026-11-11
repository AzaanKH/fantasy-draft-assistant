import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AnalysisAlerts } from './AssistantAnalysisPanel';

const render = (alerts: readonly string[]): string =>
  renderToStaticMarkup(createElement(TooltipProvider, null, createElement(AnalysisAlerts, { alerts })));

describe('analysis header alerts', () => {
  it('shows the first alert and a focusable "+N more" that names every hidden alert', () => {
    const html = render(['Questionable', 'Bye 7 overlaps Receiver 2', 'Late-round target']);
    expect(html).toContain('>Questionable</span>');
    expect(html).toMatch(/<button[^>]*data-alert-more=""/);
    expect(html).toContain('+2 more');
    expect(html).toContain('2 more alerts: Bye 7 overlaps Receiver 2. Late-round target');
  });

  it('shows a single alert without a disclosure, and nothing without alerts', () => {
    expect(render(['Questionable'])).not.toContain('data-alert-more');
    expect(render([])).toBe('');
  });
});
