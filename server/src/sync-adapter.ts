import type {
  DraftMetadata,
  DraftPickEvent,
  DraftProvider,
} from '@fantasy-draft/shared';

export type FetchJson = <T>(
  url: string,
  signal: AbortSignal,
  init?: RequestInit
) => Promise<T>;

export interface DraftAdapterSnapshot {
  readonly draft: DraftMetadata;
  readonly picks: readonly DraftPickEvent[];
}

export interface DraftSyncAdapter {
  readonly provider: DraftProvider;
  readonly draftId: string;
  poll: (signal: AbortSignal) => Promise<DraftAdapterSnapshot>;
}
