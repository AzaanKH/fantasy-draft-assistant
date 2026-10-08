/**
 * Fails when a publishable directory contains FantasyPros IDs or URLs, the real
 * league name, or Sleeper user, league, or draft IDs.
 *
 * Usage: pnpm data:demo:check [directory ...]   (defaults to demo-data/)
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { Effect } from 'effect';
import { findDemoDataLeaks } from './demo-data-core.js';
import { REPO_ROOT } from './model/duckdb.js';
import { io, runMain } from './effect-runtime.js';

const TEXT_FILE = /\.(json|js|mjs|css|html|map|txt|md)$/;

const program = Effect.gen(function* () {
  const args = process.argv.slice(2);
  // pnpm runs scripts from scripts/, so resolve paths from where the command was typed.
  const directories = args.length > 0
    ? args.map((directory) => resolve(process.env['INIT_CWD'] ?? process.cwd(), directory))
    : [join(REPO_ROOT, 'demo-data')];
  const leaks = yield* Effect.forEach(directories, (directory) => io(async () => {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && TEXT_FILE.test(entry.name));
    const results = await Promise.all(files.map(async (entry) => {
      const path = join(entry.parentPath, entry.name);
      return findDemoDataLeaks(relative(REPO_ROOT, path), await readFile(path, 'utf8'));
    }));
    return results.flat();
  }));
  const found = leaks.flat();
  if (found.length > 0) {
    return yield* Effect.fail(new Error(found.join('\n')));
  }
  console.log(`No FantasyPros or league data found in ${directories.map((directory) => relative(REPO_ROOT, directory)).join(', ')}.`);
});

runMain(program, 'Demo data check failed:');
