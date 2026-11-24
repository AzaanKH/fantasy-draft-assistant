import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Best Pick regression gate. The real backtest needs private league data and cannot run in CI, so
 * `pnpm model:backtest` records a gate block in docs/recommendation-backtest.md and a unit test checks that block:
 * the policy source must match the hash the report was generated from, and Best Pick's margin over roster-aware ECR
 * must not fall further than the declared tolerance below the margin recorded for the previous policy.
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Files whose content decides what Best Pick recommends, including its tuning constants. */
export const BEST_PICK_POLICY_SOURCES = ['shared/src/draft/calculations/best-pick-policy.ts'] as const;

/**
 * How far Best Pick's margin over roster-aware ECR may worsen against the previous policy's margin. Margins are
 * measured in the same run as ECR, so a data refresh moves both sides and mostly cancels.
 */
export const BEST_PICK_GATE_TOLERANCE = { vorCaptured: 25, averageRegret: 1 } as const;

export const BEST_PICK_GATE_START = '<!-- best-pick-gate:start -->';
export const BEST_PICK_GATE_END = '<!-- best-pick-gate:end -->';

export interface BestPickMargin {
  readonly starterPoints: number;
  readonly vorCaptured: number;
  readonly averageRegret: number;
  readonly top24PositionHitRate: number;
}

export interface BestPickGateRecord {
  readonly version: 1;
  /** sha256 of the policy sources this report was generated from. */
  readonly policySourceHash: string;
  /** Best Pick minus roster-aware ECR over the scored folds. */
  readonly bestPickVsEcr: BestPickMargin;
  /** The margin of the last different policy; it moves only when the policy hash changes. */
  readonly baseline: {
    readonly policySourceHash: string;
    readonly bestPickVsEcr: BestPickMargin;
  };
  readonly tolerance: typeof BEST_PICK_GATE_TOLERANCE;
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

/**
 * The record for a new report. Regenerating an unchanged policy keeps its baseline, so repeated runs cannot erase a
 * regression; a changed policy is compared with the policy it replaces.
 */
export function buildBestPickGateRecord(
  previous: BestPickGateRecord | undefined,
  policySourceHash: string,
  bestPickVsEcr: BestPickMargin
): BestPickGateRecord {
  const baseline = previous === undefined
    ? { policySourceHash, bestPickVsEcr }
    : previous.policySourceHash === policySourceHash
      ? previous.baseline
      : { policySourceHash: previous.policySourceHash, bestPickVsEcr: previous.bestPickVsEcr };
  return { version: 1, policySourceHash, bestPickVsEcr, baseline, tolerance: BEST_PICK_GATE_TOLERANCE };
}

/** Every reason the committed record fails the gate; empty when it passes. */
export function bestPickGateFailures(record: BestPickGateRecord, currentPolicyHash: string): string[] {
  const failures: string[] = [];
  if (record.policySourceHash !== currentPolicyHash) {
    failures.push(
      'Best Pick policy source changed since docs/recommendation-backtest.md was generated. ' +
      'Run `pnpm model:backtest` with real league data and commit the regenerated report.'
    );
  }
  const { bestPickVsEcr: current, baseline, tolerance } = record;
  const vorFloor = baseline.bestPickVsEcr.vorCaptured - tolerance.vorCaptured;
  if (current.vorCaptured < vorFloor) {
    failures.push(
      `Best Pick VOR margin over ECR fell to ${String(current.vorCaptured)}, ` +
      `below the previous policy's ${String(baseline.bestPickVsEcr.vorCaptured)} minus ${String(tolerance.vorCaptured)}.`
    );
  }
  const regretCeiling = baseline.bestPickVsEcr.averageRegret + tolerance.averageRegret;
  if (current.averageRegret > regretCeiling) {
    failures.push(
      `Best Pick average regret margin over ECR rose to ${String(current.averageRegret)}, ` +
      `above the previous policy's ${String(baseline.bestPickVsEcr.averageRegret)} plus ` +
      `${String(tolerance.averageRegret)}.`
    );
  }
  return failures;
}

export function renderBestPickGateBlock(record: BestPickGateRecord): string {
  return `${BEST_PICK_GATE_START}\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n${BEST_PICK_GATE_END}`;
}

function isMargin(value: unknown): value is BestPickMargin {
  if (typeof value !== 'object' || value === null) return false;
  const margin = value as Record<string, unknown>;
  return ['starterPoints', 'vorCaptured', 'averageRegret', 'top24PositionHitRate']
    .every((key) => typeof margin[key] === 'number' && Number.isFinite(margin[key]));
}

/** Reads the gate record from a generated report, or undefined when the report has none. */
export function parseBestPickGateBlock(markdown: string): BestPickGateRecord | undefined {
  const start = markdown.indexOf(BEST_PICK_GATE_START);
  const end = markdown.indexOf(BEST_PICK_GATE_END);
  if (start < 0 || end < start) return undefined;
  const body = markdown.slice(start + BEST_PICK_GATE_START.length, end)
    .replace(/^\s*```json\s*/, '')
    .replace(/\s*```\s*$/, '');
  const value: unknown = JSON.parse(body);
  if (typeof value !== 'object' || value === null) throw new Error('Best Pick gate block is not an object.');
  const record = value as Record<string, unknown>;
  const baseline = record.baseline as Record<string, unknown> | undefined;
  const tolerance = record.tolerance as Record<string, unknown> | undefined;
  if (
    record.version !== 1 ||
    typeof record.policySourceHash !== 'string' ||
    !isMargin(record.bestPickVsEcr) ||
    typeof baseline?.policySourceHash !== 'string' ||
    !isMargin(baseline.bestPickVsEcr) ||
    typeof tolerance?.vorCaptured !== 'number' ||
    typeof tolerance.averageRegret !== 'number'
  ) {
    throw new Error('Best Pick gate block does not match the version 1 record.');
  }
  return {
    version: 1,
    policySourceHash: record.policySourceHash,
    bestPickVsEcr: record.bestPickVsEcr,
    baseline: { policySourceHash: baseline.policySourceHash, bestPickVsEcr: baseline.bestPickVsEcr },
    // The committed tolerance is ignored: loosening it would need a reviewed source change, not a doc edit.
    tolerance: BEST_PICK_GATE_TOLERANCE,
  };
}
