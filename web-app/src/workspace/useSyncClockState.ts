import { useSyncExternalStore } from 'react';
import { getDraftSyncConnectionState, type DraftSyncConnectionState } from '@/lib/draft-sync-state';
import { readNow, subscribeNow } from './useNow';

export function useSyncClockState(input: Omit<Parameters<typeof getDraftSyncConnectionState>[0], 'now'>): DraftSyncConnectionState {
  const getSnapshot = (): DraftSyncConnectionState => getDraftSyncConnectionState({ ...input, now: readNow() });
  return useSyncExternalStore(subscribeNow, getSnapshot, getSnapshot);
}
