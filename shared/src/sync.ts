import { isPosition, type Position } from './player';
import { isLeagueSettings, type LeagueSettings } from './league-settings';

export interface SleeperDraftPick {
  readonly round: number;
  readonly roster_id: number | null;
  readonly player_id: string;
  readonly picked_by: string;
  readonly pick_no: number;
  readonly metadata: {
    readonly first_name: string;
    readonly last_name: string;
    readonly position: string;
    readonly team: string;
    readonly status: string;
  } | null;
  readonly is_keeper: boolean | null;
  readonly draft_slot: number;
  readonly draft_id: string;
}

export interface SleeperDraftMetadata {
  readonly draft_id: string;
  readonly league_id?: string | null;
  /** Sleeper league mocks put the source league ID here instead of at the top level. */
  readonly metadata?: {
    readonly league_id?: string | null;
    readonly [key: string]: unknown;
  };
  readonly status: 'pre_draft' | 'drafting' | 'paused' | 'complete';
  readonly type: 'snake' | 'linear' | 'auction';
  readonly settings: {
    readonly teams: number;
    readonly rounds: number;
    readonly pick_timer: number;
  };
  readonly draft_order: Record<string, number> | null;
}

export type DraftProvider = 'sleeper' | 'yahoo' | 'espn';

export type DraftStatus = 'pre_draft' | 'drafting' | 'paused' | 'complete';

export type DraftType = 'snake' | 'linear' | 'auction';

/** Provider-neutral draft metadata exposed to every sync consumer. */
export interface DraftMetadata {
  readonly provider: DraftProvider;
  readonly draftId: string;
  /** The provider's fully-qualified key when it differs from the user-facing ID. */
  readonly providerKey: string;
  readonly leagueId?: string;
  readonly leagueSettings?: LeagueSettings;
  readonly status: DraftStatus;
  readonly type: DraftType;
  readonly settings: {
    readonly teams: number;
    readonly rounds: number;
    readonly pickTimer: number;
  };
  readonly draftOrder: Record<string, number> | null;
}

export type DraftSyncSource =
  | 'sleeper-api'
  | 'yahoo-public'
  | 'espn-extension'
  | 'extension-dom'
  | 'manual';

export type DraftPickConfidence = 'confirmed' | 'probable';

export interface DraftPickEvent {
  readonly draftId: string;
  readonly pickNumber: number;
  readonly round: number;
  readonly rosterId: number | null;
  readonly draftSlot: number;
  readonly teamIndex: number;
  readonly playerId: string;
  readonly playerName: string;
  /**
   * Null when the provider omitted the position or supplied a value this
   * version does not recognize. Consumers must resolve it from player identity
   * data or reject the pick rather than guessing a roster position.
   */
  readonly position: Position | null;
  readonly nflTeam: string | null;
  readonly isKeeper: boolean;
  readonly source: DraftSyncSource;
  readonly confidence: DraftPickConfidence;
  readonly observedAt: number;
}

/**
 * Sanitized ESPN state emitted by the extension's page-world bridge.
 * Authentication data, member IDs, and raw socket payloads must never cross
 * this boundary.
 */
export interface EspnDraftSnapshot {
  readonly draft: DraftMetadata;
  readonly picks: readonly DraftPickEvent[];
  readonly observedAt: number;
  readonly myDraftSlot?: number;
}

export type DraftSyncState = 'idle' | 'syncing' | 'synced' | 'error';

export interface DraftSyncSnapshot {
  readonly provider: DraftProvider;
  readonly draftId: string;
  readonly draft: DraftMetadata | null;
  readonly picks: readonly DraftPickEvent[];
  readonly status: DraftSyncState;
  readonly lastPolledAt: number | null;
  readonly lastSuccessfulSyncAt: number | null;
  readonly lastError: string | null;
}

export interface DraftSyncUpdate {
  readonly type: 'snapshot' | 'pick' | 'status';
  readonly snapshot: DraftSyncSnapshot;
  readonly pick?: DraftPickEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteNumberRecord(value: unknown): value is Record<string, number> {
  return (
    isRecord(value) &&
    !Array.isArray(value) &&
    Object.values(value).every(isFiniteNumber)
  );
}

function isSleeperDraftStatus(value: unknown): value is SleeperDraftMetadata['status'] {
  return (
    value === 'pre_draft' ||
    value === 'drafting' ||
    value === 'paused' ||
    value === 'complete'
  );
}

function isDraftType(value: unknown): value is DraftType {
  return value === 'snake' || value === 'linear' || value === 'auction';
}

/** Runtime validation for the untrusted Sleeper draft metadata response. */
export function isSleeperDraftMetadata(value: unknown): value is SleeperDraftMetadata {
  if (!isRecord(value) || !isRecord(value.settings)) {
    return false;
  }

  const metadata = value.metadata;
  const validMetadata = metadata === undefined || (
    isRecord(metadata) &&
    (metadata.league_id === undefined ||
      metadata.league_id === null ||
      typeof metadata.league_id === 'string')
  );

  return (
    typeof value.draft_id === 'string' &&
    (value.league_id === undefined ||
      value.league_id === null ||
      typeof value.league_id === 'string') &&
    validMetadata &&
    isSleeperDraftStatus(value.status) &&
    isDraftType(value.type) &&
    isFiniteNumber(value.settings.teams) &&
    isFiniteNumber(value.settings.rounds) &&
    isFiniteNumber(value.settings.pick_timer) &&
    (value.draft_order === null || isFiniteNumberRecord(value.draft_order))
  );
}

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

function isDraftStatus(value: unknown): value is DraftStatus {
  return (
    value === 'pre_draft' ||
    value === 'drafting' ||
    value === 'paused' ||
    value === 'complete'
  );
}

export function isDraftMetadata(value: unknown): value is DraftMetadata {
  if (!isRecord(value) || !isRecord(value.settings)) {
    return false;
  }

  return (
    isDraftProvider(value.provider) &&
    typeof value.draftId === 'string' &&
    typeof value.providerKey === 'string' &&
    (value.leagueId === undefined || typeof value.leagueId === 'string') &&
    (value.leagueSettings === undefined || isLeagueSettings(value.leagueSettings)) &&
    isDraftStatus(value.status) &&
    isDraftType(value.type) &&
    isFiniteNumber(value.settings.teams) &&
    isFiniteNumber(value.settings.rounds) &&
    isFiniteNumber(value.settings.pickTimer) &&
    (value.draftOrder === null || isFiniteNumberRecord(value.draftOrder))
  );
}

/** Runtime validation for an individual untrusted Sleeper draft pick response. */
export function isSleeperDraftPick(value: unknown): value is SleeperDraftPick {
  if (!isRecord(value)) {
    return false;
  }

  const metadata = value.metadata;
  const validMetadata = metadata === null || (
    isRecord(metadata) &&
    typeof metadata.first_name === 'string' &&
    typeof metadata.last_name === 'string' &&
    typeof metadata.position === 'string' &&
    typeof metadata.team === 'string' &&
    typeof metadata.status === 'string'
  );

  return (
    isFiniteNumber(value.round) &&
    (value.roster_id === null || isFiniteNumber(value.roster_id)) &&
    typeof value.player_id === 'string' &&
    typeof value.picked_by === 'string' &&
    isFiniteNumber(value.pick_no) &&
    validMetadata &&
    (value.is_keeper === null || typeof value.is_keeper === 'boolean') &&
    isFiniteNumber(value.draft_slot) &&
    typeof value.draft_id === 'string'
  );
}

export function isSleeperDraftPickList(value: unknown): value is SleeperDraftPick[] {
  return Array.isArray(value) && value.every(isSleeperDraftPick);
}

function isDraftPickEvent(value: unknown): value is DraftPickEvent {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.draftId === 'string' &&
    isFiniteNumber(value.pickNumber) &&
    isFiniteNumber(value.round) &&
    (value.rosterId === null || isFiniteNumber(value.rosterId)) &&
    isFiniteNumber(value.draftSlot) &&
    isFiniteNumber(value.teamIndex) &&
    typeof value.playerId === 'string' &&
    typeof value.playerName === 'string' &&
    (value.position === null || isPosition(value.position)) &&
    (value.nflTeam === null || typeof value.nflTeam === 'string') &&
    typeof value.isKeeper === 'boolean' &&
    (
      value.source === 'sleeper-api' ||
      value.source === 'yahoo-public' ||
      value.source === 'espn-extension' ||
      value.source === 'extension-dom' ||
      value.source === 'manual'
    ) &&
    (value.confidence === 'confirmed' || value.confidence === 'probable') &&
    isFiniteNumber(value.observedAt)
  );
}

/** Runtime validation for snapshots received from an ESPN page bridge. */
export function isEspnDraftSnapshot(value: unknown): value is EspnDraftSnapshot {
  if (!isRecord(value)) return false;
  const draft = value.draft;
  const picks = value.picks;
  if (
    !isDraftMetadata(draft) ||
    draft.provider !== 'espn' ||
    !Array.isArray(picks) ||
    !picks.every(isDraftPickEvent) ||
    !isFiniteNumber(value.observedAt)
  ) {
    return false;
  }

  if (
    value.myDraftSlot !== undefined &&
    (!isFiniteNumber(value.myDraftSlot) || value.myDraftSlot < 1)
  ) {
    return false;
  }

  return picks.every(
    (pick) =>
      pick.draftId === draft.draftId &&
      pick.source === 'espn-extension'
  );
}

export function isDraftSyncSnapshot(value: unknown): value is DraftSyncSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isDraftProvider(value.provider) &&
    typeof value.draftId === 'string' &&
    (value.draft === null || isDraftMetadata(value.draft)) &&
    Array.isArray(value.picks) &&
    value.picks.every(isDraftPickEvent) &&
    (value.status === 'idle' || value.status === 'syncing' || value.status === 'synced' || value.status === 'error') &&
    (value.lastPolledAt === null || isFiniteNumber(value.lastPolledAt)) &&
    (value.lastSuccessfulSyncAt === null || isFiniteNumber(value.lastSuccessfulSyncAt)) &&
    (value.lastError === null || typeof value.lastError === 'string')
  );
}

/** Runtime validation for the untrusted SSE payload consumed by the web app. */
export function isDraftSyncUpdate(value: unknown): value is DraftSyncUpdate {
  if (!isRecord(value) || !isDraftSyncSnapshot(value.snapshot)) {
    return false;
  }

  return (
    (value.type === 'snapshot' || value.type === 'pick' || value.type === 'status') &&
    (value.pick === undefined || isDraftPickEvent(value.pick))
  );
}

export function normalizePosition(value: string | undefined): Position | null {
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
  } {
    if (draft.provider !== this.provider || draft.draftId !== this.draftId) {
      throw new Error('Draft metadata does not match this sync session');
    }
    if (normalizedPicks.some((pick) => pick.draftId !== this.draftId)) {
      throw new Error('Draft picks do not match this sync session');
    }

    const sortedPicks = [...normalizedPicks].sort(
      (a, b) => a.pickNumber - b.pickNumber
    );

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
    };
  }
}
