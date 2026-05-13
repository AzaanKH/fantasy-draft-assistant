import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import type {
  ECRPlayer,
  FantasyProsSnapshot,
} from '@fantasy-draft/shared';
import { fetchFantasyProsSnapshot } from './fantasypros-api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const DATA_DIR = join(REPO_ROOT, 'data');
const INPUT_FILE = join(DATA_DIR, 'ecr-rankings.json');
const OUTPUT_FILE = join(DATA_DIR, 'fantasypros-snapshot.json');

loadEnv({ path: join(REPO_ROOT, '.env.local') });
loadEnv({ path: join(REPO_ROOT, '.env') });

interface EcrDataFile {
  readonly season?: number;
  readonly scrapedAt: string;
  readonly source: string;
  readonly playerCount: number;
  readonly players: readonly ECRPlayer[];
}

async function readEcrFile(): Promise<EcrDataFile> {
  const raw = await readFile(INPUT_FILE, 'utf8');
  return JSON.parse(raw) as EcrDataFile;
}

async function writeSnapshot(snapshot: FantasyProsSnapshot): Promise<void> {
  await mkdir(dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

function buildManualSnapshot(ecrData: EcrDataFile): FantasyProsSnapshot {
  const derivedSeason = ecrData.season ?? new Date(ecrData.scrapedAt).getFullYear();
  const rankingCount = ecrData.players?.length ?? ecrData.playerCount;

  return {
    metadata: {
      season: derivedSeason,
      sourceType: 'manual-refresh',
      source: ecrData.source,
      refreshedAt: ecrData.scrapedAt,
      rankingCount,
      projectionCount: 0,
      newsCount: 0,
    },
    rankings: ecrData.players,
    projections: [],
    news: [],
  };
}

async function main(): Promise<void> {
  const apiKey = process.env['FANTASYPROS_API_KEY']?.trim();
  const snapshotMode = process.env['FANTASYPROS_SNAPSHOT_MODE']?.trim().toLowerCase();
  const preferManual = snapshotMode === 'manual';
  let snapshot: FantasyProsSnapshot;
  let ecrData: EcrDataFile | undefined;

  if (apiKey && !preferManual) {
    try {
      snapshot = await fetchFantasyProsSnapshot({
        apiKey,
        season: new Date().getFullYear(),
        scoring: 'PPR',
      });
      console.log(
        `FantasyPros API snapshot refreshed: ${snapshot.metadata.rankingCount} rankings, ` +
        `${snapshot.metadata.projectionCount} projections, ${snapshot.metadata.newsCount} news`
      );
    } catch (error) {
      console.warn('FantasyPros API refresh failed, falling back to local ECR snapshot.');
      console.warn(error);
      ecrData = await readEcrFile();
      snapshot = buildManualSnapshot(ecrData);
    }
  } else {
    ecrData = await readEcrFile();
    snapshot = buildManualSnapshot(ecrData);
  }

  await writeSnapshot(snapshot);

  console.log(
    `FantasyPros snapshot written to ${OUTPUT_FILE} (${snapshot.metadata.sourceType})`
  );
}

main().catch((error: unknown) => {
  console.error('Failed to refresh FantasyPros snapshot');
  console.error(error);
  process.exitCode = 1;
});
