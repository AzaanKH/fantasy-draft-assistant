import { CATALOG, catalogPath } from '@fantasy-draft/shared/catalog';
import { fantasyProsProvider } from '@/lib/providers/fantasypros';
import { type FantasyProsSnapshot, type MarketAdpFormat, type MarketAdpSnapshot, type SportsbookSnapshot, isMarketAdpSnapshot, isSportsbookSnapshot } from '@fantasy-draft/shared/catalog';

import { type ContractDataFile, type PlayerIdentityFile, type PredictionsDataFile, type RecommendationPolicyFile, type SleeperDataFile, type TeamEnvDataFile, isContractDataFile, decodePlayerIdentityFile, decodePredictionsDataFile, isRecommendationPolicyFile, decodeSleeperDataFile, isTeamEnvDataFile } from '@fantasy-draft/shared/catalog';

async function fetchCatalogFile(file: Parameters<typeof catalogPath>[0], label: string): Promise<unknown> {
  const response = await fetch(`/${catalogPath(file)}`);
  if (!response.ok) throw new Error(`Failed to load ${label}: ${String(response.status)}`);
  return response.json();
}

function decodeFile<A>(value: unknown, decode: (value: unknown) => A, label: string): A {
  try { return decode(value); }
  catch (error) { throw new Error(`Invalid ${label} data format: ${String(error)}`); }
}

/**
 * Fetch FantasyPros snapshot data
 */
export async function fetchFantasyProsSnapshot(): Promise<FantasyProsSnapshot> {
  return fantasyProsProvider.getSnapshot();
}

/**
 * Fetch Sleeper ADP data
 */
export async function fetchSleeperData(): Promise<SleeperDataFile> {
  const parsed = await fetchCatalogFile(CATALOG.sleeper, 'Sleeper data');
  return decodeFile(parsed, decodeSleeperDataFile, 'Sleeper');
}

/**
 * Fetch team environment data
 */
export async function fetchTeamEnvData(): Promise<TeamEnvDataFile> {
  const parsed = await fetchCatalogFile(CATALOG.environment, 'team environment data');
  if (!isTeamEnvDataFile(parsed)) {
    throw new Error('Invalid team environment data format');
  }
  return parsed;
}

/**
 * Fetch contract year data
 */
export async function fetchContractData(): Promise<ContractDataFile> {
  const parsed = await fetchCatalogFile(CATALOG.contracts, 'contract data');
  if (!isContractDataFile(parsed)) {
    throw new Error('Invalid contract data format');
  }
  return parsed;
}

export async function fetchPredictionData(): Promise<PredictionsDataFile & { readonly warnings: readonly string[] }> {
  const response = await fetch(`/${catalogPath(CATALOG.predictions)}`);
  if (response.status === 404) {
    return { generatedAt: null, modelVersion: 'none', players: [], warnings: [] };
  }
  if (!response.ok) {
    throw new Error(`Failed to load prediction data: ${String(response.status)}`);
  }
  const parsed: unknown = await response.json();
  const warnings: string[] = [];
  const data = decodeFile(parsed, value => decodePredictionsDataFile(value, {
    onWarning: message => { warnings.push(message); },
  }), 'prediction');
  return { ...data, warnings };
}

export async function fetchPlayerIdentityData(): Promise<PlayerIdentityFile> {
  const parsed = await fetchCatalogFile(CATALOG.identities, 'player identity data');
  return decodeFile(parsed, decodePlayerIdentityFile, 'player identity');
}

export async function fetchRecommendationPolicy(): Promise<RecommendationPolicyFile> {
  const parsed = await fetchCatalogFile(CATALOG.policy, 'recommendation policy');
  if (!isRecommendationPolicyFile(parsed)) {
    throw new Error('Invalid recommendation policy format');
  }
  return parsed;
}

export async function fetchSportsbookSnapshot(): Promise<SportsbookSnapshot> {
  const response = await fetch('/api/draft-data/sportsbook');
  if (!response.ok) {
    throw new Error(`Failed to load sportsbook data: ${String(response.status)}`);
  }
  const parsed: unknown = await response.json();
  if (!isSportsbookSnapshot(parsed)) {
    throw new Error('Invalid sportsbook data format');
  }
  return parsed;
}

export function getMarketAdpFormat(receptions: number): MarketAdpFormat {
  if (receptions >= 0.75) return 'ppr';
  if (receptions >= 0.25) return 'half-ppr';
  return 'standard';
}

export async function fetchMarketAdp(
  format: MarketAdpFormat,
  teams: number,
  season: number
): Promise<MarketAdpSnapshot> {
  const params = new URLSearchParams({
    format,
    teams: String(teams),
    season: String(season),
  });
  const response = await fetch(`/api/market-adp?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to load Fantasy Football Calculator ADP: ${String(response.status)}`);
  }
  const parsed: unknown = await response.json();
  if (!isMarketAdpSnapshot(parsed)) {
    throw new Error('Invalid Fantasy Football Calculator ADP format');
  }
  return parsed;
}

