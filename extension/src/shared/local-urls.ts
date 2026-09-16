export function localSyncBase(value: string): string {
  const url = new URL(value);
  if (!['http://localhost:3001', 'http://127.0.0.1:3001'].includes(url.origin) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('The sync server must be localhost or 127.0.0.1 on port 3001');
  }
  return url.origin;
}

export function localWebAppBase(value: string): string {
  const url = new URL(value);
  if (!['http://localhost:3000', 'http://127.0.0.1:3000'].includes(url.origin) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('The web app must be localhost or 127.0.0.1 on port 3000');
  }
  return url.origin;
}
