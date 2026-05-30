import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const strict = process.argv.includes('--strict');

interface ArtifactRule {
  readonly label: string;
  readonly path: string;
  readonly timestampPath: readonly string[];
  readonly maxAgeHours: number;
  readonly required: boolean;
  readonly refreshCommand: string;
}

const ARTIFACTS: readonly ArtifactRule[] = [
  {
    label: 'FantasyPros snapshot',
    path: 'data/fantasypros-snapshot.json',
    timestampPath: ['metadata', 'refreshedAt'],
    maxAgeHours: 24,
    required: true,
    refreshCommand: 'pnpm refresh:fantasypros',
  },
  {
    label: 'Sleeper platform proxy',
    path: 'data/sleeper-adp.json',
    timestampPath: ['fetchedAt'],
    maxAgeHours: 24,
    required: true,
    refreshCommand: 'pnpm refresh:sleeper',
  },
  {
    label: 'Derived team environment',
    path: 'data/team-environment.json',
    timestampPath: ['generatedAt'],
    maxAgeHours: 24 * 14,
    required: true,
    refreshCommand: 'pnpm refresh:team-env',
  },
  {
    label: 'Prediction artifact',
    path: 'data/predictions.json',
    timestampPath: ['generatedAt'],
    maxAgeHours: 24 * 7,
    required: true,
    refreshCommand: 'pnpm prepare:draft',
  },
  {
    label: 'League survival model',
    path: 'data/league-history/survival-model.json',
    timestampPath: ['generatedAt'],
    maxAgeHours: 24 * 30,
    required: true,
    refreshCommand: 'pnpm model:league-survival',
  },
];

function getNestedValue(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (typeof current !== 'object' || current === null) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function formatAge(hours: number): string {
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

async function main(): Promise<void> {
  let staleRequiredArtifacts = 0;

  for (const artifact of ARTIFACTS) {
    try {
      const parsed = JSON.parse(
        await readFile(join(REPO_ROOT, artifact.path), 'utf8')
      ) as unknown;
      const timestamp = getNestedValue(parsed, artifact.timestampPath);
      const timestampMs = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN;
      const ageHours = (Date.now() - timestampMs) / (60 * 60 * 1000);
      const stale = !Number.isFinite(ageHours) || ageHours > artifact.maxAgeHours;
      const status = stale ? 'STALE' : 'fresh';

      console.log(
        `${status.padEnd(5)} ${artifact.label.padEnd(26)} ${formatAge(ageHours)} ` +
        `(${artifact.refreshCommand})`
      );
      if (stale && artifact.required) staleRequiredArtifacts += 1;
    } catch {
      console.log(`MISS  ${artifact.label.padEnd(26)} (${artifact.refreshCommand})`);
      if (artifact.required) staleRequiredArtifacts += 1;
    }
  }

  if (staleRequiredArtifacts > 0) {
    console.log(`\n${String(staleRequiredArtifacts)} required artifact(s) need refresh.`);
    if (strict) process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('Data freshness check failed:', error);
  process.exit(1);
});
