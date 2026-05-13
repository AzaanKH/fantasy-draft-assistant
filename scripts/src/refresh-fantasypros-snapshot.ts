import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ECRPlayer,
  FantasyProsSnapshot,
} from '@fantasy-draft/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');
const INPUT_FILE = join(DATA_DIR, 'ecr-rankings.json');
const OUTPUT_FILE = join(DATA_DIR, 'fantasypros-snapshot.json');

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

async function main(): Promise<void> {
  const ecrData = await readEcrFile();
  const derivedSeason = ecrData.season ?? new Date(ecrData.scrapedAt).getFullYear();
  const rankingCount = ecrData.players?.length ?? ecrData.playerCount;

  const snapshot: FantasyProsSnapshot = {
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

  await writeSnapshot(snapshot);

  console.log(
    `FantasyPros snapshot refreshed: ${snapshot.metadata.rankingCount} rankings -> ${OUTPUT_FILE}`
  );
}

main().catch((error: unknown) => {
  console.error('Failed to refresh FantasyPros snapshot');
  console.error(error);
  process.exitCode = 1;
});
