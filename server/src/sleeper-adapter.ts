import { decodeSleeperDraftMetadata, decodeSleeperDraftPickList } from '@fantasy-draft/shared/catalog';
import {
  normalizeSleeperDraftMetadata,
  resolveSleeperDraftLeagueId,
  normalizeSleeperPick,
} from '@fantasy-draft/shared/sync';
import {
  isSleeperLeague,
  normalizeSleeperLeagueSettings,
} from '@fantasy-draft/shared/league';
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

function decodeDraftPayload<A>(decode: (value: unknown) => A): (value: unknown) => A {
  return value => {
    try { return decode(value); }
    catch {
      console.warn('[sleeper-adapter] Rejected invalid draft payload');
      throw new ProviderError({ message: 'Sleeper returned an invalid draft payload' });
    }
  };
}

type LeagueSettings = ReturnType<typeof normalizeSleeperLeagueSettings>;

/** Verified league settings within their TTL. Invalidation also discards lookups started before it. */
class LeagueSettingsCache {
  private entry: { readonly leagueId: string; readonly settings: LeagueSettings; readonly expiresAt: number } | undefined;
  private currentGeneration = 0;

  public get generation(): number { return this.currentGeneration; }

  public get(leagueId: string, now: number): LeagueSettings | undefined {
    const entry = this.entry;
    return entry?.leagueId === leagueId && entry.expiresAt > now ? entry.settings : undefined;
  }

  public invalidate(): void {
    this.entry = undefined;
    this.currentGeneration += 1;
  }

  public retainLeague(leagueId: string | null): void {
    if (this.entry?.leagueId !== leagueId) this.invalidate();
  }

  public storeForGeneration(generation: number, leagueId: string, settings: LeagueSettings, now: number): void {
    if (generation === this.currentGeneration) {
      this.entry = { leagueId, settings, expiresAt: now + SLEEPER_SETTINGS_CACHE_MS };
    }
  }
}

export class SleeperSyncAdapter implements DraftSyncAdapter {
  public readonly provider = 'sleeper' as const;
  private readonly settings = new LeagueSettingsCache();

  public invalidateSettings(): void {
    this.settings.invalidate();
  }

  public constructor(
    public readonly draftId: string,
    private readonly fetchJson: FetchJson
  ) {}

  public poll(): Effect.Effect<DraftAdapterSnapshot, ProviderError> {
    return Effect.gen({ self: this }, function* () {
      const [draft, picks] = yield* Effect.all([
        requestJson(this.fetchJson, `${SLEEPER_API_BASE}/draft/${this.draftId}`, decodeDraftPayload(decodeSleeperDraftMetadata)),
        requestJson(this.fetchJson, `${SLEEPER_API_BASE}/draft/${this.draftId}/picks`, decodeDraftPayload(decodeSleeperDraftPickList)),
      ], { concurrency: 'unbounded' });

      if (draft.draft_id !== this.draftId || picks.some(pick => pick.draft_id !== this.draftId)) {
        console.warn('[sleeper-adapter] Rejected draft payload for another session');
        return yield* new ProviderError({ message: 'Sleeper returned an invalid draft payload' });
      }

      const leagueId = resolveSleeperDraftLeagueId(draft);
      this.settings.retainLeague(leagueId);
      // League settings refine the draft, so a failed lookup still publishes picks.
      const leagueSettings = leagueId
        ? yield* this.fetchLeagueSettings(leagueId).pipe(Effect.orElseSucceed(() => undefined))
        : undefined;

      return {
        draft: normalizeSleeperDraftMetadata(draft, leagueSettings),
        picks: picks.map(normalizeSleeperPick),
      };
    });
  }

  private fetchLeagueSettings(leagueId: string) {
    return Effect.gen({ self: this }, function* () {
      const cached = this.settings.get(leagueId, Date.now());
      if (cached) return cached;
      const generation = this.settings.generation;
      const settings = yield* requestJson(this.fetchJson, `${SLEEPER_API_BASE}/league/${leagueId}`, value => {
        if (!isSleeperLeague(value) || value.league_id !== leagueId) {
          console.warn('[sleeper-adapter] Rejected invalid league settings');
          throw new ProviderError({ message: 'Sleeper returned invalid league settings' });
        }
        return normalizeSleeperLeagueSettings(value);
      });
      this.settings.storeForGeneration(generation, leagueId, settings, Date.now());
      return settings;
    });
  }
}
