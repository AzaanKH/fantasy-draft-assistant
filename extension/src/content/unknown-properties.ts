export function objectValue(value: unknown): object | null {
  return typeof value === 'object' && value !== null ? value : null;
}

export function readProperty(value: object | null, key: string): unknown {
  if (value === null) return undefined;
  try { return Reflect.get(value, key); } catch { return undefined; }
}
