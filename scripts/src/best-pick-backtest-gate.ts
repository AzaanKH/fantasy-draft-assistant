import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * The Best Pick regression gate. The real backtest needs private league data and cannot run in CI, so
 * `pnpm model:backtest` records the measured Best Pick margin over roster-aware ECR in a gate block of
 * docs/recommendation-backtest.md, and a unit test checks that block against a separate accepted-baseline block.
 * Only `pnpm model:backtest:accept-best-pick` moves the baseline; a normal regeneration copies it unchanged, so a
 * failing policy can never become its own baseline.
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Where Best Pick's recommendations start: the recommendation entry point and the policy with its tuning constants.
 * The gate hashes these and every module they reach through runtime imports.
 */
export const BEST_PICK_POLICY_ROOTS = [
  'shared/src/draft/calculations/best-pick-policy.ts',
  'shared/src/draft/calculations/recommendations.ts',
] as const;

const POLICY_SOURCE_ROOT = 'shared/src/';

type ReadSource = (path: string) => string;

const readRepoSource: ReadSource = (path) => readFileSync(join(REPO_ROOT, path), 'utf8');

const SHARED_PACKAGE = '@fantasy-draft/shared';
const SHARED_MANIFEST = 'shared/package.json';
const SOURCE_CONDITION = '@fantasy-draft/source';
/** The conditions Node matches under `tsx --conditions=@fantasy-draft/source`; the first one listed in an entry wins. */
const RUNTIME_CONDITIONS = new Set([SOURCE_CONDITION, 'node', 'import', 'module-sync', 'default']);

/** The replay script and the function it scores Best Pick with; the gate checks this entry lands on a hashed root. */
export const BEST_PICK_REPLAY_SCRIPT = 'scripts/src/backtest-recommendations.ts';
const BEST_PICK_REPLAY_EXPORT = 'getRecommendations';

function parseSource(path: string, text: string): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

const COMMONJS_CALLEES = new Set(['require', 'createRequire']);

function isCommonJsLoad(node: ts.CallExpression): boolean {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return COMMONJS_CALLEES.has(callee.text);
  if (!ts.isPropertyAccessExpression(callee)) return false;
  return COMMONJS_CALLEES.has(callee.name.text) ||
    (ts.isIdentifier(callee.expression) && callee.expression.text === 'require');
}

function runtimeImportSpecifiers(path: string, text: string): string[] {
  const source = parseSource(path, text);
  const specifiers: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
      if (ts.isStringLiteral(statement.moduleSpecifier)) specifiers.push(statement.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.moduleSpecifier) {
      if (ts.isStringLiteral(statement.moduleSpecifier)) specifiers.push(statement.moduleSpecifier.text);
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      throw new Error(
        `${path} loads a module with \`${node.getText(source)}\`; the Best Pick gate does not follow CommonJS loads.`
      );
    }
    if (ts.isCallExpression(node) && isCommonJsLoad(node)) {
      throw new Error(
        `${path} calls ${node.expression.getText(source)}(); the Best Pick gate does not follow CommonJS loads.`
      );
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (!argument || !ts.isStringLiteralLike(argument)) {
        throw new Error(
          `${path} has a dynamic import() with a computed specifier (${argument?.getText(source) ?? 'none'}), ` +
            'which the Best Pick gate cannot hash.'
        );
      }
      specifiers.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Resolves `@fantasy-draft/shared/<subpath>` the way Node does under the source condition: the exact subpath entry,
 * then its first key among the runtime conditions. Only the simple shape the repo uses is accepted (an exact subpath
 * whose first runtime condition is `@fantasy-draft/source` with a string target); anything else fails closed.
 */
function resolveSharedSelfImport(from: string, specifier: string, read: ReadSource): string {
  const subpath = specifier === SHARED_PACKAGE ? '.' : `.${specifier.slice(SHARED_PACKAGE.length)}`;
  const fail = (reason: string): never => {
    throw new Error(`${from} imports ${specifier}, which ${reason}`);
  };
  let manifest: unknown;
  try {
    manifest = JSON.parse(read(SHARED_MANIFEST));
  } catch {
    manifest = undefined;
  }
  const exportsField = isRecord(manifest) ? manifest['exports'] : undefined;
  if (!isRecord(exportsField) || !Object.keys(exportsField).every((key) => key.startsWith('.'))) {
    return fail(`the Best Pick gate cannot resolve: ${SHARED_MANIFEST} "exports" is not a subpath map.`);
  }
  const entry = Object.hasOwn(exportsField, subpath) ? exportsField[subpath] : undefined;
  if (entry === undefined) {
    if (Object.keys(exportsField).some((key) => key.includes('*'))) {
      return fail(`${SHARED_MANIFEST} may match through a wildcard subpath, which the Best Pick gate does not support.`);
    }
    return fail(`${SHARED_MANIFEST} does not export from source.`);
  }
  if (!isRecord(entry)) {
    return fail(`the Best Pick gate cannot resolve: ${SHARED_MANIFEST} exports "${subpath}" is not a condition map.`);
  }
  const condition = Object.keys(entry).find((key) => RUNTIME_CONDITIONS.has(key));
  if (condition !== SOURCE_CONDITION) {
    return fail(`${SHARED_MANIFEST} does not export from source: Node selects "${condition ?? 'nothing'}" first.`);
  }
  const target = entry[condition];
  if (typeof target !== 'string') {
    return fail(`the Best Pick gate cannot resolve: the "${SOURCE_CONDITION}" target is not a plain path.`);
  }
  const resolved = posix.normalize(posix.join('shared', target));
  if (resolved.startsWith(POLICY_SOURCE_ROOT)) {
    try {
      read(resolved);
      return resolved;
    } catch {
      // Fall through to the unresolvable error.
    }
  }
  return fail('the Best Pick gate cannot resolve within shared/src.');
}

function resolvePolicyImport(from: string, specifier: string, read: ReadSource): string {
  if (specifier.startsWith('#') || specifier.startsWith('/') || specifier.startsWith('file:')) {
    throw new Error(`${from} imports ${specifier}; the Best Pick gate does not follow package imports or absolute paths.`);
  }
  if (!specifier.startsWith('.')) {
    if (specifier === SHARED_PACKAGE || specifier.startsWith(`${SHARED_PACKAGE}/`)) {
      return resolveSharedSelfImport(from, specifier, read);
    }
    if (specifier.startsWith('@fantasy-draft/')) {
      throw new Error(`${from} imports ${specifier}; the Best Pick gate only follows imports into shared/src.`);
    }
    // A third-party package is versioned by the lockfile, not by the gate.
    return '';
  }
  const target = posix.normalize(posix.join(posix.dirname(from), specifier));
  const candidates = target.endsWith('.js')
    ? [target.replace(/\.js$/, '.ts'), target.replace(/\.js$/, '.tsx')]
    : [target, `${target}.ts`, `${target}/index.ts`];
  for (const candidate of candidates) {
    if (!candidate.startsWith(POLICY_SOURCE_ROOT)) break;
    try {
      read(candidate);
      return candidate;
    } catch {
      // Try the next extension.
    }
  }
  throw new Error(`${from} imports ${specifier}, which the Best Pick gate cannot resolve within shared/src.`);
}

/**
 * Every shared/src file whose content decides what Best Pick recommends: the roots and their runtime import graph.
 * The walk follows static imports, re-exports and string-literal dynamic `import()` calls, resolving relative
 * specifiers and `@fantasy-draft/shared/<subpath>` self-imports to shared/src. Type-only imports are skipped because
 * they emit no code. Anything the walk cannot follow throws, so a new dependency can never fall outside the digest
 * silently: an unresolvable import, a computed dynamic `import()`, a CommonJS load (`require`, `createRequire`,
 * `import x = require()`), a `#` package import, or an export-map entry other than a plain source-condition path.
 */
export function bestPickPolicySources(read: ReadSource = readRepoSource): string[] {
  const seen = new Set<string>();
  const pending: string[] = [...BEST_PICK_POLICY_ROOTS];
  while (pending.length > 0) {
    const path = pending.pop() as string;
    if (seen.has(path)) continue;
    seen.add(path);
    for (const specifier of runtimeImportSpecifiers(path, read(path))) {
      const resolved = resolvePolicyImport(path, specifier, read);
      if (resolved && !seen.has(resolved)) pending.push(resolved);
    }
  }
  return [...seen].sort();
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
}

/** Whether `file` declares `name` itself with `export function|class|const name`. */
function declaresExport(source: ts.SourceFile, name: string): boolean {
  return source.statements.some((statement) => {
    if (!hasExportModifier(statement)) return false;
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) return statement.name?.text === name;
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.some((declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === name);
    }
    return false;
  });
}

/** The `export { local as name } from '...'` that re-exports `name`, if any. */
function reExportOf(source: ts.SourceFile, name: string): { specifier: string; local: string } | undefined {
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly || !statement.moduleSpecifier) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier) || !statement.exportClause) continue;
    if (!ts.isNamedExports(statement.exportClause)) continue;
    const element = statement.exportClause.elements.find((candidate) => candidate.name.text === name);
    if (element && !element.isTypeOnly) {
      return { specifier: statement.moduleSpecifier.text, local: element.propertyName?.text ?? name };
    }
  }
  return undefined;
}

/**
 * The files the replay's `getRecommendations` import passes through, from the package entry it names to the file that
 * declares the function. The replay reaches the policy through shared's export map and barrel re-exports rather than
 * through the hashed roots directly, so this throws unless that chain ends in a hashed root. Barrel files on the
 * chain are checked rather than hashed: they re-export the whole package, and hashing them would put unrelated code in
 * the digest. Only `export function|class|const` declarations and named `export { ... } from` re-exports are
 * followed; anything else (`export *`, local re-export lists, default exports) fails closed.
 */
export function bestPickReplayEntryChain(read: ReadSource = readRepoSource): string[] {
  const script = parseSource(BEST_PICK_REPLAY_SCRIPT, read(BEST_PICK_REPLAY_SCRIPT));
  const specifiers = script.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
    const clause = statement.importClause;
    if (!clause || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return [];
    const bindings = clause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return [];
    const imported = bindings.elements.some((element) =>
      !element.isTypeOnly && (element.propertyName ?? element.name).text === BEST_PICK_REPLAY_EXPORT);
    return imported ? [statement.moduleSpecifier.text] : [];
  });
  const [specifier] = specifiers;
  if (specifier === undefined || specifiers.length > 1) {
    throw new Error(
      `${BEST_PICK_REPLAY_SCRIPT} must import ${BEST_PICK_REPLAY_EXPORT} by name exactly once for the Best Pick gate ` +
        `to trace it; found ${String(specifiers.length)} imports.`
    );
  }
  if (specifier !== SHARED_PACKAGE && !specifier.startsWith(`${SHARED_PACKAGE}/`)) {
    throw new Error(
      `${BEST_PICK_REPLAY_SCRIPT} imports ${BEST_PICK_REPLAY_EXPORT} from ${specifier}; the Best Pick gate only ` +
        `traces imports from ${SHARED_PACKAGE}.`
    );
  }
  const chain: string[] = [];
  let file = resolveSharedSelfImport(BEST_PICK_REPLAY_SCRIPT, specifier, read);
  let name: string = BEST_PICK_REPLAY_EXPORT;
  for (;;) {
    if (chain.includes(file)) throw new Error(`${file} re-exports ${name} in a cycle.`);
    chain.push(file);
    const source = parseSource(file, read(file));
    if (declaresExport(source, name)) break;
    const reExport = reExportOf(source, name);
    if (reExport === undefined) {
      throw new Error(
        `${file} exports ${name} in a form the Best Pick gate cannot trace; ` +
          'use `export function` or a named `export { ... } from` re-export.'
      );
    }
    file = resolvePolicyImport(file, reExport.specifier, read);
    name = reExport.local;
  }
  if (!(BEST_PICK_POLICY_ROOTS as readonly string[]).includes(file)) {
    throw new Error(
      `${BEST_PICK_REPLAY_SCRIPT} imports ${BEST_PICK_REPLAY_EXPORT} from ${specifier}, which resolves to ${file}, ` +
        `not a Best Pick policy root (${BEST_PICK_POLICY_ROOTS.join(', ')}). Update BEST_PICK_POLICY_ROOTS.`
    );
  }
  return chain;
}

/** The outer folds a gate measurement must cover; a partial replay is never recorded. */
export const BEST_PICK_GATE_SEASONS = [2022, 2023, 2024, 2025] as const;

/**
 * How far Best Pick's margin over roster-aware ECR may worsen against the accepted baseline. Margins are measured in
 * the same run as ECR, so a data refresh moves both sides and mostly cancels.
 */
export const BEST_PICK_GATE_TOLERANCE = { vorCaptured: 25, averageRegret: 1 } as const;

export const BEST_PICK_GATE_START = '<!-- best-pick-gate:start -->';
export const BEST_PICK_GATE_END = '<!-- best-pick-gate:end -->';
export const BEST_PICK_BASELINE_START = '<!-- best-pick-baseline:start -->';
export const BEST_PICK_BASELINE_END = '<!-- best-pick-baseline:end -->';

export interface BestPickMargin {
  readonly starterPoints: number;
  readonly vorCaptured: number;
  readonly averageRegret: number;
  readonly top24PositionHitRate: number;
}

export interface BestPickFoldCoverage {
  readonly season: number;
  /** Draft pick numbers scored in the fold, ascending. */
  readonly pickNumbers: readonly number[];
}

/** One replay of the policy: the candidate in the gate block, or the accepted policy in the baseline block. */
export interface BestPickGateMeasurement {
  readonly version: 3;
  /** sha256 of the policy sources the replay ran. */
  readonly policySourceHash: string;
  /** The draft picks scored in each outer fold; margins compare only across identical picks. */
  readonly folds: readonly BestPickFoldCoverage[];
  /** Best Pick minus roster-aware ECR over the scored folds. */
  readonly bestPickVsEcr: BestPickMargin;
}

export function hashBestPickPolicySources(read: ReadSource = readRepoSource): string {
  const hash = createHash('sha256');
  for (const path of bestPickPolicySources(read)) {
    hash.update(`${path}\n`);
    hash.update(read(path).replace(/\r\n/g, '\n'));
  }
  return `sha256:${hash.digest('hex')}`;
}

/**
 * Fails when the policy sources changed between the start of a replay and the report write, so a recorded
 * `policySourceHash` always describes the code that actually ran.
 */
export function assertBestPickPolicyUnchanged(hashAtStart: string, hashAtWrite: string): void {
  if (hashAtStart !== hashAtWrite) {
    throw new Error(
      `Best Pick policy sources changed during the replay (${hashAtStart} at start, ${hashAtWrite} before writing); ` +
        'rerun the backtest on a stable checkout. No report was written.'
    );
  }
}

/** Per-fold draft pick numbers Best Pick and roster-aware ECR were scored on in one replay. */
export interface BestPickFoldReplay {
  readonly season: number;
  readonly bestPickPicks: readonly number[];
  readonly ecrPicks: readonly number[];
}

function samePicks(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((pickNo, index) => pickNo === b[index]);
}

function sameCoverage(a: readonly BestPickFoldCoverage[], b: readonly BestPickFoldCoverage[]): boolean {
  return a.length === b.length &&
    a.every((fold, index) => {
      const other = b[index];
      return other !== undefined && fold.season === other.season && samePicks(fold.pickNumbers, other.pickNumbers);
    });
}

function coversGateSeasons(folds: readonly BestPickFoldCoverage[]): boolean {
  return folds.length === BEST_PICK_GATE_SEASONS.length &&
    BEST_PICK_GATE_SEASONS.every((season, index) => folds[index]?.season === season);
}

/** Why a replay cannot be recorded at all: missing folds, or Best Pick and ECR scored on different picks. */
export function bestPickReplayProblems(folds: readonly BestPickFoldReplay[]): string[] {
  const problems: string[] = [];
  const seasons = folds.map((fold) => fold.season);
  if (!coversGateSeasons(folds.map((fold) => ({ season: fold.season, pickNumbers: fold.bestPickPicks })))) {
    problems.push(
      `Best Pick replay covered folds ${seasons.join(', ') || 'none'}; the gate needs ` +
      `${BEST_PICK_GATE_SEASONS.join(', ')}.`
    );
  }
  for (const fold of folds) {
    if (fold.bestPickPicks.length === 0 || !samePicks(fold.bestPickPicks, fold.ecrPicks)) {
      problems.push(
        `Best Pick replay scored picks ${fold.bestPickPicks.join(', ') || 'none'} in ${String(fold.season)} against ` +
        `${fold.ecrPicks.join(', ') || 'none'} for roster-aware ECR.`
      );
    }
  }
  return problems;
}

export interface BestPickGateBlocks {
  readonly candidate: BestPickGateMeasurement | undefined;
  readonly baseline: BestPickGateMeasurement | undefined;
}

export interface NextBestPickGate extends BestPickGateBlocks {
  /** False when the replay was kept out of the report and the previous blocks were carried forward. */
  readonly recorded: boolean;
  readonly notes: readonly string[];
}

/**
 * The gate blocks for a regenerated report. The candidate is replaced only by a complete replay whose coverage
 * matches the accepted baseline; the baseline moves only when `accept` is set, and then only to a complete replay.
 */
export function nextBestPickGate(
  previous: BestPickGateBlocks,
  replay: BestPickGateMeasurement,
  replayProblems: readonly string[],
  accept: boolean
): NextBestPickGate {
  if (replayProblems.length > 0) {
    if (accept) throw new Error(`Cannot accept a partial Best Pick replay: ${replayProblems.join(' ')}`);
    return { ...previous, recorded: false, notes: replayProblems };
  }
  if (accept) return { candidate: replay, baseline: replay, recorded: true, notes: [] };
  if (previous.baseline !== undefined && !sameCoverage(replay.folds, previous.baseline.folds)) {
    return {
      ...previous,
      recorded: false,
      notes: [
        'Best Pick replay scored different draft picks per fold than the accepted baseline, so the margins are not ' +
        'comparable. Review the league history change and run `pnpm model:backtest:accept-best-pick`.',
      ],
    };
  }
  return { candidate: replay, baseline: previous.baseline, recorded: true, notes: [] };
}

/**
 * Stops a regeneration whose replay cannot be recorded, before any report is written. Writing would print a failing
 * gate beside the previous, still-passing blocks, and CI checks only the blocks.
 */
export function assertBestPickGateRecorded(gate: NextBestPickGate): void {
  if (!gate.recorded) {
    throw new Error(`Best Pick replay cannot be recorded; no report was written. ${gate.notes.join(' ')}`);
  }
}

/** Every reason the committed blocks fail the gate; empty when they pass. */
export function bestPickGateFailures(blocks: BestPickGateBlocks, currentPolicyHash: string): string[] {
  const { candidate, baseline } = blocks;
  if (candidate === undefined) {
    return ['docs/recommendation-backtest.md has no Best Pick gate block. Run `pnpm model:backtest` with real data.'];
  }
  const failures: string[] = [];
  if (baseline === undefined) {
    failures.push(
      'docs/recommendation-backtest.md has no accepted Best Pick baseline block. ' +
      'Run `pnpm model:backtest:accept-best-pick` and commit the reviewed baseline.'
    );
  }
  if (candidate.policySourceHash !== currentPolicyHash) {
    failures.push(
      'Best Pick policy source changed since docs/recommendation-backtest.md was generated. ' +
      'Run `pnpm model:backtest` with real league data and commit the regenerated report.'
    );
  }
  if (!coversGateSeasons(candidate.folds)) {
    failures.push(`Best Pick gate block does not cover folds ${BEST_PICK_GATE_SEASONS.join(', ')}.`);
  }
  if (baseline === undefined) return failures;
  if (!sameCoverage(candidate.folds, baseline.folds)) {
    failures.push('Best Pick gate block scored different draft picks per fold than the accepted baseline.');
  }
  const current = candidate.bestPickVsEcr;
  const tolerance = BEST_PICK_GATE_TOLERANCE;
  const vorFloor = baseline.bestPickVsEcr.vorCaptured - tolerance.vorCaptured;
  if (current.vorCaptured < vorFloor) {
    failures.push(
      `Best Pick VOR margin over ECR fell to ${String(current.vorCaptured)}, ` +
      `below the accepted baseline's ${String(baseline.bestPickVsEcr.vorCaptured)} minus ` +
      `${String(tolerance.vorCaptured)}.`
    );
  }
  const regretCeiling = baseline.bestPickVsEcr.averageRegret + tolerance.averageRegret;
  if (current.averageRegret > regretCeiling) {
    failures.push(
      `Best Pick average regret margin over ECR rose to ${String(current.averageRegret)}, ` +
      `above the accepted baseline's ${String(baseline.bestPickVsEcr.averageRegret)} plus ` +
      `${String(tolerance.averageRegret)}.`
    );
  }
  return failures;
}

function renderBlock(start: string, end: string, measurement: BestPickGateMeasurement): string {
  const json = JSON.stringify(measurement, null, 2)
    .replace(/\[\s+([\d,\s]+?)\s+\]/g, (_match, numbers: string) => `[${numbers.split(/,\s*/).join(', ')}]`);
  return `${start}\n\`\`\`json\n${json}\n\`\`\`\n${end}`;
}

/** Both blocks for the report; a missing baseline renders nothing, which fails the gate. */
export function renderBestPickGateBlocks(blocks: BestPickGateBlocks): string {
  return [
    blocks.candidate && renderBlock(BEST_PICK_GATE_START, BEST_PICK_GATE_END, blocks.candidate),
    blocks.baseline && renderBlock(BEST_PICK_BASELINE_START, BEST_PICK_BASELINE_END, blocks.baseline),
  ].filter((block) => block !== undefined).join('\n\n');
}

function isMargin(value: unknown): value is BestPickMargin {
  if (typeof value !== 'object' || value === null) return false;
  const margin = value as Record<string, unknown>;
  return ['starterPoints', 'vorCaptured', 'averageRegret', 'top24PositionHitRate']
    .every((key) => typeof margin[key] === 'number' && Number.isFinite(margin[key]));
}

function isFold(value: unknown): value is BestPickFoldCoverage {
  if (typeof value !== 'object' || value === null) return false;
  const fold = value as Record<string, unknown>;
  return Number.isInteger(fold.season) &&
    Array.isArray(fold.pickNumbers) &&
    fold.pickNumbers.every((pickNo) => Number.isInteger(pickNo));
}

function parseBlock(markdown: string, start: string, end: string): BestPickGateMeasurement | undefined {
  const from = markdown.indexOf(start);
  const to = markdown.indexOf(end);
  if (from < 0 || to < from) return undefined;
  const body = markdown.slice(from + start.length, to)
    .replace(/^\s*```json\s*/, '')
    .replace(/\s*```\s*$/, '');
  const value: unknown = JSON.parse(body);
  if (typeof value !== 'object' || value === null) throw new Error(`${start} block is not an object.`);
  const record = value as Record<string, unknown>;
  if (
    record.version !== 3 ||
    typeof record.policySourceHash !== 'string' ||
    !Array.isArray(record.folds) ||
    !record.folds.every(isFold) ||
    !isMargin(record.bestPickVsEcr)
  ) {
    throw new Error(`${start} block does not match the version 3 measurement.`);
  }
  return {
    version: 3,
    policySourceHash: record.policySourceHash,
    folds: record.folds.map(({ season, pickNumbers }) => ({ season, pickNumbers: [...pickNumbers] })),
    bestPickVsEcr: record.bestPickVsEcr,
  };
}

/** Reads both blocks from a generated report; either is undefined when the report lacks it. */
export function parseBestPickGateBlocks(markdown: string): BestPickGateBlocks {
  return {
    candidate: parseBlock(markdown, BEST_PICK_GATE_START, BEST_PICK_GATE_END),
    baseline: parseBlock(markdown, BEST_PICK_BASELINE_START, BEST_PICK_BASELINE_END),
  };
}
