/** Local process configuration. Pass environment explicitly; safe to import in browser builds. */
export function localDevPorts(env: Readonly<Record<string, string | undefined>> = {}): {
  webPort: number; apiPort: number; webOrigin: string; apiOrigin: string;
} {
  const port = (value: string | undefined, fallback: number, name: string): number => {
    if (value === undefined) return fallback;
    if (!/^[1-9]\d*$/.test(value) || Number(value) > 65535) {
      throw new Error(`${name} must be an integer from 1 to 65535`);
    }
    return Number(value);
  };
  const webPort = port(env.DRAFT_WEB_PORT, 3000, 'DRAFT_WEB_PORT');
  const apiPort = port(env.DRAFT_API_PORT ?? env.PORT, 3001, 'DRAFT_API_PORT');
  if (webPort === apiPort) throw new Error('Web and API ports must be different');
  return { webPort, apiPort, webOrigin: `http://localhost:${String(webPort)}`,
    apiOrigin: `http://127.0.0.1:${String(apiPort)}` };
}
