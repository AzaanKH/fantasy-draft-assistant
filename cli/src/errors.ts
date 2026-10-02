export class CliError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly exitCode = 1,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Narrows a value that an earlier validation step guarantees is present. */
export function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new CliError('INTERNAL_ERROR', `Missing ${what}.`);
  return value;
}
