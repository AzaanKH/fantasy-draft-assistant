// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { getFocusReturnTarget } from './dialog';

let main: HTMLElement;
let list: HTMLElement;
let opener: HTMLButtonElement;

beforeEach(() => {
  main = document.createElement('main');
  list = document.createElement('ol');
  list.setAttribute('data-suggestion-list', '');
  opener = document.createElement('button');
  list.append(opener);
  main.append(list);
  document.body.append(main);
});
afterEach(() => { main.remove(); });

it('returns focus to the control that opened a dialog without a trigger', () => {
  expect(getFocusReturnTarget({ opener, fallback: list })).toBe(opener);
});

it('falls back to the opener\'s list when the opener is gone, disabled or hidden (the recorded player left the cards)', () => {
  opener.disabled = true;
  expect(getFocusReturnTarget({ opener, fallback: list })).toBe(list);
  opener.disabled = false;
  opener.hidden = true;
  expect(getFocusReturnTarget({ opener, fallback: list })).toBe(list);
  opener.remove();
  expect(getFocusReturnTarget({ opener, fallback: list })).toBe(list);
});

it('falls back to the main region when the list went too, and to nothing outside a page', () => {
  list.remove();
  expect(getFocusReturnTarget({ opener, fallback: list })).toBe(main);
  main.remove();
  expect(getFocusReturnTarget({ opener: null, fallback: null })).toBeNull();
});
