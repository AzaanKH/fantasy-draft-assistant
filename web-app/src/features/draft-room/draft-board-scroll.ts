interface DraftBoardScrollTargetInput {
  readonly containerTop: number;
  readonly containerLeft: number;
  readonly containerScrollTop: number;
  readonly containerScrollLeft: number;
  readonly containerHeight: number;
  readonly containerWidth: number;
  readonly slotTop: number;
  readonly slotLeft: number;
  readonly slotHeight: number;
  readonly slotWidth: number;
  readonly stickyHeaderHeight: number;
  readonly stickyColumnWidth: number;
}

interface DraftBoardScrollTarget {
  readonly top: number;
  readonly left: number;
}

/**
 * Centers a draft slot in the board's unobscured viewport. Element rectangles
 * are viewport-relative, so normalize them to the board's scroll content before
 * calculating the target. This keeps the result independent of page scroll.
 */
export function getDraftBoardScrollTarget({
  containerTop,
  containerLeft,
  containerScrollTop,
  containerScrollLeft,
  containerHeight,
  containerWidth,
  slotTop,
  slotLeft,
  slotHeight,
  slotWidth,
  stickyHeaderHeight,
  stickyColumnWidth,
}: DraftBoardScrollTargetInput): DraftBoardScrollTarget {
  const slotContentTop = slotTop - containerTop + containerScrollTop;
  const slotContentLeft = slotLeft - containerLeft + containerScrollLeft;
  const visibleHeight = Math.max(0, containerHeight - stickyHeaderHeight);
  const visibleWidth = Math.max(0, containerWidth - stickyColumnWidth);

  return {
    top: Math.max(
      0,
      slotContentTop - stickyHeaderHeight - Math.max(0, (visibleHeight - slotHeight) / 2)
    ),
    left: Math.max(
      0,
      slotContentLeft - stickyColumnWidth - Math.max(0, (visibleWidth - slotWidth) / 2)
    ),
  };
}
