// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isEditableTarget, isSearchShortcut, moveActiveIndex, resolveEnterAction } from './pool-keyboard';

const key = (value: string, modifiers: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) =>
  ({ key: value, metaKey: false, ctrlKey: false, altKey: false, ...modifiers });

describe('isEditableTarget', () => {
  it.each([
    [() => document.createElement('input'), true],
    [() => Object.assign(document.createElement('input'), { type: 'search' }), true],
    [() => Object.assign(document.createElement('input'), { type: 'checkbox' }), false],
    [() => document.createElement('textarea'), true],
    [() => document.createElement('select'), true],
    [() => document.createElement('button'), false],
    [() => document.createElement('div'), false],
  ] as const)('classifies element %#', (make, expected) => {
    expect(isEditableTarget(make())).toBe(expected);
  });

  it('treats contenteditable as editable', () => {
    const element = document.createElement('div');
    element.contentEditable = 'true';
    // jsdom does not compute isContentEditable from the attribute.
    Object.defineProperty(element, 'isContentEditable', { value: true });
    expect(isEditableTarget(element)).toBe(true);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('isSearchShortcut', () => {
  it('accepts slash and Cmd/Ctrl+K only', () => {
    expect(isSearchShortcut(key('/'))).toBe(true);
    expect(isSearchShortcut(key('k', { metaKey: true }))).toBe(true);
    expect(isSearchShortcut(key('k', { ctrlKey: true }))).toBe(true);
    expect(isSearchShortcut(key('k'))).toBe(false);
    expect(isSearchShortcut(key('/', { ctrlKey: true }))).toBe(false);
    expect(isSearchShortcut(key('k', { metaKey: true, altKey: true }))).toBe(false);
  });
});

describe('moveActiveIndex', () => {
  it('starts at the first row and clamps at both ends', () => {
    expect(moveActiveIndex(null, 'ArrowDown', 5)).toBe(0);
    expect(moveActiveIndex(0, 'ArrowDown', 5)).toBe(1);
    expect(moveActiveIndex(4, 'ArrowDown', 5)).toBe(4);
    expect(moveActiveIndex(0, 'ArrowUp', 5)).toBe(0);
    expect(moveActiveIndex(2, 'Home', 5)).toBe(0);
    expect(moveActiveIndex(2, 'End', 5)).toBe(4);
    expect(moveActiveIndex(1, 'PageDown', 30)).toBe(11);
    expect(moveActiveIndex(3, 'PageUp', 30)).toBe(0);
  });

  it('ignores other keys and empty lists, and recovers from a stale index', () => {
    expect(moveActiveIndex(1, 'q', 5)).toBeNull();
    expect(moveActiveIndex(null, 'ArrowDown', 0)).toBeNull();
    expect(moveActiveIndex(9, 'ArrowUp', 3)).toBe(1);
  });
});

describe('resolveEnterAction', () => {
  it('drafts in mock on your turn, confirms via Provisional Pick in Manual Continuity, else queues', () => {
    expect(resolveEnterAction({ sessionMode: 'mock', canDraftPlayer: true, canRecordProvisional: false })).toBe('draft');
    expect(resolveEnterAction({ sessionMode: 'mock', canDraftPlayer: false, canRecordProvisional: false })).toBe('queue');
    expect(resolveEnterAction({ sessionMode: 'live', canDraftPlayer: true, canRecordProvisional: true })).toBe('record');
    expect(resolveEnterAction({ sessionMode: 'live', canDraftPlayer: true, canRecordProvisional: false })).toBe('queue');
    expect(resolveEnterAction({ sessionMode: 'setup', canDraftPlayer: false, canRecordProvisional: false })).toBe('queue');
  });
});

describe('resolveEnterAction on a queued player', () => {
  it('never removes: Enter reports the player is already queued', () => {
    expect(resolveEnterAction({ sessionMode: 'live', canDraftPlayer: false, canRecordProvisional: false, isQueued: true })).toBe('already-queued');
    expect(resolveEnterAction({ sessionMode: 'mock', canDraftPlayer: false, canRecordProvisional: false, isQueued: true })).toBe('already-queued');
    // Drafting still wins on your turn, queued or not.
    expect(resolveEnterAction({ sessionMode: 'mock', canDraftPlayer: true, canRecordProvisional: false, isQueued: true })).toBe('draft');
  });
});
