import {
  isPosition,
  type DraftMetadata,
  type DraftPickEvent,
  type DraftStatus,
  type DraftType,
  type Position,
} from '@fantasy-draft/shared';
import type {
  DraftAdapterSnapshot,
  DraftSyncAdapter,
  FetchJson,
} from './sync-adapter.js';

export const YAHOO_PUBLIC_API_BASE =
  'https://pub-api.fantasysports.yahoo.com/fantasy/v3';
export const YAHOO_PUBLIC_READ_API_BASE =
  'https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2';

interface YahooPlayer {
  readonly playerKey: string;
  readonly name: string;
  readonly position: Position | null;
  readonly nflTeam: string | null;
}

interface YahooDraftResult {
  readonly round: number;
  readonly pickNumber: number;
  readonly teamKey: string;
  readonly playerKey: string | null;
  readonly isKeeper: boolean;
}

interface YahooInitialization {
  readonly draft: DraftMetadata;
  readonly playersByKey: ReadonlyMap<string, YahooPlayer>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function getString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function getNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function getService(payload: unknown, label: string): Record<string, unknown> {
  const service = getRecord(payload, 'service');
  if (!service) {
    throw new Error(`Yahoo returned an invalid ${label} payload`);
  }
  return service;
}

function normalizePosition(value: unknown): Position | null {
  const normalized = getString(value)?.toUpperCase();
  if (normalized === 'DST' || normalized === 'D/ST') return 'DEF';
  return normalized && isPosition(normalized) ? normalized : null;
}

function normalizeTeam(value: unknown): string | null {
  const team = getString(value);
  return team ? team.toUpperCase() : null;
}

function getDraftRounds(settings: Record<string, unknown>): number {
  const positions = settings.roster_positions;
  if (!Array.isArray(positions)) {
    throw new Error('Yahoo settings did not include roster positions');
  }

  const nonDraftedPositions = new Set(['IR', 'IR+', 'IL', 'IL+', 'NA']);
  const rounds = positions.reduce((total, entry) => {
    if (!isRecord(entry)) return total;
    const position = getString(entry.position)?.toUpperCase();
    const count = getNumber(entry.count);
    if (!position || count === null || nonDraftedPositions.has(position)) {
      return total;
    }
    return total + count;
  }, 0);

  if (rounds <= 0) {
    throw new Error('Yahoo settings returned an invalid roster size');
  }
  return rounds;
}

function getDraftType(settings: Record<string, unknown>): DraftType {
  if (getBoolean(settings.is_auction_draft)) return 'auction';
  return getString(settings.draft_type)?.toLowerCase() === 'linear'
    ? 'linear'
    : 'snake';
}

function getInitialStatus(
  service: Record<string, unknown>,
  settings: Record<string, unknown>
): DraftStatus {
  const rawStatus = getString(service.draft_status)?.toLowerCase();
  if (rawStatus === 'postdraft' || rawStatus === 'complete' || rawStatus === 'ended') {
    return 'complete';
  }
  if (rawStatus === 'paused') return 'paused';
  if (rawStatus === 'predraft' || rawStatus === 'notstarted') return 'pre_draft';

  const draftTime = getNumber(settings.draft_time);
  if (draftTime !== null && Date.now() < draftTime * 1000) {
    return 'pre_draft';
  }
  return 'drafting';
}

function parseYahooSettings(leagueId: string, payload: unknown): DraftMetadata {
  const service = getService(payload, 'settings');
  const settings = getRecord(service, 'settings');
  const providerKey = getString(service.league_key);
  const teams =
    getNumber(service.num_teams) ??
    (settings ? getNumber(settings.max_teams) : null);

  if (!settings || !providerKey || teams === null || teams <= 0) {
    throw new Error('Yahoo settings did not include a complete league key');
  }

  return {
    provider: 'yahoo',
    draftId: leagueId,
    providerKey,
    status: getInitialStatus(service, settings),
    type: getDraftType(settings),
    settings: {
      teams,
      rounds: getDraftRounds(settings),
      pickTimer: getNumber(settings.draft_pick_duration) ?? 0,
    },
    draftOrder: null,
  };
}

function parseYahooPlayers(payload: unknown): ReadonlyMap<string, YahooPlayer> {
  const service = getService(payload, 'player list');
  if (!Array.isArray(service.player_list)) {
    throw new Error('Yahoo returned an invalid player list');
  }

  const playersByKey = new Map<string, YahooPlayer>();
  for (const rawPlayer of service.player_list) {
    if (!isRecord(rawPlayer)) continue;
    const playerKey = getString(rawPlayer.player_key);
    if (!playerKey) continue;

    const firstName = getString(rawPlayer.fname) ?? '';
    const lastName = getString(rawPlayer.lname) ?? '';
    const name = `${firstName} ${lastName}`.trim() || playerKey;
    playersByKey.set(playerKey, {
      playerKey,
      name,
      position: normalizePosition(
        rawPlayer.display_pos ?? rawPlayer.primary_pos
      ),
      nflTeam: normalizeTeam(rawPlayer.team_abbr),
    });
  }

  if (playersByKey.size === 0) {
    throw new Error('Yahoo player list was empty');
  }
  return playersByKey;
}

function collectYahooDraftResults(
  value: unknown,
  results: YahooDraftResult[]
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectYahooDraftResults(item, results);
    return;
  }
  if (!isRecord(value)) return;

  const round = getNumber(value.round);
  const pickNumber = getNumber(value.pick);
  const teamKey = getString(value.team_key);
  if (round !== null && pickNumber !== null && teamKey) {
    results.push({
      round,
      pickNumber,
      teamKey,
      playerKey: getString(value.player_key),
      isKeeper: getBoolean(value.is_keeper),
    });
    return;
  }

  for (const nested of Object.values(value)) {
    collectYahooDraftResults(nested, results);
  }
}

export function parseYahooDraftResults(payload: unknown): YahooDraftResult[] {
  const results: YahooDraftResult[] = [];
  collectYahooDraftResults(payload, results);

  const byPickNumber = new Map<number, YahooDraftResult>();
  for (const result of results) {
    byPickNumber.set(result.pickNumber, result);
  }
  return [...byPickNumber.values()].sort(
    (left, right) => left.pickNumber - right.pickNumber
  );
}

function getDraftSlot(
  result: YahooDraftResult,
  teams: number,
  type: DraftType
): number {
  const pickInRound = result.pickNumber - teams * (result.round - 1);
  if (type === 'snake' && result.round % 2 === 0) {
    return teams - pickInRound + 1;
  }
  if (type !== 'auction') return pickInRound;

  const teamId = getNumber(result.teamKey.match(/\.t\.(\d+)$/)?.[1]);
  return teamId !== null && teamId >= 1 && teamId <= teams ? teamId : 1;
}

function normalizeYahooDraftResult(
  draft: DraftMetadata,
  result: YahooDraftResult,
  playersByKey: ReadonlyMap<string, YahooPlayer>,
  observedAt: number
): DraftPickEvent | null {
  if (!result.playerKey) return null;

  const player = playersByKey.get(result.playerKey);
  const draftSlot = getDraftSlot(
    result,
    draft.settings.teams,
    draft.type
  );
  const rosterId = getNumber(result.teamKey.match(/\.t\.(\d+)$/)?.[1]);

  return {
    draftId: draft.draftId,
    pickNumber: result.pickNumber,
    round: result.round,
    rosterId,
    draftSlot,
    teamIndex: draftSlot - 1,
    playerId: result.playerKey,
    playerName: player?.name ?? result.playerKey,
    position: player?.position ?? null,
    nflTeam: player?.nflTeam ?? null,
    isKeeper: result.isKeeper,
    source: 'yahoo-public',
    confidence: 'confirmed',
    observedAt,
  };
}

function updateYahooStatus(
  draft: DraftMetadata,
  completedPicks: number
): DraftMetadata {
  const totalPicks = draft.settings.teams * draft.settings.rounds;
  if (completedPicks >= totalPicks && totalPicks > 0) {
    return { ...draft, status: 'complete' };
  }
  if (completedPicks > 0 && draft.status === 'pre_draft') {
    return { ...draft, status: 'drafting' };
  }

  // Produce a fresh immutable object for each canonical snapshot.
  return {
    ...draft,
    status: draft.status,
    settings: { ...draft.settings },
    draftOrder: draft.draftOrder ? { ...draft.draftOrder } : null,
  };
}

/** Extracts a Yahoo league ID from an ID or supported Yahoo draft/league URL. */
export function parseYahooLeagueId(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (
    !url.hostname.endsWith('.yahoo.com') &&
    !url.hostname.endsWith('.fantasysports.yahoo.com')
  ) {
    return null;
  }

  const match = url.pathname.match(
    /\/(?:draftclient\/f1|draft\/f1|f1)\/(\d+)(?:\/|$)/
  );
  return match?.[1] ?? null;
}

export class YahooSyncAdapter implements DraftSyncAdapter {
  public readonly provider = 'yahoo' as const;
  public readonly draftId: string;
  private initialization: Promise<YahooInitialization> | null = null;
  private draftResultsRequestSequence = 0;

  public constructor(
    draftId: string,
    private readonly fetchJson: FetchJson
  ) {
    const parsedDraftId = parseYahooLeagueId(draftId);
    if (!parsedDraftId) {
      throw new Error('Yahoo league must be a numeric ID or supported URL');
    }
    this.draftId = parsedDraftId;
  }

  public async poll(signal: AbortSignal): Promise<DraftAdapterSnapshot> {
    const initialization = await this.getInitialization(signal);
    const observedAt = Date.now();
    const draftResultsUrl = new URL(
      `${YAHOO_PUBLIC_READ_API_BASE}/league/${encodeURIComponent(initialization.draft.providerKey)}/draftresults`
    );
    draftResultsUrl.searchParams.set('format', 'json');
    draftResultsUrl.searchParams.set(
      '_sync',
      `${String(observedAt)}-${String(++this.draftResultsRequestSequence)}`
    );
    const draftResults = await this.fetchJson<unknown>(
      draftResultsUrl.toString(),
      signal,
      {
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      }
    );
    const picks = parseYahooDraftResults(draftResults)
      .map((result) =>
        normalizeYahooDraftResult(
          initialization.draft,
          result,
          initialization.playersByKey,
          observedAt
        )
      )
      .filter((pick): pick is DraftPickEvent => pick !== null);

    return {
      draft: updateYahooStatus(initialization.draft, picks.length),
      picks,
    };
  }

  private getInitialization(
    signal: AbortSignal
  ): Promise<YahooInitialization> {
    if (!this.initialization) {
      this.initialization = this.initialize(signal).catch((error: unknown) => {
        this.initialization = null;
        throw error;
      });
    }
    return this.initialization;
  }

  private async initialize(signal: AbortSignal): Promise<YahooInitialization> {
    const settingsPayload = await this.fetchJson<unknown>(
      `${YAHOO_PUBLIC_API_BASE}/settings/nfl/${this.draftId}?format=rawjson`,
      signal
    );
    const draft = parseYahooSettings(this.draftId, settingsPayload);
    const playersPayload = await this.fetchJson<unknown>(
      `${YAHOO_PUBLIC_API_BASE}/players/nfl/${this.draftId}?images=0&projected=0&average=0&format=rawjson`,
      signal
    );

    return {
      draft,
      playersByKey: parseYahooPlayers(playersPayload),
    };
  }
}
