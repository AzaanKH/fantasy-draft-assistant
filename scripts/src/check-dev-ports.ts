import { localDevPorts } from '@fantasy-draft/shared';
import { createServer } from 'node:net';

const { webPort, apiPort } = localDevPorts(process.env);
const DEV_PORTS = [webPort, apiPort];

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

    server.listen(port, '127.0.0.1');
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
