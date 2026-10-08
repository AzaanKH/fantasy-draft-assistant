/**
 * Copies demo-data/ into data/ for every file that is missing, so CI and fresh
 * clones can build and test without the untracked local data. Existing local
 * files are never overwritten.
 *
 * Usage: pnpm data:demo:install
 */

import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { Effect } from 'effect';
import { DATA_DIR, REPO_ROOT } from './model/duckdb.js';
import { io, runMain } from './effect-runtime.js';

const DEMO_DATA_DIR = join(REPO_ROOT, 'demo-data');

const program = Effect.gen(function* () {
  const entries = yield* io(() => readdir(DEMO_DATA_DIR, { recursive: true, withFileTypes: true }));
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => relative(DEMO_DATA_DIR, join(entry.parentPath, entry.name)));
  const installed = yield* Effect.forEach(files, (file) => io(async () => {
    const target = join(DATA_DIR, file);
    await mkdir(dirname(target), { recursive: true });
    try {
      // COPYFILE_EXCL (1) fails instead of replacing a local file.
      await copyFile(join(DEMO_DATA_DIR, file), target, 1);
      return [file];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return [];
      throw error;
    }
  }));
  const copied = installed.flat();
  console.log(copied.length > 0
    ? `Installed demo data into data/: ${copied.join(', ')}`
    : 'data/ already has every demo file; nothing was copied.');
});

runMain(program, 'Demo data install failed:');
