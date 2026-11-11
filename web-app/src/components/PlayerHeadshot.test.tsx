import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { getHeadshotLabel, PlayerHeadshot } from './PlayerHeadshot';

it('labels a missing headshot with initials, and a defense with its team', () => {
  expect(getHeadshotLabel('CeeDee Lamb', 'WR')).toBe('CL');
  expect(getHeadshotLabel('HOU Defense', 'DEF', 'HOU')).toBe('HOU');
  expect(getHeadshotLabel('Houston Texans', 'DEF')).toBe('HOU');
});

it('keeps the initials under a photo that has not loaded, so a slow or blocked image never leaves a blank circle', () => {
  const html = renderToStaticMarkup(createElement(PlayerHeadshot, { playerId: '4046', name: 'Patrick Mahomes', position: 'QB' }));
  expect(html).toContain('data-headshot-label="">PM</span>');
  // The photo starts hidden and only covers the label once it has loaded.
  expect(html).toMatch(/<img[^>]*class="[^"]*opacity-0/);
});
