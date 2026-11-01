import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HELP } from './arguments';
import { runDraft } from './run';

let root: string;
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'draft-usage-')); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

async function invoke(argv: string[]) {
  const stdout: string[] = []; const stderr: string[] = [];
  const code = await runDraft(argv, { stdout: text => { stdout.push(text); }, stderr: text => { stderr.push(text); } },
    { root, env: {}, signal: new AbortController().signal });
  return { code, stdout: stdout.join(''), stderr: stderr.join('') };
}

const usageError = (command: string | null, message: string) =>
  `${JSON.stringify({ schemaVersion: 1, command, error: { code: 'INVALID_ARGUMENT', message } })}\n`;

describe('draft usage contract', () => {
  it.each([[[]], [['--help']], [['-h']], [['bogus', '--help']], [['status', '--json', '--help']]])(
    'prints help on stdout with exit 0: %j', async argv => {
      expect(await invoke(argv)).toEqual({ code: 0, stdout: HELP, stderr: '' });
    });

  it.each([
    [['--json', '--bogus'], '--json', "Unknown option '--bogus'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"--bogus\""],
    [['--json'], '--json', 'Unknown command . Run draft --help.'],
    [['bogus', '--json'], 'bogus', 'Unknown command bogus. Run draft --help.'],
    [['status', '--session', '1', '--available', '--json'], 'status', '--available is not supported by status.'],
    [['status', '--json', '--session'], 'status', "Option '--session <value>' argument missing"],
    [['recommend', '--session', '1', '--limit', 'five', '--json'], 'recommend', '--limit must be an integer between 1 and 1280.'],
    [['compare', 'p1', '--session', '1', '--json'], 'compare', 'compare expects 2 arguments.'],
    [['status', '--session', '1', '--', '--json'], 'status', 'status expects 0 arguments.'],
    [['watch', '--session', '1', '--json'], 'watch', 'Use --format ndjson for streaming output.'],
    [['watch', '--session', '1', '--bogus'], 'watch', "Unknown option '--bogus'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"--bogus\""],
    [['replay', 'draft.json', '--format', 'ndjson', '--bogus'], 'replay', "Unknown option '--bogus'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"--bogus\""],
    [['replay', 'draft.json', '--format=ndjson', '--bogus'], 'replay', "Unknown option '--bogus'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"--bogus\""],
  ])('writes one JSON usage error on stdout with exit 2: %j', async (argv, command, message) => {
    expect(await invoke(argv)).toEqual({ code: 2, stdout: usageError(command, message), stderr: '' });
  });

  it.each([
    [['--bogus'], "INVALID_ARGUMENT: Unknown option '--bogus'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"--bogus\"\n"],
    [['status', '--session', '1', '--json=false'], "INVALID_ARGUMENT: Option '--json' does not take an argument\n"],
    [['compare', 'p1', '--session', '1'], 'INVALID_ARGUMENT: compare expects 2 arguments.\n'],
  ])('writes CODE: message on stderr without --json, exit 2: %j', async (argv, text) => {
    expect(await invoke(argv)).toEqual({ code: 2, stdout: '', stderr: text });
  });

  it('accepts options before the command name, including command-specific ones', async () => {
    const result = await invoke(['--limit', '5', '--json', 'recommend', '--session', '1', '--slot', '3']);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ schemaVersion: 1, command: 'recommend', error: { code: 'PAIRING_REQUIRED' } });
  });
});
