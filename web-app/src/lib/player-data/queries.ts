import { http, HttpError } from '@fantasy-draft/shared/http';
import { BROWSER_HTTP_POLICY, requestJson } from '@/lib/http';
import { type DecodeOptions, CATALOG, catalogPath } from '@fantasy-draft/shared/catalog';
import { fantasyProsProvider } from '@/lib/providers/fantasypros';
import { type FantasyProsSnapshot, type MarketAdpFormat, type MarketAdpSnapshot, type SportsbookSnapshot, decodeMarketAdpSnapshot, decodeSportsbookSnapshot } from '@fantasy-draft/shared/catalog';

import { type ContractDataFile, type PlayerIdentityFile, type PredictionsDataFile, type RecommendationPolicyFile, type SleeperDataFile, type TeamEnvDataFile, decodeContractDataFile, decodePlayerIdentityFile, decodePredictionsDataFile, decodeRecommendationPolicyFile, decodeSleeperDataFile, decodeTeamEnvDataFile } from '@fantasy-draft/shared/catalog';

function fetchCatalogFile<T>(file: Parameters<typeof catalogPath>[0], label: string, decode: (value: unknown) => T): Promise<T> {
  return requestJson(`/${catalogPath(file)}`, decode, `Failed to load ${label}`);
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
  return fetchCatalogFile(CATALOG.sleeper, 'Sleeper data', value => decodeOptionalFile(value, decodeSleeperDataFile, 'Sleeper'));
}

/**
 * Fetch team environment data
 */
export async function fetchTeamEnvData(): Promise<TeamEnvDataFile & { readonly warnings: readonly string[] }> {
  return fetchCatalogFile(CATALOG.environment, 'team environment data', value => decodeOptionalFile(value, decodeTeamEnvDataFile, 'team environment'));
}

/**
 * Fetch contract year data
 */
export async function fetchContractData(): Promise<ContractDataFile & { readonly warnings: readonly string[] }> {
  return fetchCatalogFile(CATALOG.contracts, 'contract data', value => decodeOptionalFile(value, decodeContractDataFile, 'contract'));
}

export async function fetchPredictionData(): Promise<PredictionsDataFile & { readonly warnings: readonly string[] }> {
  try {
    return await http.json(`/${catalogPath(CATALOG.predictions)}`,
      value => decodeOptionalFile(value, decodePredictionsDataFile, 'prediction'), BROWSER_HTTP_POLICY);
  } catch (error) {
    if (error instanceof HttpError && error.kind === 'status') {
      if (error.status === 404) return { generatedAt: null, modelVersion: 'none', players: [], warnings: [] };
      throw new Error(`Failed to load prediction data: ${String(error.status)}`);
    }
    throw error;
  }
}

export async function fetchPlayerIdentityData(): Promise<PlayerIdentityFile> {
  return fetchCatalogFile(CATALOG.identities, 'player identity data', value => decodeFile(value, decodePlayerIdentityFile, 'player identity'));
}

export async function fetchRecommendationPolicy(): Promise<RecommendationPolicyFile> {
  return fetchCatalogFile(CATALOG.policy, 'recommendation policy', value => decodeFile(value, decodeRecommendationPolicyFile, 'recommendation policy', 'Invalid recommendation policy format'));
}

export async function fetchSportsbookSnapshot(): Promise<SportsbookSnapshot & { readonly decodeWarnings: readonly string[] }> {
  return requestJson('/api/draft-data/sportsbook', parsed => {
    const warnings: string[] = [];
    const data = decodeFile(parsed, value => decodeSportsbookSnapshot(value, { onWarning: message => warnings.push(message) }), 'sportsbook');
    return { ...data, decodeWarnings: [...(data.decodeWarnings ?? []), ...warnings] };
  }, 'Failed to load sportsbook data');
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
  return requestJson(`/api/market-adp?${params.toString()}`, parsed => {
    const warnings: string[] = [];
    const data = decodeFile(parsed, value => decodeMarketAdpSnapshot(value, { onWarning: message => warnings.push(message) }), 'Fantasy Football Calculator ADP', 'Invalid Fantasy Football Calculator ADP format');
    return { ...data, warnings: [...(data.warnings ?? []), ...warnings] };
  }, 'Failed to load Fantasy Football Calculator ADP');
}
