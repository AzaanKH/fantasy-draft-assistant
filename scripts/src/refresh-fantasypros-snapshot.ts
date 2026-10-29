import { currentSeason } from '@fantasy-draft/shared/league';
import { CATALOG, catalogPath } from '@fantasy-draft/shared/catalog';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { Effect } from 'effect';
import {
  decodeFantasyProsSnapshot,
  type FantasyProsSnapshot,
} from '@fantasy-draft/shared/catalog';
import { fetchFantasyProsSnapshot } from './fantasypros-api.js';
import { io, runMain } from './effect-runtime.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const OUTPUT_FILE = join(REPO_ROOT, catalogPath(CATALOG.snapshot));

loadEnv({ path: join(REPO_ROOT, '.env.local') });
loadEnv({ path: join(REPO_ROOT, '.env') });

async function writeSnapshot(snapshot: FantasyProsSnapshot): Promise<void> {
  await mkdir(dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

export async function readExistingSnapshot(path = OUTPUT_FILE): Promise<FantasyProsSnapshot | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return decodeFantasyProsSnapshot(parsed);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    console.warn(`Existing FantasyPros snapshot cannot be reused: ${String(error)}`);
    return undefined;
  }
}

function preserveUsableProjections(
  snapshot: FantasyProsSnapshot,
  existing: FantasyProsSnapshot | undefined
): FantasyProsSnapshot {
  if (snapshot.projections.length > 0 || !existing ||
      existing.metadata.season !== snapshot.metadata.season || existing.projections.length < 400) {
    return snapshot;
  }
  console.warn(
    `Preserving ${String(existing.projections.length)} cached projections because the API projection request failed.`
  );
  return {
    ...snapshot,
    metadata: {
      ...snapshot.metadata,
      projectionCount: existing.projections.length,
      projectionRefreshedAt:
        existing.metadata.projectionRefreshedAt ?? existing.metadata.refreshedAt,
      projectionSource: 'preserved-cache',
    },
    projections: existing.projections,
  };
}

const program = Effect.gen(function* () {
  const apiKey = process.env['FANTASYPROS_API_KEY']?.trim();
  if (!apiKey) return yield* Effect.fail(new Error('FANTASYPROS_API_KEY is not set'));
  const existingSnapshot = yield* Effect.promise(() => readExistingSnapshot());

  const snapshot = yield* fetchFantasyProsSnapshot({
    apiKey,
    season: currentSeason(),
    scoring: 'PPR',
  }).pipe(Effect.map((fetched) => preserveUsableProjections(fetched, existingSnapshot)));
  console.log(
    `FantasyPros API snapshot refreshed: ${snapshot.metadata.rankingCount} rankings, ` +
    `${snapshot.metadata.adpCount} ADP, ${snapshot.metadata.projectionCount} projections, ` +
    `${snapshot.metadata.newsCount} news`
  );

  yield* io(() => writeSnapshot(snapshot));

  console.log(
    `FantasyPros snapshot written to ${OUTPUT_FILE} (${snapshot.metadata.sourceType})`
  );
});

runMain(program, 'Failed to refresh FantasyPros snapshot');
