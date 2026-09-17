/** Retain available user choices, including an intentionally empty selection. */
export function reconcileComparisonSelection(
  current: readonly string[] | null,
  recommendationIds: readonly string[]
): readonly string[] | null {
  if (current === null && recommendationIds.length === 0) return current;

  const availableIds = new Set(recommendationIds);
  const retained = current?.filter((id) => availableIds.has(id));
  const next = retained && (retained.length > 0 || current?.length === 0)
    ? retained
    : recommendationIds.slice(0, 2);

  return current && current.length === next.length &&
    current.every((id, index) => id === next[index])
    ? current
    : next;
}
