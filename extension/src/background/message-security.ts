import { decodeExtensionMessage } from '../shared/boundary-decoders';
import { MAX_DRAFT_TEAMS } from '@fantasy-draft/shared/units';
import type { ExtensionMessage, MessageResponse } from '../shared/types';

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

export function decodeAuthorizedExtensionMessage(
  value: unknown, sender: chrome.runtime.MessageSender, extensionId: string
): ExtensionMessage {
  if (sender.id !== extensionId || !sender.url) throw new Error('Invalid extension sender');
  const message = decodeExtensionMessage(value);
  const url = new URL(sender.url);
  const route = senderDraft(url);
  const internal = url.origin === `chrome-extension://${extensionId}` ||
    (url.protocol === 'chrome-extension:' && url.hostname === extensionId);
  if (message.type === 'GET_DRAFT_STATUS' || message.type === 'OPEN_SIDE_PANEL') {
    if (internal && ['/sidepanel.html', '/options.html'].includes(url.pathname)) return message;
    throw new Error('Background state is available only to extension pages');
  }
  if (!sender.tab || sender.frameId !== 0 || url.protocol !== 'https:' ||
      !['fantasy.espn.com', 'sleeper.app', 'sleeper.com', 'football.fantasysports.yahoo.com',
        'sports-fantasy.media.yahoo.com'].includes(url.hostname)) throw new Error('Invalid provider frame');
  switch (message.type) {
    case 'ESPN_DRAFT_SNAPSHOT':
      if (message.data.draft.leagueSettings !== undefined) throw new Error('Page snapshots cannot supply league settings');
      if (route.provider === 'espn' && message.data.draft.draftId === route.draftId &&
          (message.data.draft.leagueId === undefined || message.data.draft.leagueId === route.draftId)) return message;
      break;
    case 'DRAFT_ROOM_STATUS':
      if (!message.data.isInDraftRoom && !route.isInDraftRoom) return message;
      if (message.data.isInDraftRoom && route.isInDraftRoom &&
          message.data.provider === route.provider && message.data.draftId === route.draftId &&
          (message.data.myDraftSlot === undefined || message.data.myDraftSlot <= MAX_DRAFT_TEAMS)) return message;
      break;
    case 'PICK_DETECTED':
      if (route.isInDraftRoom && message.data.playerName.length <= 256 && message.data.teamName.length <= 256 &&
          (message.data.position === undefined || message.data.position.length <= 10) &&
          (message.data.pickNumber === undefined || message.data.pickNumber.length <= 10) &&
          Number.isSafeInteger(message.data.timestamp)) return message;
      break;
  }
  throw new Error('Message does not match its provider draft page');
}

export function receiveExtensionMessage(
  value: unknown,
  sender: chrome.runtime.MessageSender,
  extensionId: string,
  handleMessage: (message: ExtensionMessage, respond: (response: MessageResponse) => void) => boolean,
  respond: (response: MessageResponse) => void,
  logger: Pick<Console, 'warn'> = console
): boolean {
  let message: ExtensionMessage;
  try { message = decodeAuthorizedExtensionMessage(value, sender, extensionId); } catch (error) {
    logger.warn('[Fantasy Draft BG] Rejected extension message:', error);
    respond({ success: false, error: 'Invalid message sender or payload' });
    return false;
  }
  return handleMessage(message, respond);
}
