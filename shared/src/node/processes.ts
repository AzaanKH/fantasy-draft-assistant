import { execFile, spawn } from 'node:child_process';

export interface ProcessOptions {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly shell?: boolean;
  readonly output?: 'capture' | 'inherit' | 'ignore';
  readonly stdin?: 'inherit' | 'ignore';
  readonly maxOutputBytes?: number;
  readonly termGraceMs?: number;
  readonly killGraceMs?: number;
  readonly onStdout?: (text: string) => void;
  readonly onStderr?: (text: string) => void;
}

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export type ProcessErrorKind = 'exit' | 'spawn' | 'timeout' | 'aborted' | 'cleanup' | 'output';

export class ProcessError extends Error {
  readonly name = 'ProcessError';
  constructor(
    readonly kind: ProcessErrorKind,
    readonly command: string,
    readonly args: readonly string[],
    readonly result: ProcessResult,
  ) {
    super(`${command}: ${kind === 'exit' ? result.signal ? `stopped by ${result.signal}` : `exit code ${String(result.exitCode)}` : kind}`);
  }
  get exitCode(): number | null { return this.result.exitCode; }
  get stderr(): string { return this.result.stderr; }
}

export interface ProcessService {
  readonly pid: number | undefined;
  readonly exit: { readonly code: number | null; readonly signal: NodeJS.Signals | null } | null;
  readonly result: Promise<ProcessResult>;
  stop(): Promise<void>;
}

const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

class OutputTail {
  private bytes: Buffer = Buffer.alloc(0);
  truncated = false;
  constructor(private readonly cap: number) {}
  append(chunk: Buffer): void {
    this.truncated ||= this.bytes.length + chunk.length > this.cap;
    this.bytes = chunk.length >= this.cap ? Buffer.from(chunk.subarray(chunk.length - this.cap))
      : Buffer.concat([this.bytes.subarray(Math.max(0, this.bytes.length + chunk.length - this.cap)), chunk]);
  }
  text(): string {
    const text = this.bytes.toString('utf8');
    let excess = Buffer.byteLength(text) - this.cap;
    let start = 0;
    for (const character of text) {
      if (excess <= 0) break;
      excess -= Buffer.byteLength(character);
      start += character.length;
    }
    return text.slice(start);
  }
}

function groupExists(pid: number): boolean {
  try { process.kill(-pid, 0); return true; } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

async function groupAlive(pid: number): Promise<boolean> {
  if (!groupExists(pid)) return false;
  // An orphan can remain a zombie until init reaps it. It cannot run or hold resources.
  return new Promise((resolve, reject) => execFile('ps', ['-A', '-o', 'pgid=,stat='], { timeout: 1000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
    if (error) { reject(new Error(error.message)); return; }
    resolve(stdout.split('\n').some(line => {
      const [pgid, stat] = line.trim().split(/\s+/);
      return Number(pgid) === pid && stat !== undefined && !stat.startsWith('Z');
    }));
  }));
}

async function stopGroup(pid: number, termGraceMs: number, killGraceMs: number): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { timeout: killGraceMs }, error => {
      if (error && 'code' in error && error.code !== 128) reject(new Error(error.message));
      else resolve();
    }));
    return;
  }
  const send = (signal: NodeJS.Signals): void => {
    try { process.kill(-pid, signal); } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
    }
  };
  if (!await groupAlive(pid)) return;
  send('SIGTERM');
  const termDeadline = Date.now() + termGraceMs;
  while (await groupAlive(pid)) {
    if (Date.now() >= termDeadline) break;
    await pause(20);
  }
  if (!await groupAlive(pid)) return;
  send('SIGKILL');
  const killDeadline = Date.now() + killGraceMs;
  while (await groupAlive(pid)) {
    if (Date.now() >= killDeadline) throw new Error('Process group did not exit after SIGKILL');
    await pause(20);
  }
}

function service(command: string, args: readonly string[], options: ProcessOptions): ProcessService {
  for (const [name, value] of Object.entries({ timeoutMs: options.timeoutMs, maxOutputBytes: options.maxOutputBytes ?? 1024 * 1024, termGraceMs: options.termGraceMs ?? 1000, killGraceMs: options.killGraceMs ?? 5000 })) {
    if (!Number.isSafeInteger(value) || value < (name === 'termGraceMs' ? 0 : 1) || value > 2_147_483_647) throw new RangeError(`${name} must be a valid positive timer or byte limit`);
  }
  const stdout = new OutputTail(options.maxOutputBytes ?? 1024 * 1024);
  const stderr = new OutputTail(options.maxOutputBytes ?? 1024 * 1024);
  const snapshot = (exitCode: number | null, signal: NodeJS.Signals | null): ProcessResult => ({ exitCode, signal, stdout: stdout.text(), stderr: stderr.text(), stdoutTruncated: stdout.truncated, stderrTruncated: stderr.truncated });
  if (options.signal?.aborted) {
    const result = Promise.reject<ProcessResult>(new ProcessError('aborted', command, args, snapshot(null, null)));
    void result.catch(() => undefined);
    return { pid: undefined, exit: null, result, stop: async () => { await result.catch(() => undefined); } };
  }
  const child = spawn(command, [...args], {
    cwd: options.cwd, env: options.env, shell: options.shell,
    detached: process.platform !== 'win32',
    stdio: [options.stdin ?? 'ignore', 'pipe', 'pipe'],
  });
  let exit: ProcessService['exit'] = null;
  let failure: ProcessErrorKind | undefined;
  let stopping: Promise<void> | undefined;
  const cleanup = (): Promise<void> => stopping ??= child.pid === undefined ? Promise.resolve()
    : stopGroup(child.pid, options.termGraceMs ?? 1000, options.killGraceMs ?? 5000);
  const requestStop = (kind: 'aborted' | 'timeout'): void => {
    failure ??= kind;
    void cleanup().catch(() => { failure = 'cleanup'; });
  };
  const onAbort = (): void => { requestStop('aborted'); };
  const timer = setTimeout(() => { requestStop('timeout'); }, options.timeoutMs);
  const result = new Promise<ProcessResult>((resolve, reject) => {
    const output = (chunk: Buffer, tail: OutputTail, mirror: NodeJS.WriteStream, observe?: (text: string) => void): void => {
      tail.append(chunk);
      try {
        if (options.output === 'inherit') mirror.write(chunk);
        observe?.(chunk.toString('utf8'));
      } catch {
        failure ??= 'output';
        void cleanup().catch(() => { failure = 'cleanup'; });
      }
    };
    child.stdout.on('data', (chunk: Buffer) => { output(chunk, stdout, process.stdout, options.onStdout); });
    child.stderr.on('data', (chunk: Buffer) => { output(chunk, stderr, process.stderr, options.onStderr); });
    child.once('error', () => { failure ??= 'spawn'; });
    child.once('exit', (code, signal) => { exit = { code, signal }; });
    child.once('close', (code, signal) => {
      exit ??= { code: failure === 'spawn' ? null : code, signal };
      void (async () => {
        try { await cleanup(); } catch { failure = 'cleanup'; }
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        const completed = snapshot(failure === 'spawn' ? null : code, signal);
        if (failure || code !== 0) reject(new ProcessError(failure ?? 'exit', command, args, completed));
        else resolve(completed);
      })();
    });
  });
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  void result.catch(() => undefined);
  return {
    pid: child.pid,
    get exit() { return exit; },
    result,
    async stop() {
      requestStop('aborted');
      await result.catch((error: unknown) => { if (error instanceof ProcessError && error.kind === 'cleanup') throw error; });
    },
  };
}

export const Processes = {
  service,
  run(command: string, args: readonly string[], options: ProcessOptions): Promise<ProcessResult> {
    return service(command, args, options).result;
  },
};
