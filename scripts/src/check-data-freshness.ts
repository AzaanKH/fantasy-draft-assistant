import { CATALOG, catalogPath, decodeFantasyProsSnapshot, decodeSportsbookSnapshot, decodeSleeperDataFile, decodePlayerIdentityFile, decodeTeamEnvDataFile, decodeContractDataFile, decodePredictionsDataFile, decodeLeagueSurvivalModel, decodePrimaryLeagueSettingsFile, decodeKeeperFile } from '@fantasy-draft/shared/catalog';
import { isRecommendationEvaluation } from './recommendation-evaluation.js';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const strict = process.argv.includes('--strict');

interface ArtifactRule {
  readonly label: string;
  readonly path: string;
  readonly decode: (value: unknown) => unknown;
  readonly timestampPath: readonly string[];
  readonly maxAgeHours: number | null;
  readonly required: boolean;
  readonly refreshCommand: string;
}

const ARTIFACTS: readonly ArtifactRule[] = [
  {
    label: 'Trusted rankings',
    path: catalogPath(CATALOG.snapshot),
    decode: decodeFantasyProsSnapshot,
    timestampPath: ['metadata', 'refreshedAt'],
    maxAgeHours: 24,
    required: true,
    refreshCommand: 'pnpm refresh:fantasypros',
  },
  {
    label: 'Sportsbook context',
    path: catalogPath(CATALOG.sportsbook),
    decode: value => decodeSportsbookSnapshot(value, { onWarning: console.warn }),
    timestampPath: ['metadata', 'capturedAt'],
    maxAgeHours: 48,
    required: false,
    refreshCommand: 'pnpm import:sportsbook',
  },
  {
    label: 'Sleeper platform proxy',
    path: catalogPath(CATALOG.sleeper),
    decode: value => decodeSleeperDataFile(value, { onWarning: console.warn }),
    timestampPath: ['fetchedAt'],
    maxAgeHours: 24,
    required: false,
    refreshCommand: 'pnpm refresh:sleeper',
  },
  {
    label: 'Canonical player identities',
    path: catalogPath(CATALOG.identities),
    decode: decodePlayerIdentityFile,
    timestampPath: ['generatedAt'],
    maxAgeHours: 24,
    required: true,
    refreshCommand: 'pnpm data:identity',
  },
  {
    label: 'Derived team environment',
    path: catalogPath(CATALOG.environment),
    decode: value => decodeTeamEnvDataFile(value, { onWarning: console.warn }),
    timestampPath: ['generatedAt'],
    maxAgeHours: 24 * 14,
    required: false,
    refreshCommand: 'pnpm refresh:team-env',
  },
  {
    label: 'Contract context',
    path: catalogPath(CATALOG.contracts),
    decode: value => decodeContractDataFile(value, { onWarning: console.warn }),
    timestampPath: ['generatedAt'],
    maxAgeHours: 24 * 7,
    required: false,
    refreshCommand: 'pnpm refresh:contracts',
  },
  {
    label: 'Experimental predictions',
    path: catalogPath(CATALOG.predictions),
    decode: value => decodePredictionsDataFile(value, { onWarning: console.warn }),
    timestampPath: ['generatedAt'],
    maxAgeHours: 24 * 7,
    required: false,
    refreshCommand: 'pnpm prepare:draft',
  },
  {
    label: 'Recommendation evaluation',
    path: catalogPath(CATALOG.evaluation),
    decode: value => {
      if (!isRecommendationEvaluation(value)) throw new Error('Invalid recommendation evaluation evidence');
      return value;
    },
    timestampPath: ['generatedAt'],
    maxAgeHours: 24 * 7,
    required: false,
    refreshCommand: 'pnpm model:backtest',
  },
  {
    label: 'League survival model',
    path: catalogPath(CATALOG.survival),
    decode: value => decodeLeagueSurvivalModel(value, { onWarning: console.warn }),
    timestampPath: ['generatedAt'],
    maxAgeHours: 24 * 30,
    required: false,
    refreshCommand: 'pnpm model:league-survival',
  },
  {
    label: 'Primary League settings',
    path: catalogPath(CATALOG.settings),
    decode: decodePrimaryLeagueSettingsFile,
    timestampPath: ['confirmedAt'],
    maxAgeHours: null,
    required: true,
    refreshCommand: 'Confirm the live provider settings',
  },
  {
    label: 'Confirmed keeper supply',
    path: catalogPath(CATALOG.keepers),
    decode: decodeKeeperFile,
    timestampPath: ['updatedAt'],
    maxAgeHours: null,
    required: true,
    refreshCommand: 'Confirm the complete keeper list',
  },
];

function getNestedValue(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (typeof current !== 'object' || current === null) return undefined;
    return Reflect.get(current, key);
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
      const parsed = artifact.decode(JSON.parse(
        await readFile(join(REPO_ROOT, artifact.path), 'utf8')
      ));
      const timestamp = getNestedValue(parsed, artifact.timestampPath);
      const timestampMs = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN;
      const ageHours = (Date.now() - timestampMs) / (60 * 60 * 1000);
      const stale = !Number.isFinite(ageHours) || (
        artifact.maxAgeHours !== null && ageHours > artifact.maxAgeHours
      );
      const status = stale
        ? 'STALE'
        : artifact.maxAgeHours === null
          ? 'valid'
          : 'fresh';

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
    console.log(`\n${String(staleRequiredArtifacts)} Core Draft Data timestamp(s) need refresh.`);
    if (strict) process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('Data freshness check failed:', error);
  process.exit(1);
});
