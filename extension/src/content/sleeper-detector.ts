/**
 * Content-script entry point. URL policy, pick parsing, lifecycle
 * orchestration, and Chrome I/O live in separate testable modules.
 */

import { createChromeMessageSender } from './chrome-messenger';
import { createDraftRoomLifecycle } from './draft-room-lifecycle';
import { startEspnContentBridge } from './espn-content-bridge';

const sendMessage = createChromeMessageSender();
startEspnContentBridge(sendMessage);

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

// Some provider pages complete their SPA shell after document_idle. `start`
// is idempotent, so this fallback cannot create duplicate observers or polls.
window.setTimeout(() => {
  lifecycle.start();
}, 2000);
