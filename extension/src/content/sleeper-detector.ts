/**
 * URL policy, pick parsing, lifecycle orchestration, and Chrome I/O live in
 * separate testable modules.
 */

import { createChromeMessageSender, createChromeUndecodedEspnSnapshotRelay } from './chrome-messenger';
import { createDraftRoomLifecycle } from './draft-room-lifecycle';
import { startEspnContentBridge } from './espn-content-bridge';

const LATE_SPA_SHELL_RESTART_MS = 2000;

const sendMessage = createChromeMessageSender();
startEspnContentBridge(createChromeUndecodedEspnSnapshotRelay());

const lifecycle = createDraftRoomLifecycle(
  {
    document,
    getUrl: () => window.location.href,
    createObserver: (callback) => new MutationObserver(callback),
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (timer) => {
      window.clearTimeout(timer);
    },
    setInterval: (callback, delay) => window.setInterval(callback, delay),
    clearInterval: (timer) => {
      window.clearInterval(timer);
    },
    now: () => Date.now(),
  },
  sendMessage
);

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      lifecycle.start();
    },
    { once: true }
  );
} else {
  lifecycle.start();
}

window.setTimeout(() => {
  lifecycle.start();
}, LATE_SPA_SHELL_RESTART_MS);
