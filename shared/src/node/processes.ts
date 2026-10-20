import { execFile, spawn } from 'node:child_process';

export interface ProcessOptions {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly shell?: boolean;
  readonly output?: 'capture' | 'tee' | 'inherit' | 'ignore';
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

interface ProcessRow {
  readonly pid: number;
  readonly parent: number;
  readonly group: number;
  readonly status: string;
}

async function processRows(): Promise<readonly ProcessRow[]> {
  return new Promise((resolve, reject) => execFile('ps', ['-A', '-o', 'pid=,ppid=,pgid=,stat='], { timeout: 1000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
    if (error) { reject(new Error(error.message)); return; }
    resolve(stdout.split('\n').flatMap(line => {
      const [pid, parent, group, status] = line.trim().split(/\s+/);
      return pid && parent && group && status ? [{ pid: Number(pid), parent: Number(parent), group: Number(group), status }] : [];
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
  if (!groupExists(pid)) return;
  const groups = new Set([pid]);
  const sent = new Map<number, NodeJS.Signals>();
  const signalOwned = async (signal: NodeJS.Signals): Promise<boolean> => {
    const rows = await processRows();
    const owned = new Set(rows.filter(row => groups.has(row.group)).map(row => row.pid));
    let added = true;
    while (added) {
      added = false;
      for (const row of rows) {
        if (owned.has(row.parent) && !owned.has(row.pid)) { owned.add(row.pid); added = true; }
      }
    }
    for (const row of rows) if (owned.has(row.pid) && row.pid === row.group) groups.add(row.group);
    const live = new Set(rows.filter(row => groups.has(row.group) && !row.status.startsWith('Z')).map(row => row.group));
    for (const group of groups) {
      if (!live.has(group)) { groups.delete(group); sent.delete(group); continue; }
      if (sent.get(group) === signal) continue;
      try { process.kill(-group, signal); } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
      }
      sent.set(group, signal);
    }
    return live.size > 0;
  };
  for (const [signal, grace] of [['SIGTERM', termGraceMs], ['SIGKILL', killGraceMs]] as const) {
    const deadline = Date.now() + grace;
    while (await signalOwned(signal)) {
      if (Date.now() >= deadline) break;
      await pause(20);
    }
    if (groups.size === 0) return;
  }
  if (await signalOwned('SIGKILL')) throw new Error('Process groups did not exit after SIGKILL');
}

function service(command: string, args: readonly string[], options: ProcessOptions): ProcessService {
  for (const [name, value] of Object.entries({ timeoutMs: options.timeoutMs, maxOutputBytes: options.maxOutputBytes ?? 1024 * 1024, termGraceMs: options.termGraceMs ?? 1000, killGraceMs: options.killGraceMs ?? 5000 })) {
    if (!Number.isSafeInteger(value) || value < (name === 'termGraceMs' ? 0 : 1) || value > 2_147_483_647) throw new RangeError(`${name} must be a valid positive timer or byte limit`);
  }
  if ((options.output === 'inherit' || options.output === 'ignore') && (options.onStdout || options.onStderr)) throw new TypeError('Output observers require capture or tee mode');
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
    stdio: [options.stdin ?? 'ignore', options.output === 'inherit' ? 'inherit' : options.output === 'ignore' ? 'ignore' : 'pipe', options.output === 'inherit' ? 'inherit' : options.output === 'ignore' ? 'ignore' : 'pipe'],
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
        if (options.output === 'tee') mirror.write(chunk);
        observe?.(chunk.toString('utf8'));
      } catch {
        failure ??= 'output';
        void cleanup().catch(() => { failure = 'cleanup'; });
      }
    };
    child.stdout?.on('data', (chunk: Buffer) => { output(chunk, stdout, process.stdout, options.onStdout); });
    child.stderr?.on('data', (chunk: Buffer) => { output(chunk, stderr, process.stderr, options.onStderr); });
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
