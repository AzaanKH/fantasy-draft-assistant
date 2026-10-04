import ts from 'typescript';

/**
 * Source-level signals for how a workspace handles effects. The TypeScript
 * parser blanks comments, strings, templates, and regex literals first, so
 * only code is counted. The patterns are still regular expressions over that
 * code, intended for comparing one revision with another rather than as exact
 * syntax analysis.
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

const isLiteral = (node: ts.Node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ||
  ts.isRegularExpressionLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);

/**
 * Parse the source, then replace literal text with underscores (keeping line
 * breaks, so line counts hold) and drop comments. A pattern spelled inside a
 * string, template, regex, or comment is then not counted as code.
 */
export function codeOnly(source: string, fileName = 'source.ts'): { readonly code: string; readonly importsEffect: boolean } {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  // Node positions are UTF-16 offsets, so collect ranges and rebuild with slice.
  const literals: (readonly [number, number])[] = [];
  let importsEffect = false;
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) && /^effect(?:\/|$)/.test(node.moduleSpecifier.text)) {
      importsEffect = true;
    }
    if (isLiteral(node)) {
      literals.push([node.getStart(file), node.end]);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  let blanked = '';
  let cursor = 0;
  for (const [start, end] of literals) {
    blanked += source.slice(cursor, start) + source.slice(start, end).replace(/[^\n]/g, '_');
    cursor = end;
  }
  blanked += source.slice(cursor);
  // Literals are blank now, so comment markers inside strings or URLs cannot confuse this.
  const code = blanked.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return { code, importsEffect };
}

export function measureSource(source: string, fileName?: string): SourceMetrics {
  const { code, importsEffect } = codeOnly(source, fileName);
  return {
    files: 1,
    filesUsingEffect: importsEffect ? 1 : 0,
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
