export type AssistantLens = 'why' | 'compare' | 'wait' | 'roster';

export interface AssistantNavigationTarget {
  readonly lens: AssistantLens;
  readonly selectedPlayerId: string | null;
}

export const DEFAULT_ASSISTANT_NAVIGATION_TARGET: AssistantNavigationTarget = {
  lens: 'why',
  selectedPlayerId: null,
};

export function getAssistantNavigationTarget(value: unknown): AssistantNavigationTarget {
  if (!value || typeof value !== 'object') return DEFAULT_ASSISTANT_NAVIGATION_TARGET;

  const candidate = value as Record<string, unknown>;
  const lens = candidate.lens;
  if (lens !== 'why' && lens !== 'compare' && lens !== 'wait' && lens !== 'roster') {
    return DEFAULT_ASSISTANT_NAVIGATION_TARGET;
  }

  return {
    lens,
    selectedPlayerId: typeof candidate.selectedPlayerId === 'string'
      ? candidate.selectedPlayerId
      : null,
  };
}
