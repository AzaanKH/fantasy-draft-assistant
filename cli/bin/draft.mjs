#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Resolve from the installed command so it also works outside the repository.
process.env.DRAFT_ROOT ??= fileURLToPath(new URL('../..', import.meta.url));
const entry = new URL('../dist/draft.js', import.meta.url);
if (!existsSync(entry)) {
  const error = { schemaVersion: 1, command: null, error: {
    code: 'CLI_NOT_BUILT', message: 'Run pnpm build:cli from the repository root before using draft.',
  } };
  if (process.argv.includes('--json') || process.argv.includes('ndjson')) {
    process.stdout.write(`${JSON.stringify(error)}\n`);
  } else {
    process.stderr.write(`${error.error.message}\n`);
  }
  process.exitCode = 1;
} else {
  await import(entry.href);
}
