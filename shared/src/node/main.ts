export interface NodeMainOptions {
  readonly failureLabel?: string;
}

/** Signal handlers stay installed until the program has released its resources. */
export async function runNodeMain(program: (signal: AbortSignal) => Promise<void>, options: NodeMainOptions = {}): Promise<void> {
  const controller = new AbortController();
  const stop = (): void => { controller.abort(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    await program(controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) {
      if (options.failureLabel) console.error(options.failureLabel, error);
      else console.error(error);
      process.exitCode = 1;
    }
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    if (controller.signal.aborted) process.exitCode = 130;
  }
}
