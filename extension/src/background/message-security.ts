import { decodeExtensionMessage } from '../shared/boundary-decoders';
import { MAX_DRAFT_TEAMS } from '@fantasy-draft/shared/units';
import { isDraftProviderHost, parseDraftRoomUrl } from '@fantasy-draft/shared/sync';
import type { ExtensionMessage, MessageResponse } from '../shared/types';

export function decodeAuthorizedExtensionMessage(
  value: unknown, sender: chrome.runtime.MessageSender, extensionId: string
): ExtensionMessage {
  if (sender.id !== extensionId) throw new Error('Invalid extension sender');
  const message = decodeExtensionMessage(value);
  if (message.type === 'GET_DRAFT_STATUS' || message.type === 'OPEN_SIDE_PANEL') {
    const url = sender.url === undefined ? undefined : new URL(sender.url);
    const internal = url !== undefined && (url.origin === `chrome-extension://${extensionId}` ||
      (url.protocol === 'chrome-extension:' && url.hostname === extensionId));
    if (internal && ['/sidepanel.html', '/options.html'].includes(url.pathname)) return message;
    throw new Error('Background state is available only to extension pages');
  }
  // Chromium freezes sender.url at script-context creation, so after a single-page
  // navigation it still names the old route. The tab URL is current; bind it to
  // the frame's origin so a cross-origin navigation cannot borrow it.
  const origin = sender.origin === undefined ? undefined : new URL(sender.origin);
  const tabUrl = sender.tab?.url === undefined ? undefined : new URL(sender.tab.url);
  if (sender.frameId !== 0 || origin === undefined || tabUrl === undefined ||
      origin.protocol !== 'https:' || !isDraftProviderHost(origin.hostname) || tabUrl.origin !== origin.origin) {
    throw new Error('Invalid provider frame');
  }
  const route = parseDraftRoomUrl(tabUrl.href);
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
