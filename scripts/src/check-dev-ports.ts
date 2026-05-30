import { createServer } from 'node:net';

const DEV_PORTS = [3000, 3001] as const;

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        resolve(false);
        return;
      }
      reject(error);
    });

    server.once('listening', () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(true);
      });
    });

    server.listen(port);
  });
}

async function main(): Promise<void> {
  const unavailablePorts = (
    await Promise.all(
      DEV_PORTS.map(async (port) => ({ port, available: await isPortAvailable(port) }))
    )
  )
    .filter(({ available }) => !available)
    .map(({ port }) => port);

  if (unavailablePorts.length > 0) {
    console.error(
      `Cannot start dev services: port${unavailablePorts.length === 1 ? '' : 's'} ` +
      `${unavailablePorts.join(', ')} already in use. Stop the existing dev session first.`
    );
    process.exit(1);
  }

  console.log(`Dev ports available: ${DEV_PORTS.join(', ')}`);
}

main().catch((error: unknown) => {
  console.error('Dev port check failed:', error);
  process.exit(1);
});
