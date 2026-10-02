import {
  CORE_DRAFT_DATA_KEYS, OPTIONAL_SIGNAL_KEYS, isDraftSyncSnapshot, isPlayer, isPosition,
  type DraftSyncSnapshot, type DraftReadinessReport, type Player,
} from '@fantasy-draft/shared';
import { isRecord, isRecommendationPolicyFile } from '@/lib/player-data/validators';
import { isLeagueSurvivalModel } from '@/lib/league-survival-model';
import { getKeeperPickNumber } from '@/lib/keeper-supply';
import { createSessionContext } from './context';
import { parseSession } from './arguments';
import type { DraftData } from './data';
import { readBoundedJson, writePrivateJson } from './files';
import { CliError, required } from './errors';

type ArchivedDraftData = Omit<DraftData, 'keeperStatus'> & {
  readonly keeperStatus: Omit<DraftData['keeperStatus'], 'error'> & { readonly error: string | null };
};
export interface SessionArchive {
  readonly schemaVersion: 1;
  readonly kind: 'fantasy-draft-session';
  readonly capturedAt: string;
  readonly session: string;
  readonly slot: number | null;
  readonly snapshot: DraftSyncSnapshot;
  readonly data: ArchivedDraftData;
  readonly readiness: DraftReadinessReport;
  readonly warnings: readonly string[];
}

const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 5000 && value.every(item => typeof item === 'string');
const count = (value: unknown, max = 5000): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
const finiteFields = (record: Record<string, unknown>) => Object.values(record).every(value => typeof value !== 'number' || Number.isFinite(value));

function validReadiness(value: unknown): value is DraftReadinessReport {
  if (!isRecord(value) || !isRecord(value.summary) || !isRecord(value.engineeringChecks) ||
      typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt)) ||
      !Array.isArray(value.coreDraftData) || !Array.isArray(value.optionalSignals) ||
      !Array.isArray(value.productBlockingFailures) || !Array.isArray(value.optionalSignalDegradations) ||
      !Array.isArray(value.actionableWarnings)) return false;
  const items: unknown[] = [...(value.coreDraftData as unknown[]), ...(value.optionalSignals as unknown[])];
  if (!items.every(item => isRecord(item) && typeof item.key === 'string' &&
      ['ready', 'blocking', 'degraded'].includes(String(item.status)) &&
      ['label', 'sourceLabel', 'timestampLabel', 'correctiveAction', 'message'].every(key => typeof item[key] === 'string') &&
      (item.timestamp === null || typeof item.timestamp === 'string') &&
      (item.ageHours === null || typeof item.ageHours === 'number' && Number.isFinite(item.ageHours)) &&
      (item.maxAgeHours === null || typeof item.maxAgeHours === 'number' && Number.isFinite(item.maxAgeHours)))) return false;
  const core = value.coreDraftData as DraftReadinessReport['coreDraftData'];
  const optional = value.optionalSignals as DraftReadinessReport['optionalSignals'];
  const failures = core.filter(item => item.status === 'blocking');
  return core.length === CORE_DRAFT_DATA_KEYS.length && CORE_DRAFT_DATA_KEYS.every(key => core.filter(item => item.key === key).length === 1) &&
    core.every(item => item.status === 'ready' || item.status === 'blocking') &&
    optional.length === OPTIONAL_SIGNAL_KEYS.length && OPTIONAL_SIGNAL_KEYS.every(key => optional.filter(item => item.key === key).length === 1) &&
    optional.every(item => item.status === 'ready' || item.status === 'degraded') &&
    value.status === (failures.length > 0 ? 'blocked' : 'ready') && value.summary.productBlockingFailures === failures.length &&
    value.productBlockingFailures.length === failures.length &&
    value.productBlockingFailures.every(item => isRecord(item) && failures.some(failure => failure.key === item.key)) &&
    value.actionableWarnings.every(item => isRecord(item) && typeof item.message === 'string') &&
    value.engineeringChecks.status === 'not-run';
}

function validData(value: unknown, snapshot: DraftSyncSnapshot): value is ArchivedDraftData {
  if (!isRecord(value) || !Array.isArray(value.players) || value.players.length === 0 || value.players.length > 5000 ||
      !value.players.every(player => isPlayer(player) && player.id.length > 0 && finiteFields(player as unknown as Record<string, unknown>)) ||
      new Set(value.players.map(player => (player as Player).id)).size !== value.players.length ||
      !isRecommendationPolicyFile(value.policy) ||
      !(value.survivalModel === null || isLeagueSurvivalModel(value.survivalModel)) ||
      !Array.isArray(value.keepers) || value.keepers.length > 32 || !isRecord(value.keeperStatus)) return false;
  const status = value.keeperStatus;
  if (!(status.season === undefined || count(status.season, 9999)) ||
      !(status.confirmedAt === null || typeof status.confirmedAt === 'string') ||
      !['configuredCount', 'resolvedCount', 'canonicalCount'].every(key => count(status[key])) ||
      !['unresolvedNames', 'duplicateNames', 'invalidAssignments'].every(key => strings(status[key])) ||
      !['isLoading', 'isError', 'isInitialized', 'isConfirmed', 'isMockReady'].every(key => typeof status[key] === 'boolean') ||
      !(status.error === null || typeof status.error === 'string')) return false;
  const draft = snapshot.draft;
  if (!draft) return false;
  const { teams, rounds } = draft.settings;
  const byId = new Map((value.players as Player[]).map(player => [player.id, player]));
  return value.keepers.every(keeper => isRecord(keeper) && typeof keeper.playerId === 'string' &&
    typeof keeper.playerName === 'string' && isPosition(keeper.position) && typeof keeper.isMyKeeper === 'boolean' &&
    count(keeper.teamIndex, teams - 1) && typeof keeper.round === 'number' && keeper.round >= 1 && count(keeper.round, rounds) &&
    keeper.pickNumber === getKeeperPickNumber({ teamIndex: keeper.teamIndex, round: keeper.round }, teams, draft.type) &&
    byId.get(keeper.playerId)?.position === keeper.position) &&
    new Set(value.keepers.map(keeper => (keeper as { playerId: string }).playerId)).size === value.keepers.length &&
    new Set(value.keepers.map(keeper => (keeper as { pickNumber: number }).pickNumber)).size === value.keepers.length;
}

export function createArchive(snapshot: DraftSyncSnapshot, data: DraftData, readiness: DraftReadinessReport,
  slot: number | undefined, warnings: readonly string[], now: number): SessionArchive {
  return { schemaVersion: 1, kind: 'fantasy-draft-session', capturedAt: new Date(now).toISOString(),
    session: `${snapshot.provider}:${snapshot.draftId}`, slot: slot ?? null, snapshot,
    data: { ...data, keeperStatus: { ...data.keeperStatus, error: data.keeperStatus.error?.message ?? null } },
    readiness, warnings };
}

export async function saveArchive(path: string, archive: SessionArchive, force: boolean): Promise<void> {
  if (Buffer.byteLength(JSON.stringify(archive, null, 2)) + 1 > MAX_ARCHIVE_BYTES) throw new CliError('EXPORT_TOO_LARGE', 'The session export exceeds the 20 MiB size limit.');
  await writePrivateJson(path, archive, force);
}

export async function readArchive(path: string): Promise<SessionArchive> {
  let value: unknown;
  try { value = await readBoundedJson(path, MAX_ARCHIVE_BYTES); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new CliError('REPLAY_NOT_FOUND', 'The session archive does not exist.', 2);
    throw new CliError('INVALID_ARCHIVE', 'The replay input must be a valid session archive within the 20 MiB size limit.', 2);
  }
  try {
    if (!isRecord(value) || value.schemaVersion !== 1 || value.kind !== 'fantasy-draft-session' ||
        typeof value.capturedAt !== 'string' || !Number.isFinite(Date.parse(value.capturedAt)) ||
        typeof value.session !== 'string' || !isDraftSyncSnapshot(value.snapshot) || !value.snapshot.draft ||
        parseSession(value.session).id !== `${value.snapshot.provider}:${value.snapshot.draftId}` ||
        value.snapshot.draft.provider !== value.snapshot.provider || value.snapshot.draft.draftId !== value.snapshot.draftId ||
        !(value.slot === null || typeof value.slot === 'number' && value.slot >= 1 && count(value.slot, value.snapshot.draft.settings.teams)) ||
        !validData(value.data, value.snapshot) || !validReadiness(value.readiness) || !strings(value.warnings)) throw new Error('Invalid archive');
    const snapshot = value.snapshot;
    const { teams } = value.snapshot.draft.settings;
    const totalPicks = teams * value.snapshot.draft.settings.rounds;
    if (snapshot.picks.some(pick => pick.draftId !== snapshot.draftId || pick.pickNumber > totalPicks ||
        pick.draftSlot > teams || pick.teamIndex >= teams) ||
        new Set(snapshot.picks.map(pick => pick.pickNumber)).size !== snapshot.picks.length ||
        new Set(snapshot.picks.map(pick => pick.playerId)).size !== snapshot.picks.length) throw new Error('Inconsistent picks');
    return value as unknown as SessionArchive;
  } catch { throw new CliError('INVALID_ARCHIVE', 'The session archive has invalid or inconsistent draft data.', 2); }
}

export function archivedData(archive: SessionArchive): DraftData {
  return { ...archive.data, keeperStatus: { ...archive.data.keeperStatus,
    error: archive.data.keeperStatus.error === null ? null : new Error(archive.data.keeperStatus.error) } };
}

export function replaySnapshot(archive: SessionArchive, pick?: number): DraftSyncSnapshot {
  if (pick === undefined) return archive.snapshot;
  const context = createSessionContext(archive.snapshot, archivedData(archive), archive.slot ?? undefined, Date.parse(archive.capturedAt));
  const draft = required(archive.snapshot.draft, 'archived draft');
  const currentPick = required(context.currentPick, 'archived current pick');
  if (!Number.isInteger(pick) || pick < 1 || pick > currentPick) {
    throw new CliError('REPLAY_PICK_OUT_OF_RANGE', `--pick must be between 1 and the captured current pick ${String(context.currentPick)}.`, 2);
  }
  return { ...archive.snapshot, picks: archive.snapshot.picks.filter(entry => entry.isKeeper || entry.pickNumber < pick),
    draft: { ...draft, status: draft.status === 'complete' && pick <= context.totalPicks
      ? 'drafting' : draft.status } };
}

export function replayBoundaries(archive: SessionArchive): readonly number[] {
  const context = createSessionContext(archive.snapshot, archivedData(archive), archive.slot ?? undefined, Date.parse(archive.capturedAt));
  const currentPick = required(context.currentPick, 'archived current pick');
  return [...new Set([1, ...archive.snapshot.picks.filter(pick => !pick.isKeeper).map(pick => pick.pickNumber + 1), currentPick])]
    .filter(pick => pick <= currentPick).sort((left, right) => left - right);
}
