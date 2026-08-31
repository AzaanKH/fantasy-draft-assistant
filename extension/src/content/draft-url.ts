import type { DraftProvider } from '@fantasy-draft/shared';
import type { DraftRoomStatus } from '../shared/types';

const SLEEPER_HOSTS = new Set(['sleeper.app', 'www.sleeper.app', 'sleeper.com', 'www.sleeper.com']);
const YAHOO_HOSTS = new Set([
  'football.fantasysports.yahoo.com',
  'sports-fantasy.media.yahoo.com',
]);
const ESPN_HOSTS = new Set(['fantasy.espn.com']);

interface DraftRoute {
  readonly provider: DraftProvider;
  readonly draftId?: string;
}

function parseSleeperRoute(url: URL): DraftRoute | null {
  if (!SLEEPER_HOSTS.has(url.hostname)) {
    return null;
  }

  const draftMatch = url.pathname.match(/^\/draft\/nfl\/([^/]+)(?:\/|$)/);
  if (draftMatch?.[1]) {
    return {
      provider: 'sleeper',
      draftId: decodeURIComponent(draftMatch[1]),
    };
  }

  return url.pathname.startsWith('/draftroom/')
    ? { provider: 'sleeper' }
    : null;
}

function parseYahooRoute(url: URL): DraftRoute | null {
  if (!YAHOO_HOSTS.has(url.hostname)) {
    return null;
  }

  const draftMatch = url.pathname.match(
    /^\/(?:draftclient\/f1|draft\/f1|f1)\/(\d+)(?:\/|$)/
  );
  return draftMatch?.[1]
    ? { provider: 'yahoo', draftId: draftMatch[1] }
    : null;
}

function parseEspnRoute(url: URL): DraftRoute | null {
  if (!ESPN_HOSTS.has(url.hostname) || url.pathname !== '/football/draft') {
    return null;
  }

  const leagueId = url.searchParams.get('leagueId');
  return leagueId && /^\d{1,20}$/.test(leagueId)
    ? { provider: 'espn', draftId: leagueId }
    : null;
}

/**
 * Parse a supported provider URL without relying on the page's global
 * `window`. Keeping this policy pure makes SPA navigation behavior testable.
 */
export function parseDraftRoomUrl(value: string): DraftRoomStatus {
  try {
    const url = new URL(value);
    const route =
      parseSleeperRoute(url) ?? parseYahooRoute(url) ?? parseEspnRoute(url);

    return route
      ? {
        isInDraftRoom: true,
        provider: route.provider,
        draftId: route.draftId,
      }
      : { isInDraftRoom: false };
  } catch {
    return { isInDraftRoom: false };
  }
}
