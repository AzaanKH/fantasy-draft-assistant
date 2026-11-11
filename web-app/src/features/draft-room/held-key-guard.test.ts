// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installHeldKeyGuard } from './held-key-guard';

let uninstall: () => void;
let button: HTMLButtonElement;
let input: HTMLInputElement;
const seen = vi.fn();

beforeEach(() => {
  uninstall = installHeldKeyGuard(window);
  button = document.createElement('button');
  input = document.createElement('input');
  document.body.append(button, input);
  document.addEventListener('keydown', seen);
});
afterEach(() => { uninstall(); document.removeEventListener('keydown', seen); button.remove(); input.remove(); seen.mockReset(); });

const press = (target: HTMLElement, key: string, repeat: boolean): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

it('lets the first press of Enter, Space, Q and 1-4 through and swallows every repeat of a held key', () => {
  for (const key of ['Enter', ' ', 'q', 'Q', '1', '2', '3', '4']) {
    expect(press(button, key, false).defaultPrevented).toBe(false);
    expect(press(button, key, true).defaultPrevented).toBe(true);
  }
  // Each key reached the page exactly once.
  expect(seen).toHaveBeenCalledTimes(8);
});

it('keeps typing repeats in a field, but never a repeated Enter', () => {
  expect(press(input, '4', true).defaultPrevented).toBe(false);
  expect(press(input, 'q', true).defaultPrevented).toBe(false);
  expect(press(input, 'Enter', true).defaultPrevented).toBe(true);
});

it('leaves navigation keys repeating', () => {
  for (const key of ['ArrowDown', 'PageDown', 'Escape']) expect(press(button, key, true).defaultPrevented).toBe(false);
});
