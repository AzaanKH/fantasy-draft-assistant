/**
 * Source-level signals for how a workspace handles effects. Counts are regex
 * approximations over non-test TypeScript, intended for comparing one revision
 * with another rather than as exact syntax analysis.
 */
export const ADOPTION_PATTERNS = {
  effectFunctions: /\bEffect\.fn(?:Untraced)?\(/g,
  effectGenerators: /\bEffect\.gen\(/g,
  taggedErrors: /\bData\.TaggedError\(/g,
  streams: /\bStream\.\w+/g,
  schedules: /\bSchedule\.\w+/g,
  declarativeTimeouts: /\b(?:Effect|Stream)\.timeout(?:OrElse)?\b/g,
  boundedConcurrency: /\bconcurrency:/g,
  runners: /\bEffect\.run(?:Promise|PromiseExit|Sync|SyncExit|Fork)\b/g,
} as const;

/** Patterns that Effect replaces; lower counts mean less hand-written control flow. */
export const PLUMBING_PATTERNS = {
  tryBlocks: /\btry\s*\{/g,
  thrownErrors: /\bthrow\s+(?:new\s+)?\w/g,
  abortSignalPlumbing: /\bAbort(?:Signal|Controller)\b|\.aborted\b|\bthrowIfAborted\(/g,
  manualTimers: /\b(?:setTimeout|clearTimeout|setInterval|clearInterval)\(/g,
  swallowedErrors: /\.catch\(\(\)\s*=>|\bcatch\s*\{/g,
  errnoCasts: /as NodeJS\.ErrnoException/g,
  promiseCombinators: /\bPromise\.(?:all|allSettled|race|any)\(/g,
} as const;

export type AdoptionMetric = keyof typeof ADOPTION_PATTERNS;
export type PlumbingMetric = keyof typeof PLUMBING_PATTERNS;

export interface SourceMetrics {
  readonly files: number;
  readonly filesUsingEffect: number;
  readonly lines: number;
  readonly adoption: Record<AdoptionMetric, number>;
  readonly plumbing: Record<PlumbingMetric, number>;
}

const count = (source: string, pattern: RegExp) => source.match(pattern)?.length ?? 0;
const tally = <K extends string>(patterns: Record<K, RegExp>, source: string) =>
  Object.fromEntries(Object.entries<RegExp>(patterns).map(([key, pattern]) => [key, count(source, pattern)])) as Record<K, number>;

/** Strip comments so documentation that mentions a pattern is not counted as code. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

export function measureSource(source: string): SourceMetrics {
  const code = stripComments(source);
  return {
    files: 1,
    filesUsingEffect: /from ['"]effect(?:\/[\w-]+)?['"]/.test(code) ? 1 : 0,
    lines: code.split('\n').filter(line => line.trim() !== '').length,
    adoption: tally(ADOPTION_PATTERNS, code),
    plumbing: tally(PLUMBING_PATTERNS, code),
  };
}

export function combineMetrics(metrics: readonly SourceMetrics[]): SourceMetrics {
  const sum = <K extends string>(pick: (metric: SourceMetrics) => Record<K, number>, keys: readonly K[]) =>
    Object.fromEntries(keys.map(key => [key, metrics.reduce((total, metric) => total + pick(metric)[key], 0)])) as Record<K, number>;
  return {
    files: metrics.reduce((total, metric) => total + metric.files, 0),
    filesUsingEffect: metrics.reduce((total, metric) => total + metric.filesUsingEffect, 0),
    lines: metrics.reduce((total, metric) => total + metric.lines, 0),
    adoption: sum(metric => metric.adoption, Object.keys(ADOPTION_PATTERNS) as AdoptionMetric[]),
    plumbing: sum(metric => metric.plumbing, Object.keys(PLUMBING_PATTERNS) as PlumbingMetric[]),
  };
}
