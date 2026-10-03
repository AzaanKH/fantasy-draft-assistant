import { Data, Effect } from 'effect';

/** A failure with a stable machine-readable code and the process exit code it maps to. */
export class CliError extends Data.TaggedError('CliError')<{
  readonly code: string;
  readonly message: string;
  readonly exitCode: number;
  readonly details?: unknown;
}> {
  constructor(code: string, message: string, exitCode = 1, details?: unknown) {
    super({ code, message, exitCode, details });
  }
}

/** Report an unanticipated failure with its own message, as the CLI did before typed errors. */
export const unexpected = (error: unknown): CliError => new CliError('COMMAND_FAILED',
  error instanceof Error ? error.message : 'The command failed.');

/** Narrows a value that an earlier validation step guarantees is present. */
export function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new CliError('INTERNAL_ERROR', `Missing ${what}.`);
  return value;
}

/** Run synchronous validation, keeping its CliError in the error channel and anything else as a defect. */
export const attempt = <A>(evaluate: () => A): Effect.Effect<A, CliError> => Effect.suspend(() => {
  try { return Effect.succeed(evaluate()); }
  catch (error) { return error instanceof CliError ? Effect.fail(error) : Effect.die(error); }
});
