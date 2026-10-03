import { link, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { Data, Effect } from 'effect';
import { CliError, unexpected } from './errors';

/** Callers choose their own message, so keep whether the file was simply absent. */
export class JsonFileError extends Data.TaggedError('JsonFileError')<{
  readonly path: string;
  readonly missing: boolean;
  readonly cause: unknown;
}> {}

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;

export const readBoundedJson = Effect.fn('readBoundedJson')(function* (path: string, maxBytes: number) {
  const fail = (cause: unknown) => new JsonFileError({ path, missing: errorCode(cause) === 'ENOENT', cause });
  const metadata = yield* Effect.tryPromise({ try: () => stat(path), catch: fail });
  if (!metadata.isFile() || metadata.size > maxBytes) {
    return yield* new CliError('INVALID_FILE', 'The input must be a regular JSON file within the size limit.', 2);
  }
  const content = yield* Effect.tryPromise({ try: () => readFile(path, 'utf8'), catch: fail });
  if (Buffer.byteLength(content) > maxBytes) return yield* new CliError('INVALID_FILE', 'The input exceeds the JSON file size limit.', 2);
  return yield* Effect.try({ try: () => JSON.parse(content) as unknown, catch: fail });
});

/** Publish complete JSON with private permissions, and avoid replacing files implicitly. */
export const writePrivateJson = Effect.fn('writePrivateJson')(function* (path: string, value: unknown, overwrite: boolean) {
  const io = <A>(run: () => Promise<A>) => Effect.tryPromise({
    try: run,
    catch: error => errorCode(error) === 'EEXIST'
      ? new CliError('FILE_EXISTS', 'The output file already exists. Choose another path or use --force.', 2)
      : unexpected(error),
  });
  yield* io(() => mkdir(dirname(path), { recursive: true, mode: 0o700 }));
  const temporary = join(dirname(path), `.draft-${randomBytes(12).toString('hex')}.tmp`);
  yield* io(async () => {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    if (overwrite) await rename(temporary, path);
    else await link(temporary, path);
  }).pipe(Effect.ensuring(Effect.promise(() => unlink(temporary).catch(() => undefined))));
});
