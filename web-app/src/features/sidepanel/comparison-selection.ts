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

interface ComparablePlayer {
  readonly playerId: string;
  readonly playerName: string;
}

/**
 * The opponent for the Assistant's explanation of `subject`. Never pairs a player with themselves: when the
 * requested opponent has left the list (usually drafted), the replacement is the first other selected player,
 * then the first other recommendation, and the notice says so. With no other player the explanation is solo.
 */
export function resolveAssistantComparison<T extends ComparablePlayer>({
  subject,
  requested,
  selected,
  recommendations,
  isDrafted,
}: {
  readonly subject: T | undefined;
  /** The opponent chosen in Compare, if any. */
  readonly requested: ComparablePlayer | null;
  readonly selected: readonly T[];
  readonly recommendations: readonly T[];
  readonly isDrafted: (playerId: string) => boolean;
}): { readonly comparison: T | undefined; readonly notice: string | null } {
  if (!subject) return { comparison: undefined, notice: null };
  const isOther = (candidate: T): boolean => candidate.playerId !== subject.playerId;
  const kept = requested && requested.playerId !== subject.playerId
    ? recommendations.find((candidate) => candidate.playerId === requested.playerId)
    : undefined;
  if (kept) return { comparison: kept, notice: null };
  const replacement = selected.find(isOther) ?? recommendations.find(isOther);
  if (!requested || requested.playerId === subject.playerId) return { comparison: replacement, notice: null };
  const left = isDrafted(requested.playerId) ? `${requested.playerName} was drafted.` : `${requested.playerName} is no longer in this list.`;
  return {
    comparison: replacement,
    notice: replacement
      ? `${left} Comparing ${subject.playerName} with ${replacement.playerName} instead.`
      : `${left} Showing ${subject.playerName} on their own.`,
  };
}
