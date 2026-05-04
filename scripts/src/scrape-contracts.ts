/**
 * Spotrac Contract Year Scraper
 *
 * Scrapes Spotrac for players in contract years (final year of deal).
 * This data is used to identify motivated players who may outperform.
 *
 * Usage: pnpm scrape:contracts
 */

import { chromium, type Page } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ContractPlayer,
  type NFLTeam,
  type Position,
  POSITIONS,
  NFL_TEAMS,
} from '@fantasy-draft/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');
const OUTPUT_FILE = join(DATA_DIR, 'contracts.json');

// Spotrac free agent pages by position
const SPOTRAC_URLS: Record<string, string> = {
  QB: 'https://www.spotrac.com/nfl/free-agents/_/year/2026/position/quarterback',
  RB: 'https://www.spotrac.com/nfl/free-agents/_/year/2026/position/running-back',
  WR: 'https://www.spotrac.com/nfl/free-agents/_/year/2026/position/wide-receiver',
  TE: 'https://www.spotrac.com/nfl/free-agents/_/year/2026/position/tight-end',
};

// Contract end year for players becoming free agents
const CONTRACT_END_YEAR = 2026;

interface RawContractData {
  name: string;
  team: string;
  position: string;
}

/**
 * Validates that a string is a valid Position
 */
function isValidPosition(value: string): value is Position {
  return POSITIONS.includes(value as Position);
}

/**
 * Validates that a string is a valid NFLTeam
 */
function isValidTeam(value: string): value is NFLTeam {
  return NFL_TEAMS.includes(value as NFLTeam);
}

/**
 * Normalize team abbreviation from Spotrac to standard format
 */
function normalizeTeam(team: string): string {
  const teamMap: Record<string, string> = {
    // Spotrac sometimes uses different abbreviations
    JAC: 'JAX',
    LVR: 'LV',
    LAR: 'LAR',
    SFO: 'SF',
    TBB: 'TB',
    NOR: 'NO',
    GNB: 'GB',
    KAN: 'KC',
    NEP: 'NE',
    NYJ: 'NYJ',
    NYG: 'NYG',
  };
  return teamMap[team] ?? team;
}

/**
 * Scrape contract data from a single Spotrac page
 */
async function scrapePositionPage(
  page: Page,
  url: string,
  position: Position
): Promise<RawContractData[]> {
  console.log(`  Scraping ${position}...`);

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for table
    await page.waitForSelector('table', { timeout: 10000 });

    const rawData = await page.evaluate((pos: string) => {
      const data: RawContractData[] = [];
      const rows = document.querySelectorAll('table tbody tr');

      rows.forEach((row) => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 2) return;

        // Find player name - usually in first cell with a link
        const nameLink = cells[0]?.querySelector('a');
        const name = nameLink?.textContent?.trim() ?? cells[0]?.textContent?.trim() ?? '';

        // Find team - usually has team abbreviation
        const teamCell = cells[1]?.textContent?.trim() ?? '';

        if (name && teamCell) {
          data.push({
            name,
            team: teamCell,
            position: pos,
          });
        }
      });

      return data;
    }, position);

    console.log(`    Found ${rawData.length} players`);
    return rawData;
  } catch (error) {
    console.warn(`    Warning: Could not scrape ${position}: ${error}`);
    return [];
  }
}

/**
 * Parse and validate raw data into ContractPlayer objects
 */
function parseContractData(rawData: RawContractData[]): ContractPlayer[] {
  const players: ContractPlayer[] = [];
  const errors: string[] = [];

  for (const row of rawData) {
    // Validate position
    if (!isValidPosition(row.position)) {
      errors.push(`Invalid position: ${row.position}`);
      continue;
    }

    // Normalize and validate team
    const normalizedTeam = normalizeTeam(row.team);
    if (!isValidTeam(normalizedTeam)) {
      errors.push(`Invalid team: ${row.team} (normalized: ${normalizedTeam}) for ${row.name}`);
      continue;
    }

    players.push({
      name: row.name,
      position: row.position as Position,
      team: normalizedTeam as NFLTeam,
      contractEndYear: CONTRACT_END_YEAR,
      isContractYear: true,
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
  console.log('Spotrac Contract Year Scraper');
  console.log('='.repeat(50));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    console.log(`\nScraping ${CONTRACT_END_YEAR} free agents (contract year players)...`);
    const allRawData: RawContractData[] = [];

    // Scrape each position page
    for (const [position, url] of Object.entries(SPOTRAC_URLS)) {
      const positionData = await scrapePositionPage(page, url, position as Position);
      allRawData.push(...positionData);

      // Small delay between requests
      await page.waitForTimeout(1000);
    }

    console.log(`\nTotal raw data: ${allRawData.length} players`);

    // Parse and validate
    const players = parseContractData(allRawData);
    console.log(`Successfully parsed ${players.length} contract year players`);

    // Ensure data directory exists
    await mkdir(DATA_DIR, { recursive: true });

    // Write output
    const output = {
      scrapedAt: new Date().toISOString(),
      contractYear: CONTRACT_END_YEAR,
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
  } finally {
    await browser.close();
  }
}

main();
