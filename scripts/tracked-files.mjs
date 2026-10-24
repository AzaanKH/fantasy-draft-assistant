import { execFileSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

export async function trackedFiles(root) {
  const paths = execFileSync('git', ['ls-files', '-z', '--cached'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const files = [];
  for (const file of paths) {
    try {
      const target = path.join(root, file);
      const stat = await lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular file');
      files.push({ path: file, content: await readFile(target) });
    } catch {
      throw new Error(`Cannot scan tracked path ${JSON.stringify(file)}. Restore a regular readable file; tracked symlinks are not allowed.`);
    }
  }
  return files;
}
