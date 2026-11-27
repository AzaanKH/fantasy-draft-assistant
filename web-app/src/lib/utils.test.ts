import { expect, it } from 'vitest';
import { cn } from './utils';

// tailwind-merge 2 predates Tailwind 4 syntax and merged these incorrectly.
it('lets a later utility override a Tailwind 4 CSS-variable shorthand', () => {
  expect(cn('h-(--container-sidepanel-nav)', 'h-12')).toBe('h-12');
  expect(cn('px-2', 'px-(--gap)')).toBe('px-(--gap)');
});

it('treats outline-hidden and outline-none as the same outline-style group', () => {
  expect(cn('outline-hidden', 'outline-none')).toBe('outline-none');
});

it('keeps a Tailwind 4 gradient direction when a background colour follows', () => {
  expect(cn('bg-linear-to-r', 'bg-red-500')).toBe('bg-linear-to-r bg-red-500');
});
