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
import { Effect } from 'effect';
import {
  ProviderError,
  requestJson,
  type DraftAdapterSnapshot,
  type DraftSyncAdapter,
  type FetchJson,
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

  public poll(): Effect.Effect<DraftAdapterSnapshot, ProviderError> {
    return Effect.gen({ self: this }, function* () {
      const [draftResponse, picksResponse] = yield* Effect.all([
        requestJson<SleeperDraftMetadata>(this.fetchJson, `${SLEEPER_API_BASE}/draft/${this.draftId}`),
        requestJson<SleeperDraftPick[]>(this.fetchJson, `${SLEEPER_API_BASE}/draft/${this.draftId}/picks`),
      ], { concurrency: 'unbounded' });

      if (
        !isSleeperDraftMetadata(draftResponse) ||
        !isSleeperDraftPickList(picksResponse)
      ) {
        return yield* new ProviderError({ message: 'Sleeper returned an invalid draft payload' });
      }

      const leagueId = resolveSleeperDraftLeagueId(draftResponse);
      if (this.settingsCache?.leagueId !== leagueId) this.invalidateSettings();
      // League settings refine the draft, so a failed lookup still publishes picks.
      const leagueSettings = leagueId
        ? yield* this.fetchLeagueSettings(leagueId).pipe(Effect.orElseSucceed(() => undefined))
        : undefined;

      return {
        draft: normalizeSleeperDraftMetadata(draftResponse, leagueSettings),
        picks: picksResponse.map(normalizeSleeperPick),
      };
    });
  }

  private fetchLeagueSettings(leagueId: string) {
    return Effect.gen({ self: this }, function* () {
      const cached = this.settingsCache;
      if (cached?.leagueId === leagueId && cached.expiresAt > Date.now()) {
        return cached.settings;
      }
      // Never fall back to expired settings when a verification request fails.
      this.settingsCache = undefined;
      const generation = this.settingsGeneration;
      const leagueResponse = yield* requestJson<SleeperLeague>(this.fetchJson, `${SLEEPER_API_BASE}/league/${leagueId}`);
      if (!isSleeperLeague(leagueResponse) || leagueResponse.league_id !== leagueId) {
        return yield* new ProviderError({ message: 'Sleeper returned invalid league settings' });
      }
      const settings = normalizeSleeperLeagueSettings(leagueResponse);
      // An interrupted poll never reaches this point, so only completed lookups are cached.
      if (generation === this.settingsGeneration) {
        this.settingsCache = { leagueId, settings, expiresAt: Date.now() + SLEEPER_SETTINGS_CACHE_MS };
      }
      return settings;
    });
  }
}
