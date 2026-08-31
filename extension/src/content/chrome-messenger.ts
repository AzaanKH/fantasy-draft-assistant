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
