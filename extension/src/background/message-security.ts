import { isEspnDraftSnapshot, MAX_DRAFT_TEAMS } from '@fantasy-draft/shared';
import type { ExtensionMessage } from '../shared/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shortString(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length <= max;
}

// Keep background validation independent of the classic content-script bundle.
function senderDraft(url: URL): { isInDraftRoom: boolean; provider?: string; draftId?: string } {
  if (url.hostname === 'fantasy.espn.com' && url.pathname === '/football/draft') {
    const draftId = url.searchParams.get('leagueId');
    if (draftId && /^\d{1,20}$/.test(draftId)) return { isInDraftRoom: true, provider: 'espn', draftId };
  }
  if (['sleeper.app', 'sleeper.com'].includes(url.hostname)) {
    const match = url.pathname.match(/^\/draft\/nfl\/([^/]+)(?:\/|$)/);
    if (match?.[1]) return { isInDraftRoom: true, provider: 'sleeper', draftId: decodeURIComponent(match[1]) };
    if (url.pathname.startsWith('/draftroom/')) return { isInDraftRoom: true, provider: 'sleeper' };
  }
  if (['football.fantasysports.yahoo.com', 'sports-fantasy.media.yahoo.com'].includes(url.hostname)) {
    const match = url.pathname.match(/^\/(?:draftclient\/f1|draft\/f1|f1)\/(\d+)(?:\/|$)/);
    if (match?.[1]) return { isInDraftRoom: true, provider: 'yahoo', draftId: match[1] };
  }
  return { isInDraftRoom: false };
}

/** Chrome-supplied sender identity is checked before treating a payload as an internal message. */
export function isAuthorizedExtensionMessage(
  message: unknown, sender: chrome.runtime.MessageSender, extensionId: string
): message is ExtensionMessage {
  if (sender.id !== extensionId || !sender.url || !isRecord(message)) return false;
  let url: URL;
  let route: ReturnType<typeof senderDraft>;
  try { url = new URL(sender.url); route = senderDraft(url); } catch { return false; }
  const internal = url.origin === `chrome-extension://${extensionId}` ||
    (url.protocol === 'chrome-extension:' && url.hostname === extensionId);
  if (message['type'] === 'GET_DRAFT_STATUS' || message['type'] === 'OPEN_SIDE_PANEL') {
    return internal && ['/sidepanel.html', '/options.html'].includes(url.pathname);
  }
  if (!sender.tab || sender.frameId !== 0 || url.protocol !== 'https:' ||
      !['fantasy.espn.com', 'sleeper.app', 'sleeper.com', 'football.fantasysports.yahoo.com',
        'sports-fantasy.media.yahoo.com'].includes(url.hostname)) return false;
  const data = message['data'];
  if (message['type'] === 'ESPN_DRAFT_SNAPSHOT') {
    return route.provider === 'espn' && isEspnDraftSnapshot(data) &&
      data.draft.draftId === route.draftId &&
      (data.draft.leagueId === undefined || data.draft.leagueId === route.draftId);
  }
  if (!isRecord(data)) return false;
  if (message['type'] === 'DRAFT_ROOM_STATUS') {
    if (data['isInDraftRoom'] === false) return !route.isInDraftRoom;
    return data['isInDraftRoom'] === true && route.isInDraftRoom &&
      data['provider'] === route.provider && data['draftId'] === route.draftId &&
      (data['myDraftSlot'] === undefined || (typeof data['myDraftSlot'] === 'number' &&
        Number.isInteger(data['myDraftSlot']) && data['myDraftSlot'] >= 1 && data['myDraftSlot'] <= MAX_DRAFT_TEAMS));
  }
  if (message['type'] === 'PICK_DETECTED') {
    return route.isInDraftRoom && shortString(data['playerName']) && shortString(data['teamName']) &&
      (data['position'] === undefined || shortString(data['position'], 10)) &&
      (data['pickNumber'] === undefined || shortString(data['pickNumber'], 10)) &&
      typeof data['timestamp'] === 'number' && Number.isSafeInteger(data['timestamp']);
  }
  return false;
}
