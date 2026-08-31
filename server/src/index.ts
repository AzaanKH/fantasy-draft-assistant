import { createSyncServer, DEFAULT_POLL_INTERVAL_MS } from './sync-server.js';

const PORT = Number.parseInt(process.env.PORT ?? '3001', 10);
const POLL_INTERVAL_MS = Number.parseInt(
  process.env.DRAFT_SYNC_POLL_INTERVAL_MS ??
    process.env.SLEEPER_POLL_INTERVAL_MS ??
    `${DEFAULT_POLL_INTERVAL_MS}`,
  10
);
const ALLOWED_ORIGINS = (process.env.SYNC_ALLOWED_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const server = createSyncServer({
  pollIntervalMs: POLL_INTERVAL_MS,
  allowedOrigins: ALLOWED_ORIGINS,
  requestToken: process.env.SYNC_REQUEST_TOKEN,
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `[sync-server] Port ${String(PORT)} is already in use. Stop the existing dev session before starting another.`
    );
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[sync-server] Listening on http://localhost:${PORT}`);
});

function shutdown(): void {
  server.shutdown((error) => {
    if (error) {
      console.error('[sync-server] Failed to shut down cleanly', error);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
