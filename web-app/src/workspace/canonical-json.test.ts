import { expect, it } from 'vitest';
import { canonicalJson } from './indexed-workspace';

it('sorts object keys recursively, including objects in arrays', () => {
  expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  expect(canonicalJson({ z: { b: 2, a: 1 }, picks: [{ name: 'A', slot: { round: 1, pick: 2 } }] }))
    .toBe(canonicalJson({ picks: [{ slot: { pick: 2, round: 1 }, name: 'A' }], z: { a: 1, b: 2 } }));
});

it('preserves pick and shortlist order and distinguishes nested values', () => {
  const state = { picks: [{ pick: 1, player: 'a' }, { pick: 2, player: 'b' }], shortlist: ['a', 'b'] };
  expect(canonicalJson(state)).not.toBe(canonicalJson({ ...state, picks: [...state.picks].reverse() }));
  expect(canonicalJson(state)).not.toBe(canonicalJson({ ...state, shortlist: [...state.shortlist].reverse() }));
  expect(canonicalJson(state)).not.toBe(canonicalJson({ ...state, picks: [{ pick: 1, player: 'c' }, state.picks[1]] }));
});

it('retains ordinary JSON null and omission behavior', () => {
  for (const value of [null, { a: undefined, b: null }, [undefined, null, { missing: undefined }]]) {
    expect(canonicalJson(value)).toBe(JSON.stringify(value));
  }
});

it('does not mutate input keys, objects or arrays', () => {
  const nested = Object.freeze({ z: 3, a: 1 });
  const rows = Object.freeze([nested, Object.freeze({ b: 2, a: 0 })]);
  const input = Object.freeze({ z: nested, a: rows });
  const before = JSON.stringify(input);
  canonicalJson(input);
  expect(JSON.stringify(input)).toBe(before);
  expect(Object.keys(input)).toEqual(['z', 'a']);
  expect(Object.keys(nested)).toEqual(['z', 'a']);
  expect(input.a).toBe(rows);
  expect(rows[0]).toBe(nested);
});
