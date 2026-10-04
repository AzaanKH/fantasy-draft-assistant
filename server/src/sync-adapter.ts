import { Data, Effect } from 'effect';
import type {
  DraftMetadata,
  DraftPickEvent,
  DraftProvider,
} from '@fantasy-draft/shared';

/** The network boundary, injected by tests; Effect supplies the signal and aborts it on interruption. */
export type FetchJson = <T>(
  url: string,
  signal: AbortSignal,
  init?: RequestInit
) => Promise<T>;

/** A provider request or payload failed; the message is shown to the user as the sync error. */
export class ProviderError extends Data.TaggedError('ProviderError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const providerError = (cause: unknown, fallback = 'Unknown sync error'): ProviderError =>
  cause instanceof ProviderError ? cause : new ProviderError({
    message: cause instanceof Error ? cause.message : fallback,
    cause,
  });

export const requestJson = <T>(fetchJson: FetchJson, url: string, init?: RequestInit): Effect.Effect<T, ProviderError> =>
  Effect.tryPromise({ try: (signal) => fetchJson<T>(url, signal, init), catch: (cause) => providerError(cause) });

/** Validate a payload inside the error channel; the validators report problems by throwing. */
export const parsePayload = <A>(parse: () => A): Effect.Effect<A, ProviderError> =>
  Effect.try({ try: parse, catch: (cause) => providerError(cause) });

export interface DraftAdapterSnapshot {
  readonly draft: DraftMetadata;
  readonly picks: readonly DraftPickEvent[];
}

export interface DraftSyncAdapter {
  readonly provider: DraftProvider;
  readonly draftId: string;
  invalidateSettings?: () => void;
  poll: () => Effect.Effect<DraftAdapterSnapshot, ProviderError>;
}
