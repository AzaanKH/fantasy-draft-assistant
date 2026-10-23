import { isBoundedInteger, isDraftSize } from './limits.js';
import { type Position } from './player.js';
import { type LeagueSettings } from './league-settings.js';

import type { SleeperDraftPick, SleeperDraftMetadata, DraftMetadata, DraftPickEvent, EspnDraftSnapshot, DraftSyncSnapshot, DraftSyncUpdate } from './catalog/sync-decoders.js';
export type { SleeperDraftPick, SleeperDraftMetadata, DraftMetadata, DraftPickEvent, EspnDraftSnapshot, DraftSyncSnapshot, DraftSyncUpdate };

export type DraftProvider = DraftMetadata['provider'];
export type DraftStatus = DraftMetadata['status'];
export type DraftType = DraftMetadata['type'];
export type DraftSyncState = DraftSyncSnapshot['status'];

/** Resolves the source league for regular Sleeper drafts and league mocks. */
export function resolveSleeperDraftLeagueId(
  draft: SleeperDraftMetadata
): string | null {
  const candidates = [draft.league_id, draft.metadata?.league_id];
  return candidates.find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.trim().length > 0
  ) ?? null;
}

export function isDraftProvider(value: unknown): value is DraftProvider {
  return value === 'sleeper' || value === 'yahoo' || value === 'espn';
}

function normalizePosition(value: string | undefined): Position | null {
  switch (value?.toUpperCase()) {
    case 'QB':
      return 'QB';
    case 'RB':
      return 'RB';
    case 'WR':
      return 'WR';
    case 'TE':
      return 'TE';
    case 'K':
      return 'K';
    case 'DEF':
    case 'DST':
    case 'D/ST':
      return 'DEF';
    default:
      return null;
  }
}

function getPlayerName(pick: SleeperDraftPick): string {
  if (pick.metadata) {
    return `${pick.metadata.first_name} ${pick.metadata.last_name}`.trim();
  }

  return pick.player_id;
}

export function normalizeSleeperPick(pick: SleeperDraftPick): DraftPickEvent {
  return {
    draftId: pick.draft_id,
    pickNumber: pick.pick_no,
    round: pick.round,
    rosterId: pick.roster_id,
    draftSlot: pick.draft_slot,
    teamIndex: pick.draft_slot - 1,
    playerId: pick.player_id,
    playerName: getPlayerName(pick),
    position: normalizePosition(pick.metadata?.position),
    nflTeam: pick.metadata?.team ?? null,
    isKeeper: Boolean(pick.is_keeper),
    source: 'sleeper-api',
    confidence: 'confirmed',
    observedAt: Date.now(),
  };
}

export function normalizeSleeperDraftMetadata(
  draft: SleeperDraftMetadata,
  leagueSettings?: LeagueSettings
): DraftMetadata {
  const leagueId = resolveSleeperDraftLeagueId(draft);
  return {
    provider: 'sleeper',
    draftId: draft.draft_id,
    providerKey: draft.draft_id,
    ...(leagueId ? { leagueId } : {}),
    ...(leagueSettings ? { leagueSettings } : {}),
    status: draft.status,
    type: draft.type,
    settings: {
      teams: draft.settings.teams,
      rounds: draft.settings.rounds,
      pickTimer: draft.settings.pick_timer,
    },
    draftOrder: draft.draft_order,
  };
}

function samePickContent(left: DraftPickEvent, right: DraftPickEvent): boolean {
  return left.draftId === right.draftId &&
    left.pickNumber === right.pickNumber &&
    left.round === right.round &&
    left.rosterId === right.rosterId &&
    left.draftSlot === right.draftSlot &&
    left.teamIndex === right.teamIndex &&
    left.playerId === right.playerId &&
    left.playerName === right.playerName &&
    left.position === right.position &&
    left.nflTeam === right.nflTeam &&
    left.isKeeper === right.isKeeper &&
    left.source === right.source &&
    left.confidence === right.confidence;
}

export class DraftSyncEngine {
  private readonly provider: DraftProvider;
  private readonly draftId: string;
  private snapshot: DraftSyncSnapshot;
  private readonly picksByNumber = new Map<number, DraftPickEvent>();

  public constructor(provider: DraftProvider, draftId: string) {
    this.provider = provider;
    this.draftId = draftId;
    this.snapshot = {
      provider,
      draftId,
      draft: null,
      picks: [],
      status: 'idle',
      lastPolledAt: null,
      lastSuccessfulSyncAt: null,
      lastError: null,
    };
  }

  public getSnapshot(): DraftSyncSnapshot {
    return this.snapshot;
  }

  public beginSync(now: number = Date.now()): DraftSyncSnapshot {
    this.snapshot = {
      ...this.snapshot,
      status: 'syncing',
      lastPolledAt: now,
      lastError: null,
    };
    return this.snapshot;
  }

  public failSync(message: string, now: number = Date.now()): DraftSyncSnapshot {
    this.snapshot = {
      ...this.snapshot,
      status: 'error',
      lastPolledAt: now,
      lastError: message,
    };
    return this.snapshot;
  }

  public reconcile(
    draft: DraftMetadata,
    normalizedPicks: readonly DraftPickEvent[],
    now: number = Date.now()
  ): {
    readonly snapshot: DraftSyncSnapshot;
    readonly newPicks: readonly DraftPickEvent[];
    readonly changed: boolean;
  } {
    if (!draft.settings || !isDraftSize(draft.settings.teams, draft.settings.rounds)) {
      throw new Error('Invalid draft metadata or picks');
    }
    const maxPicks = draft.settings.teams * draft.settings.rounds;
    if (normalizedPicks.length > maxPicks || !normalizedPicks.every((pick) =>
      isBoundedInteger(pick.pickNumber, 1, maxPicks) &&
      isBoundedInteger(pick.round, 1, draft.settings.rounds) &&
      isBoundedInteger(pick.draftSlot, 1, draft.settings.teams) &&
      isBoundedInteger(pick.teamIndex, 0, draft.settings.teams - 1)
    )) {
      throw new Error('Invalid draft metadata or picks');
    }
    if (draft.provider !== this.provider || draft.draftId !== this.draftId) {
      throw new Error('Draft metadata does not match this sync session');
    }
    if (normalizedPicks.some((pick) => pick.draftId !== this.draftId)) {
      throw new Error('Draft picks do not match this sync session');
    }

    const sortedPicks = [...normalizedPicks].sort(
      (a, b) => a.pickNumber - b.pickNumber
    );

    const contentChanged =
      JSON.stringify(this.snapshot.draft) !== JSON.stringify(draft) ||
      this.snapshot.picks.length !== sortedPicks.length ||
      sortedPicks.some((pick, index) => {
        const previous = this.snapshot.picks[index];
        return previous === undefined || !samePickContent(pick, previous);
      });

    if (!contentChanged) {
      this.snapshot = {
        ...this.snapshot,
        status: 'synced',
        lastPolledAt: now,
        lastSuccessfulSyncAt: now,
        lastError: null,
      };
      return { snapshot: this.snapshot, newPicks: [], changed: false };
    }

    const nextPicksByNumber = new Map<number, DraftPickEvent>();
    const newPicks: DraftPickEvent[] = [];

    for (const pick of sortedPicks) {
      const previousPick = this.picksByNumber.get(pick.pickNumber);
      if (!previousPick || previousPick.playerId !== pick.playerId) {
        newPicks.push(pick);
      }
      nextPicksByNumber.set(pick.pickNumber, pick);
    }

    // Providers can correct a completed pick. Rebuild from the latest complete
    // response so that removed or replaced picks do not linger locally.
    this.picksByNumber.clear();
    for (const [pickNumber, pick] of nextPicksByNumber) {
      this.picksByNumber.set(pickNumber, pick);
    }

    const picks = [...this.picksByNumber.values()].sort(
      (a, b) => a.pickNumber - b.pickNumber
    );

    this.snapshot = {
      provider: this.provider,
      draftId: this.draftId,
      draft,
      picks,
      status: 'synced',
      lastPolledAt: now,
      lastSuccessfulSyncAt: now,
      lastError: null,
    };

    return {
      snapshot: this.snapshot,
      newPicks,
      changed: true,
    };
  }
}
