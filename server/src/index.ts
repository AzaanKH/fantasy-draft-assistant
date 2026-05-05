import { createSyncServer, DEFAULT_POLL_INTERVAL_MS } from './sync-server.js';

const PORT = Number.parseInt(process.env.PORT ?? '3001', 10);
const POLL_INTERVAL_MS = Number.parseInt(
  process.env.SLEEPER_POLL_INTERVAL_MS ?? `${DEFAULT_POLL_INTERVAL_MS}`,
  10
);

const server = createSyncServer({
  pollIntervalMs: POLL_INTERVAL_MS,
});

server.listen(PORT, () => {
  console.log(`[sync-server] Listening on http://localhost:${PORT}`);
});
