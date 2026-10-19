import { type DecodeOptions, CATALOG, catalogPath } from '@fantasy-draft/shared/catalog';
import { fantasyProsProvider } from '@/lib/providers/fantasypros';
import { type FantasyProsSnapshot, type MarketAdpFormat, type MarketAdpSnapshot, type SportsbookSnapshot, decodeMarketAdpSnapshot, decodeSportsbookSnapshot } from '@fantasy-draft/shared/catalog';

import { type ContractDataFile, type PlayerIdentityFile, type PredictionsDataFile, type RecommendationPolicyFile, type SleeperDataFile, type TeamEnvDataFile, decodeContractDataFile, decodePlayerIdentityFile, decodePredictionsDataFile, decodeRecommendationPolicyFile, decodeSleeperDataFile, decodeTeamEnvDataFile } from '@fantasy-draft/shared/catalog';

async function fetchCatalogFile(file: Parameters<typeof catalogPath>[0], label: string): Promise<unknown> {
  const response = await fetch(`/${catalogPath(file)}`);
  if (!response.ok) throw new Error(`Failed to load ${label}: ${String(response.status)}`);
  return response.json();
}

function decodeFile<A>(value: unknown, decode: (value: unknown) => A, label: string, formatError = `Invalid ${label} data format`): A {
  try { return decode(value); }
  catch (error) { throw new Error(`${formatError}: ${String(error)}`); }
}

function decodeOptionalFile<A>(value: unknown, decode: (value: unknown, options?: DecodeOptions) => A, label: string): A & { readonly warnings: readonly string[] } {
  const warnings: string[] = [];
  const data = decodeFile(value, input => decode(input, { onWarning: message => warnings.push(message) }), label);
  return { ...data, warnings };
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
export async function fetchSleeperData(): Promise<SleeperDataFile & { readonly warnings: readonly string[] }> {
  const parsed = await fetchCatalogFile(CATALOG.sleeper, 'Sleeper data');
  return decodeOptionalFile(parsed, decodeSleeperDataFile, 'Sleeper');
}

/**
 * Fetch team environment data
 */
export async function fetchTeamEnvData(): Promise<TeamEnvDataFile & { readonly warnings: readonly string[] }> {
  const parsed = await fetchCatalogFile(CATALOG.environment, 'team environment data');
  return decodeOptionalFile(parsed, decodeTeamEnvDataFile, 'team environment');
}

/**
 * Fetch contract year data
 */
export async function fetchContractData(): Promise<ContractDataFile & { readonly warnings: readonly string[] }> {
  const parsed = await fetchCatalogFile(CATALOG.contracts, 'contract data');
  return decodeOptionalFile(parsed, decodeContractDataFile, 'contract');
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
  return decodeFile(parsed, decodeRecommendationPolicyFile, 'recommendation policy', 'Invalid recommendation policy format');
}

export async function fetchSportsbookSnapshot(): Promise<SportsbookSnapshot & { readonly decodeWarnings: readonly string[] }> {
  const response = await fetch('/api/draft-data/sportsbook');
  if (!response.ok) {
    throw new Error(`Failed to load sportsbook data: ${String(response.status)}`);
  }
  const parsed: unknown = await response.json();
  const warnings: string[] = [];
  const data = decodeFile(parsed, value => decodeSportsbookSnapshot(value, { onWarning: message => warnings.push(message) }), 'sportsbook');
  return { ...data, decodeWarnings: [...(data.decodeWarnings ?? []), ...warnings] };
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
): Promise<MarketAdpSnapshot & { readonly warnings: readonly string[] }> {
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
  const warnings: string[] = [];
  const data = decodeFile(parsed, value => decodeMarketAdpSnapshot(value, { onWarning: message => warnings.push(message) }), 'Fantasy Football Calculator ADP', 'Invalid Fantasy Football Calculator ADP format');
  return { ...data, warnings: [...(data.warnings ?? []), ...warnings] };
}

