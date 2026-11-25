import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Best Pick regression gate. The real backtest needs private league data and cannot run in CI, so
 * `pnpm model:backtest` records the measured Best Pick margin over roster-aware ECR in a gate block of
 * docs/recommendation-backtest.md, and a unit test checks that block against a separate accepted-baseline block.
 * Only `pnpm model:backtest:accept-best-pick` moves the baseline; a normal regeneration copies it unchanged, so a
 * failing policy can never become its own baseline.
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Files whose content decides what Best Pick recommends: the recommendation entry point, the policy with its tuning
 * constants, and the selection and scoring modules they import.
 */
export const BEST_PICK_POLICY_SOURCES = [
  'shared/src/draft/calculations/best-pick-policy.ts',
  'shared/src/draft/calculations/recommendations.ts',
  'shared/src/draft/calculations/tiers.ts',
  'shared/src/draft/calculations/scarcity.ts',
  'shared/src/draft/calculations/draft-stage.ts',
  'shared/src/lineup-utility.ts',
] as const;

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
  readonly evaluatedPicks: number;
}

/** One replay of the policy: the candidate in the gate block, or the accepted policy in the baseline block. */
export interface BestPickGateMeasurement {
  readonly version: 2;
  /** sha256 of the policy sources the replay ran. */
  readonly policySourceHash: string;
  /** User picks scored in each outer fold; margins compare only across identical coverage. */
  readonly folds: readonly BestPickFoldCoverage[];
  /** Best Pick minus roster-aware ECR over the scored folds. */
  readonly bestPickVsEcr: BestPickMargin;
}

export function hashBestPickPolicySources(
  read: (path: string) => string = (path) => readFileSync(join(REPO_ROOT, path), 'utf8')
): string {
  const hash = createHash('sha256');
  for (const path of BEST_PICK_POLICY_SOURCES) {
    hash.update(`${path}\n`);
    hash.update(read(path).replace(/\r\n/g, '\n'));
  }
  return `sha256:${hash.digest('hex')}`;
}

/** Per-fold pick counts Best Pick and roster-aware ECR were scored on in one replay. */
export interface BestPickFoldReplay {
  readonly season: number;
  readonly bestPickPicks: number;
  readonly ecrPicks: number;
}

function sameCoverage(a: readonly BestPickFoldCoverage[], b: readonly BestPickFoldCoverage[]): boolean {
  return a.length === b.length &&
    a.every((fold, index) => fold.season === b[index]?.season && fold.evaluatedPicks === b[index]?.evaluatedPicks);
}

function coversGateSeasons(folds: readonly BestPickFoldCoverage[]): boolean {
  return folds.length === BEST_PICK_GATE_SEASONS.length &&
    BEST_PICK_GATE_SEASONS.every((season, index) => folds[index]?.season === season);
}

/** Why a replay cannot be recorded at all: missing folds, or Best Pick and ECR scored on different picks. */
export function bestPickReplayProblems(folds: readonly BestPickFoldReplay[]): string[] {
  const problems: string[] = [];
  const seasons = folds.map((fold) => fold.season);
  if (!coversGateSeasons(folds.map((fold) => ({ season: fold.season, evaluatedPicks: fold.bestPickPicks })))) {
    problems.push(
      `Best Pick replay covered folds ${seasons.join(', ') || 'none'}; the gate needs ` +
      `${BEST_PICK_GATE_SEASONS.join(', ')}.`
    );
  }
  for (const fold of folds) {
    if (fold.bestPickPicks === 0 || fold.bestPickPicks !== fold.ecrPicks) {
      problems.push(
        `Best Pick replay scored ${String(fold.bestPickPicks)} picks in ${String(fold.season)} against ` +
        `${String(fold.ecrPicks)} for roster-aware ECR.`
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
        'Best Pick replay scored different picks per fold than the accepted baseline, so the margins are not ' +
        'comparable. Review the league history change and run `pnpm model:backtest:accept-best-pick`.',
      ],
    };
  }
  return { candidate: replay, baseline: previous.baseline, recorded: true, notes: [] };
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
    failures.push('Best Pick gate block scored different picks per fold than the accepted baseline.');
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
  return `${start}\n\`\`\`json\n${JSON.stringify(measurement, null, 2)}\n\`\`\`\n${end}`;
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
  return Number.isInteger(fold.season) && Number.isInteger(fold.evaluatedPicks);
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
    record.version !== 2 ||
    typeof record.policySourceHash !== 'string' ||
    !Array.isArray(record.folds) ||
    !record.folds.every(isFold) ||
    !isMargin(record.bestPickVsEcr)
  ) {
    throw new Error(`${start} block does not match the version 2 measurement.`);
  }
  return {
    version: 2,
    policySourceHash: record.policySourceHash,
    folds: record.folds.map(({ season, evaluatedPicks }) => ({ season, evaluatedPicks })),
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
