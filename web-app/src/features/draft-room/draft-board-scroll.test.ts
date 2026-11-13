import { describe, expect, it } from 'vitest';
import { createProgrammaticScrollGuard, getDraftBoardScrollTarget, isSlotInView } from './draft-board-scroll';

describe('getDraftBoardScrollTarget', () => {
  it('keeps the first round below the sticky header regardless of page position', () => {
    const target = getDraftBoardScrollTarget({
      containerTop: 320,
      containerLeft: 24,
      containerScrollTop: 0,
      containerScrollLeft: 0,
      containerWidth: 1200,
      slotTop: 368,
      slotLeft: 608,
      slotWidth: 132,
      stickyHeaderHeight: 48,
      stickyColumnWidth: 56,
    });

    expect(target.top).toBe(0);
  });

  it('starts a later round right under the sticky header, so it and the rounds after it show whole', () => {
    expect(getDraftBoardScrollTarget({
      containerTop: 100,
      containerLeft: 20,
      containerScrollTop: 200,
      containerScrollLeft: 300,
      containerWidth: 1000,
      slotTop: 380,
      slotLeft: 620,
      slotWidth: 132,
      stickyHeaderHeight: 48,
      stickyColumnWidth: 56,
    })).toEqual({ top: 432, left: 438 });
  });

  it('shows at least two complete rounds on a laptop-height board at pick 11.05', () => {
    // 1280x800: a 190px board with a 40px team header and 64px rounds 4px apart.
    const header = 40;
    const step = 68;
    const round = 11;
    const target = getDraftBoardScrollTarget({
      containerTop: 0,
      containerLeft: 0,
      containerScrollTop: 0,
      containerScrollLeft: 0,
      containerWidth: 1240,
      slotTop: header + (round - 1) * step,
      slotLeft: 600,
      slotWidth: 124,
      stickyHeaderHeight: header,
      stickyColumnWidth: 56,
    });
    const visibleTop = target.top + header;
    const visibleBottom = target.top + 190;
    const completeRounds = Array.from({ length: 15 }, (_, index) => header + index * step)
      .filter((top) => top >= visibleTop && top + 64 <= visibleBottom).length;
    expect(completeRounds).toBeGreaterThanOrEqual(2);
  });
});

describe('isSlotInView', () => {
  const container = { top: 0, left: 0, bottom: 300, right: 800 };
  it('counts a partly visible slot as in view', () => {
    expect(isSlotInView(container, { top: 280, left: 100, bottom: 352, right: 200 }, 76, 40)).toBe(true);
  });
  it('treats a slot hidden under the sticky header or round column, or scrolled past, as out of view', () => {
    expect(isSlotInView(container, { top: 0, left: 100, bottom: 72, right: 200 }, 76, 40)).toBe(false);
    expect(isSlotInView(container, { top: 100, left: 0, bottom: 172, right: 36 }, 76, 40)).toBe(false);
    expect(isSlotInView(container, { top: 400, left: 100, bottom: 472, right: 200 }, 76, 40)).toBe(false);
  });
});

describe('createProgrammaticScrollGuard', () => {
  function fakeTimers() {
    const pending = new Map<number, () => void>();
    let next = 1;
    return {
      pending,
      timers: { set: (callback: () => void) => { const id = next++; pending.set(id, callback); return id; }, clear: (id: number) => { pending.delete(id); } },
      fire: () => { for (const [id, callback] of [...pending]) { pending.delete(id); callback(); } },
    };
  }

  it('stays active until the container fires scrollend, then clears its fallback timer', () => {
    const container = new EventTarget();
    const clock = fakeTimers();
    const guard = createProgrammaticScrollGuard(container, clock.timers);
    guard.begin();
    expect(guard.isActive()).toBe(true);
    container.dispatchEvent(new Event('scroll'));
    expect(guard.isActive()).toBe(true);
    container.dispatchEvent(new Event('scrollend'));
    expect(guard.isActive()).toBe(false);
    expect(clock.pending.size).toBe(0);
  });

  it('ends on the fallback timeout when scrollend never arrives', () => {
    const clock = fakeTimers();
    const guard = createProgrammaticScrollGuard(new EventTarget(), clock.timers);
    guard.begin();
    clock.fire();
    expect(guard.isActive()).toBe(false);
  });

  it('ends at once on user input and stops listening after dispose', () => {
    const container = new EventTarget();
    const clock = fakeTimers();
    const guard = createProgrammaticScrollGuard(container, clock.timers);
    guard.begin();
    guard.end();
    expect(guard.isActive()).toBe(false);
    guard.begin();
    guard.dispose();
    expect(guard.isActive()).toBe(false);
    guard.begin();
    container.dispatchEvent(new Event('scrollend'));
    // Disposed guards no longer hear scrollend; only their own timer or end() closes them.
    expect(guard.isActive()).toBe(true);
  });
});
