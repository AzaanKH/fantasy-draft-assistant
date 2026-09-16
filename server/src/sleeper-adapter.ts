import {
  isSleeperDraftMetadata,
  isSleeperDraftPickList,
  isSleeperLeague,
  normalizeSleeperDraftMetadata,
  normalizeSleeperLeagueSettings,
  resolveSleeperDraftLeagueId,
  type SleeperLeague,
  normalizeSleeperPick,
  type SleeperDraftMetadata,
  type SleeperDraftPick,
} from '@fantasy-draft/shared';
import type {
  DraftAdapterSnapshot,
  DraftSyncAdapter,
  FetchJson,
} from './sync-adapter.js';

export const SLEEPER_API_BASE = 'https://api.sleeper.app/v1';
export const SLEEPER_SETTINGS_CACHE_MS = 60_000;

export class SleeperSyncAdapter implements DraftSyncAdapter {
  public readonly provider = 'sleeper' as const;
  private settingsCache: {
    leagueId: string;
    expiresAt: number;
    settings: ReturnType<typeof normalizeSleeperLeagueSettings>;
  } | undefined;
  private settingsGeneration = 0;

  public invalidateSettings(): void {
    this.settingsCache = undefined;
    this.settingsGeneration += 1;
  }

  public constructor(
    public readonly draftId: string,
    private readonly fetchJson: FetchJson
  ) {}

  public async poll(signal: AbortSignal): Promise<DraftAdapterSnapshot> {
    const [draftResponse, picksResponse] = await Promise.all([
      this.fetchJson<SleeperDraftMetadata>(
        `${SLEEPER_API_BASE}/draft/${this.draftId}`,
        signal
      ),
      this.fetchJson<SleeperDraftPick[]>(
        `${SLEEPER_API_BASE}/draft/${this.draftId}/picks`,
        signal
      ),
    ]);

    if (
      !isSleeperDraftMetadata(draftResponse) ||
      !isSleeperDraftPickList(picksResponse)
    ) {
      throw new Error('Sleeper returned an invalid draft payload');
    }

    const leagueId = resolveSleeperDraftLeagueId(draftResponse);
    if (this.settingsCache?.leagueId !== leagueId) this.invalidateSettings();
    const leagueSettings = leagueId
      ? await this.fetchLeagueSettings(leagueId, signal).catch(() => undefined)
      : undefined;

    return {
      draft: normalizeSleeperDraftMetadata(draftResponse, leagueSettings),
      picks: picksResponse.map(normalizeSleeperPick),
    };
  }

  private async fetchLeagueSettings(
    leagueId: string,
    signal: AbortSignal
  ) {
    const cached = this.settingsCache;
    if (cached?.leagueId === leagueId && cached.expiresAt > Date.now()) {
      return cached.settings;
    }
    // Never fall back to expired settings when a verification request fails.
    this.settingsCache = undefined;
    const generation = this.settingsGeneration;
    const leagueResponse = await this.fetchJson<SleeperLeague>(
      `${SLEEPER_API_BASE}/league/${leagueId}`,
      signal
    );
    if (!isSleeperLeague(leagueResponse) || leagueResponse.league_id !== leagueId) {
      throw new Error('Sleeper returned invalid league settings');
    }
    const settings = normalizeSleeperLeagueSettings(leagueResponse);
    if (generation === this.settingsGeneration && !signal.aborted) {
      this.settingsCache = { leagueId, settings, expiresAt: Date.now() + SLEEPER_SETTINGS_CACHE_MS };
    }
    return settings;
  }
}
