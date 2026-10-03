import type { Player, Position, Recommendation } from '@fantasy-draft/shared';

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

/** The player the analysis panel describes. A selection keeps its identity even when no recommendation exists for it. */
export type ViewedPlayer =
  | { readonly kind: 'recommendation'; readonly recommendation: Recommendation }
  | {
      readonly kind: 'unavailable';
      readonly playerId: string;
      readonly playerName: string;
      readonly position: Position;
      readonly reason: 'drafted' | 'unranked';
    }
  | { readonly kind: 'none' };

export function resolveViewedPlayer({
  selectedPlayerId,
  recommendationById,
  playerById,
  draftedPlayerIds,
  leader,
}: {
  readonly selectedPlayerId: string | null;
  readonly recommendationById: ReadonlyMap<string, Recommendation>;
  readonly playerById: ReadonlyMap<string, Player>;
  readonly draftedPlayerIds: ReadonlySet<string>;
  readonly leader: Recommendation | null;
}): ViewedPlayer {
  if (selectedPlayerId) {
    const recommendation = recommendationById.get(selectedPlayerId);
    if (recommendation) return { kind: 'recommendation', recommendation };
    const player = playerById.get(selectedPlayerId);
    if (player) {
      return {
        kind: 'unavailable',
        playerId: player.id,
        playerName: player.name,
        position: player.position,
        reason: draftedPlayerIds.has(player.id) ? 'drafted' : 'unranked',
      };
    }
  }
  return leader ? { kind: 'recommendation', recommendation: leader } : { kind: 'none' };
}
