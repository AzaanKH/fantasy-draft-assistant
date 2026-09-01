import {
  isMarketAdpFormat,
  isNFLTeam,
  isPosition,
  type MarketAdpFormat,
  type MarketAdpPlayer,
  type MarketAdpSnapshot,
  type NFLTeam,
  type Position,
} from '@fantasy-draft/shared';
import type { FetchJson } from './sync-adapter.js';

export const FFC_API_BASE = 'https://fantasyfootballcalculator.com/api/v1/adp';
export const DEFAULT_MARKET_ADP_CACHE_MS = 60 * 60 * 1000;

interface CacheEntry {
  readonly expiresAt: number;
  readonly snapshot: MarketAdpSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizePosition(value: unknown): Position | null {
  if (typeof value !== 'string') return null;
  const uppercase = value.toUpperCase();
  const normalized = uppercase === 'DST'
    ? 'DEF'
    : uppercase === 'PK'
      ? 'K'
      : uppercase;
  return isPosition(normalized) ? normalized : null;
}

function normalizeTeam(value: unknown): NFLTeam | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toUpperCase();
  return isNFLTeam(normalized) ? normalized : null;
}

function normalizePlayers(value: unknown): MarketAdpPlayer[] {
  if (!Array.isArray(value)) {
    throw new Error('Fantasy Football Calculator returned an invalid player list');
  }

  const players: MarketAdpPlayer[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const name = typeof item['name'] === 'string' ? item['name'].trim() : '';
    const position = normalizePosition(item['position']);
    const adp = finiteNumber(item['adp']);
    if (!name || position === null || adp === null || adp <= 0) continue;

    players.push({
      externalId: String(item['player_id'] ?? `${name}-${position}`),
      name,
      position,
      team: normalizeTeam(item['team']),
      adp,
    });
  }

  if (players.length === 0) {
    throw new Error('Fantasy Football Calculator returned no usable ADP players');
  }
  return players;
}

function getDraftCount(payload: Record<string, unknown>): number | null {
  const meta = payload['meta'];
  if (!isRecord(meta)) return null;
  return finiteNumber(meta['total_drafts']);
}

export class FantasyFootballCalculatorAdpProvider {
  private readonly cache = new Map<string, CacheEntry>();

  public constructor(
    private readonly fetchJson: FetchJson,
    private readonly cacheDurationMs: number = DEFAULT_MARKET_ADP_CACHE_MS
  ) {}

  public async getSnapshot(
    format: MarketAdpFormat,
    teams: number,
    season: number,
    signal: AbortSignal
  ): Promise<MarketAdpSnapshot> {
    if (!isMarketAdpFormat(format)) {
      throw new Error('Unsupported Fantasy Football Calculator scoring format');
    }
    const normalizedTeams = Math.max(8, Math.min(14, Math.round(teams)));
    const normalizedSeason = Math.round(season);
    const cacheKey = `${format}:${String(normalizedTeams)}:${String(normalizedSeason)}`;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.snapshot;

    const url = `${FFC_API_BASE}/${format}?teams=${String(normalizedTeams)}&year=${String(normalizedSeason)}`;
    const payload = await this.fetchJson<unknown>(url, signal);
    if (!isRecord(payload) || payload['status'] !== 'Success') {
      throw new Error('Fantasy Football Calculator returned an invalid ADP payload');
    }

    const snapshot: MarketAdpSnapshot = {
      source: 'fantasy-football-calculator',
      format,
      teams: normalizedTeams,
      season: normalizedSeason,
      refreshedAt: new Date(now).toISOString(),
      draftCount: getDraftCount(payload),
      players: normalizePlayers(payload['players']),
    };
    this.cache.set(cacheKey, {
      expiresAt: now + this.cacheDurationMs,
      snapshot,
    });
    return snapshot;
  }
}
