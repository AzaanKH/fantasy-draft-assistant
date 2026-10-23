import type { ExtensionMessage } from '../shared/types';

export type ExtensionMessageSender = (message: ExtensionMessage) => void;

export function createChromeMessageSender(
  runtime: Pick<typeof chrome.runtime, 'sendMessage'> = chrome.runtime
): ExtensionMessageSender {
  return (message) => {
    console.log('[Fantasy Draft] Sending message:', message.type);
    void runtime.sendMessage(message).catch((error: unknown) => {
      console.warn('[Fantasy Draft] Failed to send message:', error);
    });
  };
}

export type UndecodedEspnSnapshotRelay = (snapshot: unknown) => void;

export function createChromeUndecodedEspnSnapshotRelay(
  runtime: Pick<typeof chrome.runtime, 'sendMessage'> = chrome.runtime
): UndecodedEspnSnapshotRelay {
  return (snapshot) => {
    void runtime.sendMessage({ type: 'ESPN_DRAFT_SNAPSHOT', data: snapshot }).then((response: unknown) => {
      if (typeof response !== 'object' || response === null || !('success' in response) || response.success !== true) {
        console.warn('[Fantasy Draft] Background rejected ESPN snapshot');
      }
    }).catch((error: unknown) => {
      console.warn('[Fantasy Draft] Failed to relay ESPN snapshot:', error);
    });
  };
}
