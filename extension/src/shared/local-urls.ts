import { LOCAL_PORTS } from './local-config';

function localBase(value: string, port: number, label: string): string {
  const url = new URL(value);
  const allowed = ['localhost', '127.0.0.1'].map(host => new URL(`http://${host}:${String(port)}`).origin);
  if (!allowed.includes(url.origin) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`The ${label} must be localhost or 127.0.0.1 on port ${String(port)}`);
  }
  return url.origin;
}

export function localSyncBase(value: string): string {
  return localBase(value, LOCAL_PORTS.apiPort, 'sync server');
}

export function localWebAppBase(value: string): string {
  return localBase(value, LOCAL_PORTS.webPort, 'web app');
}
