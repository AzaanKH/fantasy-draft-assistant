import { Data, Effect } from 'effect';
import type {
  DraftMetadata,
  DraftPickEvent,
  DraftProvider,
} from '@fantasy-draft/shared/sync';

/** The network boundary, injected by tests; Effect supplies the signal and aborts it on interruption. */
export type FetchJson = (
  url: string,
  signal: AbortSignal,
  init?: RequestInit
) => Promise<unknown>;

/** A provider request or payload failed; the message is shown to the user as the sync error. */
export class ProviderError extends Data.TaggedError('ProviderError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const providerError = (cause: unknown, fallback = 'Unknown sync error'): ProviderError =>
  cause instanceof ProviderError ? cause : new ProviderError({
    message: cause instanceof Error ? cause.message : fallback,
    cause,
  });

export const requestJson = (fetchJson: FetchJson, url: string, init?: RequestInit): Effect.Effect<unknown, ProviderError> =>
  Effect.tryPromise({ try: (signal) => fetchJson(url, signal, init), catch: (cause) => providerError(cause) });

/** Validate a payload inside the error channel; the validators report problems by throwing. */
export const parsePayload = <A>(parse: () => A): Effect.Effect<A, ProviderError> =>
  Effect.try({ try: parse, catch: (cause) => {
    const error = providerError(cause);
    console.warn('[sync-adapter] Rejected provider payload', error.message);
    return error;
  } });

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
