/**
 * FantasyPros ECR Rankings Scraper
 *
 * Scrapes the FantasyPros PPR rankings page and outputs
 * structured player data for the draft assistant.
 *
 * Usage: pnpm scrape:ecr
 */

import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ECRPlayer,
  type NFLTeam,
  type Position,
  POSITIONS,
  NFL_TEAMS,
  BYE_WEEKS_2025,
  parsePlayerNameAndTeam,
  parsePositionString,
} from '@fantasy-draft/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');
const OUTPUT_FILE = join(DATA_DIR, 'ecr-rankings.json');

const ECR_URL = 'https://www.fantasypros.com/nfl/rankings/ppr-cheatsheets.php';

interface RawRowData {
  rank: string;
  playerCell: string;
  positionCell: string;
  best: string;
  worst: string;
  avg: string;
}

/**
 * Validates that a string is a valid Position
 */
function isValidPosition(value: string): value is Position {
  return POSITIONS.includes(value as Position);
}

/**
 * Normalize team abbreviation from FantasyPros to standard format
 */
function normalizeTeam(team: string): string {
  const teamMap: Record<string, string> = {
    JAC: 'JAX', // Jacksonville uses JAC on FantasyPros, JAX in our system
  };
  return teamMap[team] ?? team;
}

/**
 * Normalize position from FantasyPros to standard format
 */
function normalizePosition(position: string): string {
  const posMap: Record<string, string> = {
    DST: 'DEF', // Defense/Special Teams
  };
  return posMap[position] ?? position;
}

/**
 * Validates that a string is a valid NFLTeam
 */
function isValidTeam(value: string): value is NFLTeam {
  return NFL_TEAMS.includes(value as NFLTeam);
}

/**
 * Scrape raw data from FantasyPros ECR table
 */
async function scrapeRawData(): Promise<RawRowData[]> {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    console.log(`Navigating to ${ECR_URL}...`);
    await page.goto(ECR_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait for table to be visible
    console.log('Waiting for rankings table...');
    await page.waitForSelector('table.player-table tbody tr', { timeout: 30000 });

    // Wait a bit for JavaScript to render all rows
    console.log('Waiting for full table render...');
    await page.waitForTimeout(2000);

    // Scroll to bottom to trigger any lazy loading
    console.log('Scrolling to load all content...');
    await page.evaluate(() => {
      const table = document.querySelector('table.player-table');
      if (table) {
        table.scrollIntoView({ behavior: 'instant', block: 'end' });
      }
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(1000);

    // Scroll back up and wait for any additional renders
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    console.log('Extracting player data...');
    const rawData = await page.evaluate(() => {
      const rows = document.querySelectorAll('table.player-table tbody tr');
      const data: RawRowData[] = [];

      rows.forEach((row) => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 7) return;

        const firstCell = cells[0]?.textContent?.trim() ?? '';
        // Skip tier header rows
        if (firstCell.startsWith('Tier')) return;

        data.push({
          rank: firstCell,
          playerCell: cells[2]?.textContent?.trim() ?? '',
          positionCell: cells[3]?.textContent?.trim() ?? '',
          best: cells[4]?.textContent?.trim() ?? '',
          worst: cells[5]?.textContent?.trim() ?? '',
          avg: cells[6]?.textContent?.trim() ?? '',
        });
      });

      return data;
    });

    console.log(`Found ${rawData.length} players`);
    return rawData;
  } finally {
    await browser.close();
  }
}

/**
 * Parse and validate raw data into ECRPlayer objects
 */
function parseECRData(rawData: RawRowData[]): ECRPlayer[] {
  const players: ECRPlayer[] = [];
  const errors: string[] = [];

  for (const row of rawData) {
    // Parse rank
    const rank = parseInt(row.rank, 10);
    if (isNaN(rank)) {
      errors.push(`Invalid rank: ${row.rank}`);
      continue;
    }

    // Parse player name and team
    const nameTeam = parsePlayerNameAndTeam(row.playerCell);
    if (!nameTeam) {
      errors.push(`Could not parse player cell: ${row.playerCell}`);
      continue;
    }

    // Normalize and validate team
    const normalizedTeam = normalizeTeam(nameTeam.team);
    if (!isValidTeam(normalizedTeam)) {
      errors.push(`Invalid team: ${nameTeam.team} for ${nameTeam.name}`);
      continue;
    }

    // Parse position
    const positionData = parsePositionString(row.positionCell);
    if (!positionData) {
      errors.push(`Could not parse position: ${row.positionCell}`);
      continue;
    }

    // Normalize and validate position
    const normalizedPosition = normalizePosition(positionData.position);
    if (!isValidPosition(normalizedPosition)) {
      errors.push(`Invalid position: ${positionData.position}`);
      continue;
    }

    // Parse numeric fields
    const best = parseInt(row.best, 10);
    const worst = parseInt(row.worst, 10);
    const avg = parseFloat(row.avg);

    if (isNaN(best) || isNaN(worst) || isNaN(avg)) {
      errors.push(`Invalid numeric data for ${nameTeam.name}: best=${row.best}, worst=${row.worst}, avg=${row.avg}`);
      continue;
    }

    // Get bye week using normalized team
    const byeWeek = BYE_WEEKS_2025[normalizedTeam as NFLTeam];

    players.push({
      rank,
      name: nameTeam.name,
      position: normalizedPosition as Position,
      team: normalizedTeam as NFLTeam,
      byeWeek,
      positionalRank: positionData.positionalRank,
      bestRank: best,
      worstRank: worst,
      avgRank: avg,
    });
  }

  if (errors.length > 0) {
    console.warn(`\nParsing warnings (${errors.length}):`);
    errors.slice(0, 10).forEach((e) => console.warn(`  - ${e}`));
    if (errors.length > 10) {
      console.warn(`  ... and ${errors.length - 10} more`);
    }
  }

  return players;
}

/**
 * Main scraper function
 */
async function main(): Promise<void> {
  console.log('='.repeat(50));
  console.log('FantasyPros ECR Rankings Scraper');
  console.log('='.repeat(50));

  try {
    // Scrape raw data
    const rawData = await scrapeRawData();

    if (rawData.length === 0) {
      throw new Error('No data scraped from FantasyPros');
    }

    // Parse and validate
    const players = parseECRData(rawData);
    console.log(`\nSuccessfully parsed ${players.length} players`);

    // Ensure data directory exists
    await mkdir(DATA_DIR, { recursive: true });

    // Write output
    const output = {
      scrapedAt: new Date().toISOString(),
      source: ECR_URL,
      playerCount: players.length,
      players,
    };

    await writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`\nData written to ${OUTPUT_FILE}`);

    // Summary stats
    const positionCounts = players.reduce(
      (acc, p) => {
        acc[p.position] = (acc[p.position] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    console.log('\nPosition breakdown:');
    const entries = Object.entries(positionCounts) as Array<[string, number]>;
    entries.sort((a, b) => b[1] - a[1]);
    for (const entry of entries) {
      console.log(`  ${entry[0]}: ${entry[1]}`);
    }
  } catch (error) {
    console.error('Scraping failed:', error);
    process.exit(1);
  }
}

main();
