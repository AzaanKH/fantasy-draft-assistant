import { fixedClock } from '@fantasy-draft/shared/units';
import { currentSeason } from '@fantasy-draft/shared/league';
import { CATALOG, catalogPath } from '@fantasy-draft/shared/catalog';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { Effect, Schema } from 'effect';
import {
  decodeFantasyProsSnapshot,
  type FantasyProsSnapshot,
} from '@fantasy-draft/shared/catalog';
import { fetchFantasyProsSnapshot } from './fantasypros-api.js';
import { io, runMain } from './effect-runtime.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const INPUT_FILE = join(REPO_ROOT, catalogPath(CATALOG.ecr));
const OUTPUT_FILE = join(REPO_ROOT, catalogPath(CATALOG.snapshot));

loadEnv({ path: join(REPO_ROOT, '.env.local') });
loadEnv({ path: join(REPO_ROOT, '.env') });

const ecrSourceFile = Schema.Struct({
  season: Schema.optional(Schema.Finite), scrapedAt: Schema.String, source: Schema.String,
  playerCount: Schema.Finite, players: Schema.Array(Schema.Unknown),
});
const decodeEcrSourceFile = Schema.decodeUnknownSync(ecrSourceFile);

async function readEcrFile(): Promise<FantasyProsSnapshot> {
  const data = decodeEcrSourceFile(JSON.parse(await readFile(INPUT_FILE, 'utf8')));
  return decodeFantasyProsSnapshot({
    metadata: {
      season: data.season ?? currentSeason(fixedClock(Date.parse(data.scrapedAt))),
      sourceType: 'manual-refresh', source: data.source, refreshedAt: data.scrapedAt,
      rankingCount: data.players.length, adpCount: 0, projectionCount: 0, newsCount: 0,
    },
    rankings: data.players, adp: [], projections: [], news: [],
  });
}

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
  const snapshotMode = process.env['FANTASYPROS_SNAPSHOT_MODE']?.trim().toLowerCase();
  const manualSnapshot = io(readEcrFile);
  const existingSnapshot = yield* Effect.promise(() => readExistingSnapshot());

  const snapshot = apiKey && snapshotMode !== 'manual'
    ? yield* fetchFantasyProsSnapshot({
      apiKey,
      season: currentSeason(),
      scoring: 'PPR',
    }).pipe(
      Effect.map((fetched) => preserveUsableProjections(fetched, existingSnapshot)),
      Effect.tap((fetched) => Effect.sync(() => {
        console.log(
          `FantasyPros API snapshot refreshed: ${fetched.metadata.rankingCount} rankings, ` +
          `${fetched.metadata.adpCount} ADP, ${fetched.metadata.projectionCount} projections, ` +
          `${fetched.metadata.newsCount} news`
        );
      })),
      Effect.catch((error) => Effect.sync(() => {
        console.warn('FantasyPros API refresh failed, falling back to local ECR snapshot.');
        console.warn(error.message);
      }).pipe(Effect.andThen(manualSnapshot))),
    )
    : yield* manualSnapshot;

  yield* io(() => writeSnapshot(snapshot));

  console.log(
    `FantasyPros snapshot written to ${OUTPUT_FILE} (${snapshot.metadata.sourceType})`
  );
});

runMain(program, 'Failed to refresh FantasyPros snapshot');
