import type { Player } from '@fantasy-draft/shared/league';
import { useDraftView } from '@/workspace/useDraftView';

export function useDraftedPlayers(): readonly { readonly playerName: string; readonly position: Player['position'] }[] {
  return useDraftView(view => view.draftedPlayers);
}

/** Complete browse availability, independent of recommendation readiness and display limits. */
export function useUndraftedPlayers(): readonly Player[] {
  return useDraftView(view => view.available);
}
