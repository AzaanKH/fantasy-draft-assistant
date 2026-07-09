import { createSyncServer, DEFAULT_POLL_INTERVAL_MS } from './sync-server.js';

const PORT = Number.parseInt(process.env.PORT ?? '3001', 10);
const POLL_INTERVAL_MS = Number.parseInt(
  process.env.SLEEPER_POLL_INTERVAL_MS ?? `${DEFAULT_POLL_INTERVAL_MS}`,
  10
);

const server = createSyncServer({
  pollIntervalMs: POLL_INTERVAL_MS,
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
