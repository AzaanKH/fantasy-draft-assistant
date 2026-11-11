import type { DraftProvider } from '@fantasy-draft/shared/sync';

/** Pure helpers behind the draft connection dialog: input parsing, validation copy, and freshness labels. */

export interface ParsedDraftConnection {
  readonly provider: DraftProvider;
  readonly draftId: string;
}

export type DraftInputValidation =
  | { readonly ok: true; readonly connection: ParsedDraftConnection }
  | { readonly ok: false; readonly message: string };

export function providerLabel(provider: DraftProvider): string {
  return provider === 'yahoo' ? 'Yahoo' : provider === 'espn' ? 'ESPN' : 'Sleeper';
}

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Hostname of a URL-like input, with or without a scheme; null for a bare ID. */
function inputHostname(value: string): string | null {
  if (!value.includes('/') && !value.includes('.')) return null;
  return (tryParseUrl(value) ?? tryParseUrl(`https://${value}`))?.hostname.toLowerCase() ?? null;
}

function isHost(hostname: string | null, domain: string): boolean {
  return hostname === domain || (hostname?.endsWith(`.${domain}`) ?? false);
}

/** Recognizes Sleeper, Yahoo, and ESPN draft room URLs, or a bare provider ID for the selected provider. */
export function parseDraftId(
  selectedProvider: DraftProvider,
  input: string
): ParsedDraftConnection | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hostname = inputHostname(trimmed);
  // The ID must be a whole path segment on the provider's own host.
  const yahooMatch = trimmed.match(
    /\/(?:draftclient\/f1|draft\/f1|f1)\/(\d+)(?:[/?#]|$)/
  );
  if (yahooMatch?.[1] && isHost(hostname, 'yahoo.com')) {
    return { provider: 'yahoo', draftId: yahooMatch[1] };
  }

  const sleeperMatch = trimmed.match(/\/draft\/nfl\/(\d+)(?:[/?#]|$)/);
  if (sleeperMatch?.[1] && (isHost(hostname, 'sleeper.com') || isHost(hostname, 'sleeper.app'))) {
    return { provider: 'sleeper', draftId: sleeperMatch[1] };
  }

  const url = tryParseUrl(trimmed);
  const leagueId = url?.searchParams.get('leagueId');
  if (
    url?.hostname === 'fantasy.espn.com' &&
    url.pathname === '/football/draft' &&
    leagueId &&
    /^\d{1,20}$/.test(leagueId)
  ) {
    return { provider: 'espn', draftId: leagueId };
  }

  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;
  return { provider: selectedProvider, draftId: trimmed };
}

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.includes('/') || /^[\w-]+(\.[\w-]+)+/.test(value);
}

/** Parses the input and explains why it was rejected, so the dialog never fails silently. */
export function validateDraftInput(selectedProvider: DraftProvider, input: string): DraftInputValidation {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, message: `Enter your ${providerLabel(selectedProvider)} draft URL or ID.` };
  const connection = parseDraftId(selectedProvider, trimmed);
  if (connection) return { ok: true, connection };
  if (looksLikeUrl(trimmed)) {
    return {
      ok: false,
      message: 'This link is not a supported draft room URL. Open the Sleeper, ESPN, or Yahoo draft room and copy the URL from its address bar.',
    };
  }
  return { ok: false, message: 'Draft IDs can contain only letters, numbers, hyphens, and underscores.' };
}

export function formatRelativeAge(timestamp: string, now: number): string | null {
  const refreshedAt = Date.parse(timestamp);
  if (Number.isNaN(refreshedAt)) {
    return null;
  }

  const elapsedMinutes = Math.max(0, Math.floor((now - refreshedAt) / 60_000));
  if (elapsedMinutes < 1) return 'just now';
  if (elapsedMinutes < 60) return `${String(elapsedMinutes)}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${String(elapsedHours)}h ago`;

  return `${String(Math.floor(elapsedHours / 24))}d ago`;
}

export function formatTimestamp(timestamp: string | undefined): string {
  if (!timestamp) return 'unavailable';

  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? timestamp : new Date(parsed).toLocaleString();
}

export function getOldestTimestamp(timestamps: readonly (string | undefined)[]): string | null {
  const validTimestamps = timestamps.filter(
    (timestamp): timestamp is string =>
      timestamp !== undefined && !Number.isNaN(Date.parse(timestamp))
  );

  if (validTimestamps.length === 0) return null;

  return validTimestamps.reduce((oldest, timestamp) =>
    Date.parse(timestamp) < Date.parse(oldest) ? timestamp : oldest
  );
}

export type ConfidenceTone = 'neutral' | 'good' | 'warn' | 'bad';

/** Market data older than a day is a warning and older than three days is bad. */
export function marketFreshnessTone(refreshedAt: string | null, now: number): ConfidenceTone {
  if (refreshedAt === null) return 'bad';
  const ageHours = Math.max(0, (now - Date.parse(refreshedAt)) / 3_600_000);
  return ageHours >= 72 ? 'bad' : ageHours >= 24 ? 'warn' : 'good';
}
