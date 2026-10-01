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
