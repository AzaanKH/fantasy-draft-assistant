import type { DraftProvider } from '@fantasy-draft/shared';

const PROVIDER_NAMES: Readonly<Record<DraftProvider, string>> = { sleeper: 'Sleeper', yahoo: 'Yahoo', espn: 'ESPN' };

/** Display name for the connected provider, or a generic label before one is known. */
export function getProviderName(provider: DraftProvider | null): string {
  return provider ? PROVIDER_NAMES[provider] : 'Provider';
}
