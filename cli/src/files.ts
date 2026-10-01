import { link, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { CliError } from './errors';

export async function readBoundedJson(path: string, maxBytes: number): Promise<unknown> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > maxBytes) throw new CliError('INVALID_FILE', 'The input must be a regular JSON file within the size limit.', 2);
  const content = await readFile(path, 'utf8');
  if (Buffer.byteLength(content) > maxBytes) throw new CliError('INVALID_FILE', 'The input exceeds the JSON file size limit.', 2);
  return JSON.parse(content) as unknown;
}

/** Publish complete JSON with private permissions, and avoid replacing files implicitly. */
export async function writePrivateJson(path: string, value: unknown, overwrite: boolean): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.draft-${randomBytes(12).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    if (overwrite) await rename(temporary, path);
    else await link(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new CliError('FILE_EXISTS', 'The output file already exists. Choose another path or use --force.', 2);
    throw error;
  } finally { await unlink(temporary).catch(() => undefined); }
}
