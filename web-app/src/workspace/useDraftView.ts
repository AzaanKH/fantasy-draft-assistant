import { deriveDraftState, effectiveKeepers } from '@/stores/draft/source';
import { useCallback } from 'react';
import { useStore } from 'zustand';
import type { DerivedDraft } from '@fantasy-draft/shared/draft';
import type { Player } from '@fantasy-draft/shared/league';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useWorkspace } from './WorkspaceProvider';
import type { DraftState, PreloadedKeeper } from '@/stores/draft/types';

export interface DraftView extends DerivedDraft {
  readonly draftedPlayers: readonly { readonly playerName: string; readonly position: Player['position'] }[];
  readonly effectiveKeepers: readonly PreloadedKeeper[];
}

type Inputs = Pick<DraftState, 'draftProgress' | 'sessionMode' | 'draftHistory' | 'preloadedKeepers' | 'config' | 'shortlistedPlayerIds'>;
interface CachedView { readonly inputs: Inputs; readonly view: DraftView }
type DraftViewStore = { readonly getState: () => DraftState };
const views = new WeakMap<DraftViewStore, WeakMap<readonly Player[], CachedView>>();
const EMPTY_PLAYERS: readonly Player[] = [];

function selectDraftView(store: DraftViewStore, state: Inputs, players: readonly Player[]): DraftView {
  let catalogs = views.get(store);
  if (!catalogs) { catalogs = new WeakMap(); views.set(store, catalogs); }
  const previous = catalogs.get(players);
  const before = previous?.inputs;
  if (before && before.draftProgress === state.draftProgress && before.sessionMode === state.sessionMode &&
      before.draftHistory === state.draftHistory && before.preloadedKeepers === state.preloadedKeepers &&
      before.config === state.config && before.shortlistedPlayerIds === state.shortlistedPlayerIds) return previous.view;
  const keepers = effectiveKeepers(state);
  const view: DraftView = {
    ...deriveDraftState(state, players),
    draftedPlayers: [...state.draftHistory, ...keepers],
    effectiveKeepers: keepers,
  };
  catalogs.set(players, { inputs: state, view });
  return view;
}

/** Fresh callback read. Without a catalog, availability is empty; membership and permissions still apply. */
export function getDraftView(store: DraftViewStore, players: readonly Player[] = EMPTY_PLAYERS): DraftView {
  return selectDraftView(store, store.getState(), players);
}

export function useDraftView<T>(selector: (view: DraftView) => T): T {
  const store = useWorkspace().draft;
  const { players } = usePlayerDataQuery();
  return useStore(store, state => selector(selectDraftView(store, state, players)));
}

export function useDraftViewReader(): () => DraftView {
  const store = useWorkspace().draft;
  const { players } = usePlayerDataQuery();
  return useCallback(() => getDraftView(store, players), [store, players]);
}
