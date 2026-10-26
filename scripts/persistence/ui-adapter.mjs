export const DEFAULTS = { suites: 3, seeds: 5, perActor: 300, pickConflicts: 20, moveConflicts: 100 };
export const TOMBSTONE_KEY = 'fantasy-draft-storage-migrated';
export const DATABASE = 'fantasy-draft-workspace-v2';
export const SCENARIOS = ['tabs', 'extension-granted', 'extension-no-permission', 'hostname-split'];
export const POSITIVE = ['tabs', 'extension-granted'];
export const NEGATIVE = ['extension-no-permission', 'hostname-split'];
export const TEAMS = 20;
export const ROUNDS = 20;

/** Browser-only HTTP fixture. Keep the input files unchanged and retain their real identities. */
export function buildCatalogFixture(input, identities, predictions) {
  const snapshot = structuredClone(input);
  const identityByRank = new Map();
  const canonical = new Set();
  const sleeper = new Set();
  for (const player of identities.players) {
    if (!player.canonicalId || !player.sleeperId || !player.fantasyProsId ||
        identityByRank.has(player.fantasyProsId) || canonical.has(player.canonicalId) || sleeper.has(player.sleeperId)) {
      throw new Error('Catalog fixture requires unique real canonical, Sleeper and FantasyPros identities');
    }
    identityByRank.set(player.fantasyProsId, player);
    canonical.add(player.canonicalId); sleeper.add(player.sleeperId);
  }
  const ranked = new Set(snapshot.rankings.map(row => row.fantasyProsId));
  if (ranked.size !== snapshot.rankings.length || [...ranked].some(id => !identityByRank.has(id))) throw new Error('Rankings have duplicate or unknown identities');
  const points = new Map(predictions.players.map(row => [row.playerId, row.baseProjectedPoints]));
  const ranksByPosition = new Map();
  for (const row of snapshot.rankings) ranksByPosition.set(row.position, Math.max(ranksByPosition.get(row.position) ?? 0, row.positionalRank));
  for (const player of identities.players) {
    if (ranked.has(player.fantasyProsId)) continue;
    const rank = snapshot.rankings.length + 1;
    const positionalRank = (ranksByPosition.get(player.position) ?? 0) + 1;
    ranksByPosition.set(player.position, positionalRank);
    const identity = { fantasyProsId: player.fantasyProsId, name: player.name, position: player.position, team: player.team };
    snapshot.rankings.push({ ...identity, rank, byeWeek: 0, positionalRank, bestRank: rank, worstRank: rank, avgRank: rank });
    snapshot.projections.push({ ...identity, projectedPoints: points.get(player.canonicalId) ?? 0 });
    ranked.add(player.fantasyProsId);
  }
  snapshot.metadata = { ...snapshot.metadata, source: 'Browser persistence proof fixture expanded from installed demo identities',
    sourceType: 'fixture', rankingCount: snapshot.rankings.length, projectionCount: snapshot.projections.length };
  return { snapshot, catalog: snapshot.rankings.map(row => ({ id: identityByRank.get(row.fantasyProsId).canonicalId,
    sleeperId: identityByRank.get(row.fantasyProsId).sleeperId, fantasyProsId: row.fantasyProsId,
    name: row.name, position: row.position, team: row.team })) };
}

/** P9 LCG, identical arithmetic to run.mjs / idb-adapter.mjs. */
export function lcg(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

/** Catalog rows come from the Provisional Pick dialog `<option>`s: `Name · POS TEAM · ECR #n`. */
export function parseCatalogOption({ value, label }) {
  const parts = label.split(' · ');
  const name = parts[0];
  const match = /^([A-Z]+)\s+(\S+)/.exec(parts[1] ?? '');
  return { id: value, name, position: match?.[1] ?? 'WR', team: match?.[2] ?? 'FA', label };
}

/** Distinct IDs and distinct display names only: queue buttons are located by their aria-label. */
export function selectCatalog(rows, need) {
  const nameCount = new Map();
  for (const row of rows) nameCount.set(row.name, (nameCount.get(row.name) ?? 0) + 1);
  const seen = new Set();
  const chosen = [];
  for (const row of rows) {
    if (!row.id || seen.has(row.id) || nameCount.get(row.name) !== 1 || /["\\]/.test(row.name)) continue;
    seen.add(row.id); chosen.push(row);
    if (chosen.length === need) return chosen;
  }
  throw new Error(`The real catalog offers ${chosen.length} distinct players; ${need} are required`);
}

export function slotInfo(slot) {
  const draftSlot = ((slot - 1) % TEAMS) + 1;
  return { slot, round: Math.ceil(slot / TEAMS), draftSlot, teamIndex: draftSlot - 1 };
}

/**
 * Per-session workload. Each actor alternates provisional picks and queue adds. Actors use disjoint
 * slots and disjoint catalog players, so every effect is independently observable after reload.
 */
export function planSession(catalog, perActor = DEFAULTS.perActor) {
  if (perActor % 2 !== 0) throw new Error('Commands per actor must be even');
  const half = perActor / 2;
  const need = perActor * 2;
  if (catalog.length < need) throw new Error(`Need ${need} catalog players`);
  const actors = [0, 1].map(actor => {
    const commands = [];
    for (let k = 0; k < perActor; k++) {
      const pick = k % 2 === 0;
      const index = pick ? actor * half + k / 2 : perActor + actor * half + (k - 1) / 2;
      const player = catalog[index];
      commands.push(pick
        ? { id: `${actor}:${k}`, actor, type: 'pick', slot: actor * half + k / 2 + 1, playerId: player.id, name: player.name }
        : { id: `${actor}:${k}`, actor, type: 'queueAdd', playerId: player.id, name: player.name });
    }
    return commands;
  });
  return { actors, picks: actors.flat().filter(c => c.type === 'pick'), queue: actors.flat().filter(c => c.type === 'queueAdd') };
}

export function assertPlan(plan) {
  const all = plan.actors.flat();
  const players = all.map(c => c.playerId);
  const names = all.map(c => c.name);
  const slots = plan.picks.map(c => c.slot);
  const problems = [];
  if (new Set(players).size !== players.length) problems.push('player IDs are not unique across all commands');
  if (new Set(names).size !== names.length) problems.push('display names are not unique');
  if (new Set(slots).size !== slots.length) problems.push('pick slots overlap');
  if (Math.max(...slots) > TEAMS * ROUNDS) problems.push('slot outside the 20x20 draft');
  return problems;
}

/** Deterministic draft IDs: 13 digits, unique per (scenario, purpose, index). Valid numeric Sleeper IDs. */
export function draftIds(scenarioIndex, count) {
  const base = 1_700_000_000_000 + scenarioIndex * 100_000;
  return Array.from({ length: count }, (_, i) => String(base + i + 1));
}

const canonicalPicks = picks => [...picks].map(p => [p.pickNumber, p.playerId]).sort((a, b) => a[0] - b[0]);

/**
 * Audit one session from DOM-observed actor results and the committed (IndexedDB) session read after
 * reload. `queueDom` holds the rendered queue order (as player IDs) per actor, before and after reload.
 */
export function auditSession({ issued, committed, committedBefore, queueDom, pickDom }) {
  const acknowledged = issued.filter(row => row.outcome === 'ack');
  const picks = acknowledged.filter(row => row.cmd.type === 'pick');
  const queued = acknowledged.filter(row => row.cmd.type === 'queueAdd');
  const slotPlayer = new Map(committed.picks.map(p => [p.pickNumber, p.playerId]));
  const missingPicks = picks.filter(row => slotPlayer.get(row.cmd.slot) !== row.cmd.playerId).map(row => row.cmd.id);
  const queueSet = new Set(committed.queue);
  const missingQueue = queued.filter(row => !queueSet.has(row.cmd.playerId)).map(row => row.cmd.id);
  const factKey = cmd => cmd.type === 'pick' ? `pick:${cmd.slot}:${cmd.playerId}` : cmd.type === 'queueAdd' ? `queue:${cmd.playerId}` : null;
  const acknowledgedFacts = new Set(acknowledged.map(row => factKey(row.cmd)));
  const unacknowledgedFacts = new Map(issued.filter(row => row.outcome !== 'ack').map(row => [factKey(row.cmd), row]));
  const unmatched = [
    ...committed.picks.map(p => `pick:${p.pickNumber}:${p.playerId}`),
    ...committed.queue.map(id => `queue:${id}`),
  ].filter(fact => !acknowledgedFacts.has(fact));
  const unacknowledgedCommitted = unmatched.filter(fact => unacknowledgedFacts.has(fact)).map(fact => {
    const row = unacknowledgedFacts.get(fact);
    return { fact, commandId: row.cmd.id, outcome: row.outcome };
  });
  const unexpected = unmatched.filter(fact => !unacknowledgedFacts.has(fact));
  const unique = new Set(committed.picks.map(p => p.playerId)).size === committed.picks.length &&
    new Set(committed.picks.map(p => p.pickNumber)).size === committed.picks.length &&
    new Set(committed.queue).size === committed.queue.length;
  const orderOf = list => JSON.stringify(list);
  const queueBeforeReloadEqual = queueDom.before.length === 2 && queueDom.before.every(order => orderOf(order) === orderOf(queueDom.before[0]));
  const queueAfterReloadEqual = queueDom.after.length === 2 && queueDom.after.every(order => orderOf(order) === orderOf(queueDom.after[0]));
  const queueMatchesCommitted = queueDom.after.every(order => orderOf(order) === orderOf(committed.queue));
  const queueStableAcrossReload = orderOf(queueDom.before[0]) === orderOf(queueDom.after[0]);
  const picksMatchDom = pickDom && ['before', 'after'].every(phase => pickDom[phase]?.length === 2 &&
    pickDom[phase].every(rows => JSON.stringify(canonicalPicks(rows)) === JSON.stringify(canonicalPicks(committed.picks))));
  const committedStableAcrossReload = Boolean(committedBefore?.present && committed.present &&
    JSON.stringify({ picks: canonicalPicks(committedBefore.picks), queue: committedBefore.queue }) ===
    JSON.stringify({ picks: canonicalPicks(committed.picks), queue: committed.queue }));
  return {
    committedStableAcrossReload, picksMatchDom: Boolean(picksMatchDom),
    commands: issued.length, acknowledged: acknowledged.length,
    rejected: issued.filter(row => row.outcome === 'rejected').length,
    errors: issued.filter(row => row.outcome === 'error' || row.outcome === 'blocked').length,
    kept: acknowledged.length - missingPicks.length - missingQueue.length,
    lost: missingPicks.length + missingQueue.length, missingPicks, missingQueue, unexpected, unacknowledgedCommitted, unique,
    queueBeforeReloadEqual, queueAfterReloadEqual, queueMatchesCommitted, queueStableAcrossReload,
    committedPicks: committed.picks.length, committedQueue: committed.queue.length,
    canonical: JSON.stringify({ picks: canonicalPicks(committed.picks), queue: committed.queue }),
  };
}

export function sessionPasses(checks, expectedCommands) {
  return checks.commands === expectedCommands && checks.acknowledged === expectedCommands && !checks.rejected && !checks.errors &&
    !checks.lost && !checks.unexpected.length && checks.unique && checks.queueBeforeReloadEqual && checks.queueAfterReloadEqual &&
    checks.queueMatchesCommitted && checks.queueStableAcrossReload && checks.committedStableAcrossReload && checks.picksMatchDom;
}

/** Exactly one durable acceptance, an explicit visible loser, and the committed slot holds the winner. */
export function auditPickConflict({ results, committed, slot, players }) {
  const winners = results.filter(r => r.outcome === 'ack');
  const losers = results.filter(r => r.outcome === 'rejected' && r.alert);
  const atSlot = committed.picks.filter(p => p.pickNumber === slot);
  const good = winners.length === 1 && losers.length === 1 && atSlot.length === 1 &&
    atSlot[0].playerId === winners[0].cmd.playerId && committed.picks.length === 1 &&
    !committed.picks.some(p => p.playerId === losers[0].cmd.playerId) && players.length === 2;
  return { acknowledged: winners.length, explicitLosers: losers.length, committedAtSlot: atSlot.length, committedPicks: committed.picks.length, good };
}

/**
 * Both tabs move the same queued player in opposite directions (+1 / -1 offsets). Applied to the latest
 * committed order, both durable moves compose to the original order. Anything else is a lost move.
 */
export function auditMoveConflict({ original, orders, committedAfterReload, renderedAfterReload, receipts = [], revisionBefore, revisionAfter }) {
  const sorted = [...original].sort().join('|');
  const final = committedAfterReload;
  const permutation = [...final].sort().join('|') === sorted;
  const converged = orders.length === 2 && orders.every(order => JSON.stringify(order) === JSON.stringify(orders[0])) &&
    JSON.stringify(orders[0]) === JSON.stringify(final);
  const reloadStable = renderedAfterReload.length === 2 && renderedAfterReload.every(order => JSON.stringify(order) === JSON.stringify(final));
  const lostMoves = JSON.stringify(final) === JSON.stringify(original) ? 0 : 1;
  const bothMovesCommitted = receipts.length === 2 && receipts.every(row => row.outcome === 'ack') &&
    Number.isSafeInteger(revisionBefore) && revisionAfter === revisionBefore + 2;
  return { permutation, converged, reloadStable, lostMoves, bothMovesCommitted, final,
    good: permutation && converged && reloadStable && lostMoves === 0 && bothMovesCommitted };
}

/** The reconcile burst keeps every acknowledged pick, either still provisional or confirmed by the provider. */
export function auditReconcileBurst({ issued, committed, provider = [], flippedAt }) {
  const slotPlayer = new Map(committed.picks.map(p => [p.pickNumber, p.playerId]));
  const acknowledged = issued.filter(row => row.outcome === 'ack');
  const missing = acknowledged.filter(row => slotPlayer.get(row.cmd.slot) !== row.cmd.playerId).map(row => row.cmd.id);
  const unique = new Set(committed.picks.map(p => p.playerId)).size === committed.picks.length &&
    new Set(committed.picks.map(p => p.pickNumber)).size === committed.picks.length;
  const confirmed = committed.picks.filter(p => p.source && p.source !== 'provisional').length;
  const providerRetained = provider.length > 0 && provider.every(p => committed.picks.some(row => row.pickNumber === p.pickNumber && row.playerId === p.playerId && row.source !== 'provisional'));
  const errors = issued.filter(row => ['error', 'rejected', 'skipped'].includes(row.outcome)).length;
  return { providerRetained, errors, acknowledged: acknowledged.length, missing, unique, confirmed, blockedAfterReconcile: issued.filter(r => r.outcome === 'blocked').length,
    good: acknowledged.length > 0 && flippedAt > 0 && !missing.length && unique && confirmed === provider.length && providerRetained && !errors };
}

export function auditBlocked({ before, after }) {
  const same = JSON.stringify(before.v1) === JSON.stringify(after.v1) && JSON.stringify(before.databases) === JSON.stringify(after.databases);
  return { visibleError: Boolean(after.errorText && after.errorText.trim().length > 0), draftRoomAbsent: after.draftRoomAbsent === true,
    unchanged: same, good: Boolean(after.errorText?.trim()) && after.draftRoomAbsent === true && same };
}

export function completeReceiptLedger(results) {
  const starts = results.commandStarts ?? [];
  const receipts = results.commandLog ?? [];
  const started = new Map(starts.map(row => [row.actionId, row]));
  const finished = new Map(receipts.map(row => [row.actionId, row]));
  if (!starts.length || starts.length !== receipts.length || started.size !== starts.length || finished.size !== receipts.length ||
      starts.some(row => !row.actionId || !finished.has(row.actionId) || JSON.stringify(finished.get(row.actionId).cmd) !== JSON.stringify(row.cmd))) return false;
  const observed = (results.scenarios ?? []).flatMap(scenario => [
    ...(scenario.runs ?? []).flatMap(run => run.issued ?? []), ...(scenario.control?.issued ?? []),
    ...(scenario.pickConflicts ?? []).flatMap(row => row.results ?? []),
    ...(scenario.moveConflicts ?? []).flatMap(row => row.receipts ?? []),
    ...(scenario.bursts?.reconcile?.issued ?? []), ...(scenario.bursts?.mock?.steps ?? []).map(step => step.receipt),
    ...(scenario.lifecycle ?? []).map(row => row.receipt),
  ]);
  return observed.every(row => row?.actionId && finished.has(row.actionId) &&
    JSON.stringify(row.cmd) === JSON.stringify(finished.get(row.actionId).cmd) && row.outcome === finished.get(row.actionId).outcome);
}
const distinctSamples = (rows, count) => rows?.length === count && new Set(rows.map(row => row.sample)).size === count &&
  rows.every(row => Number.isSafeInteger(row.sample) && row.sample >= 1 && row.sample <= count);

export function auditMockBurst(burst) {
  const steps = burst?.steps ?? [];
  const board = burst?.board ?? [];
  return { good: steps.length === 4 && steps.every(step => step.receipt?.outcome === 'ack' && board.some(label => label.includes(`, ${step.drafted},`))) &&
    board.length > steps.length && new Set(board.map(label => label.split(',')[0])).size === board.length &&
    burst.notSaved === false && Boolean(burst.v1Before && burst.v1After) && JSON.stringify(burst.v1Before) === JSON.stringify(burst.v1After) };
}

export function hasProductionProof(meta) {
  const env = meta.resolvedEnv;
  const build = meta.productionBuild;
  const http = meta.productionHttp;
  if (meta.serve !== 'production-static' || env?.MODE !== 'production' || env.DEV !== false || env.PROD !== true ||
      (env.VITE_STORAGE_ACTIVATION ?? 'idb') !== 'idb' || env.VITE_PERSISTENCE_HARNESS !== undefined || env.VITE_DEMO_MODE !== undefined ||
      JSON.stringify(build?.env) !== JSON.stringify(env) || !build?.noViteClientOrHmr || !build.files?.['index.html']) return false;
  const executable = Object.entries(build.files).filter(([file]) => /\.(?:html|m?js|css)$/.test(file));
  if (!executable.length || executable.some(([file, hash]) => !/^[a-f0-9]{64}$/.test(hash) || http?.verified?.[file] !== hash ||
      meta.sourceHashes?.[`web-app/dist/${file}`] !== hash || meta.sourceHashesEnd?.[`web-app/dist/${file}`] !== hash)) return false;
  return ['/@vite/client', '/@react-refresh', '/src/main.tsx', '/node_modules/vite/dist/client/client.mjs'].every(file => http?.rejected?.[file] === 404) &&
    /^[a-f0-9]{64}$/.test(meta.catalogFixture?.sha256 ?? '') && http?.catalogFixtureSha256 === meta.catalogFixture.sha256;
}

/** Gate over a saved results.json. A smoke run never passes. */
export function evaluateUiGate(results) {
  try { return evaluateUiGateEvidence(results); }
  catch (error) { return { passes: false, failures: [`Incomplete or malformed raw evidence: ${error.message}`], open: ['native hidden->visible re-read not proven on a headed browser'] }; }
}
function evaluateUiGateEvidence(results) {
  const failures = [];
  const meta = results.metadata ?? {};
  if (!meta.finished) failures.push('Run did not finish');
  if (!hasProductionProof(meta)) failures.push('Final gate requires hashed production build/HTTP bytes, no Vite runtime, and harness/demo mode unset');
  if (!meta.sourceHashes || !meta.sourceHashesEnd || JSON.stringify(meta.sourceHashes) !== JSON.stringify(meta.sourceHashesEnd)) failures.push('Source hash snapshots differ or are absent');
  if (!meta.sourceStable) failures.push('Load-bearing sources or extension build changed during run');
  if (!meta.git?.head || meta.git.head !== meta.expectedHead || !meta.git.clean || !meta.gitEnd || meta.gitEnd.head !== meta.git.head || meta.gitEnd.status) failures.push('Final gate requires the frozen committed head');
  if (!meta.catalogFixture?.schemaDecoded || meta.catalogFixture.identityCount !== 900) failures.push('Real 900-identity catalog fixture was not validated');
  if (results.cleanupErrors?.length) failures.push('Runner cleanup failed');
  if (meta.smoke) failures.push('Smoke runs cannot pass the gate');
  if ((meta.env?.VITE_STORAGE_ACTIVATION ?? 'idb') !== 'idb' || meta.env?.VITE_PERSISTENCE_HARNESS !== undefined || meta.env?.VITE_DEMO_MODE !== undefined) {
    failures.push('Build env is not switch ON with the harness unset and demo mode unset');
  }
  if (meta.suites !== DEFAULTS.suites || meta.seeds !== DEFAULTS.seeds || meta.commandsPerActor !== DEFAULTS.perActor) failures.push('Requires 3 suites, 5 seeds, 300 commands per actor');
  if (results.pageErrors?.length) failures.push(`${results.pageErrors.length} page errors`);
  if (results.scenarioErrors?.length) failures.push(`${results.scenarioErrors.length} scenario errors`);
  if (results.fatal) failures.push('Fatal runner error');
  if (results.productionNavigationDefect) failures.push('STOP product defect: unprompted production document navigation');
  const labels = (results.scenarios ?? []).map(s => s.label).sort();
  if (JSON.stringify(labels) !== JSON.stringify([...SCENARIOS].sort())) failures.push('Requires all four scenarios');
  for (const scenario of results.scenarios ?? []) {
    const tag = scenario.label;
    if (POSITIVE.includes(tag)) {
      if (!scenario.activation?.completed || !scenario.activation.readOnlyBeforeConfirm || !scenario.activation.tombstoneAfter ||
          !scenario.activation.secondTabNoPrompt || !scenario.activation.buttonDisabledBeforeCheckbox || !scenario.activation.v1RetainedByteIdentical || !scenario.activation.importedAll || scenario.activation.tombstoneBefore) failures.push(`${tag}: activation prompt flow incomplete`);
      if (scenario.runs?.length !== 15 || scenario.runs.some(run => run.issued.length !== 2 * meta.commandsPerActor)) failures.push(`${tag}: incomplete 9,000-command schedule`);
      if (new Set((scenario.runs ?? []).map(run => `${run.suite}:${run.seed}`)).size !== 15 || scenario.runs?.some(run => run.suite < 1 || run.suite > 3 || run.seed < 1 || run.seed > 5)) failures.push(`${tag}: invalid suite/seed schedule`);
      for (const run of scenario.runs ?? []) if (!sessionPasses(auditSession(run), 2 * meta.commandsPerActor) || run.notSavedVisible?.some(Boolean)) failures.push(`${tag}: suite ${run.suite} seed ${run.seed} failed`);
      if (!scenario.control || !sessionPasses(auditSession(scenario.control), 2 * meta.commandsPerActor)) failures.push(`${tag}: sequential control failed`);
      if (!distinctSamples(scenario.pickConflicts, DEFAULTS.pickConflicts) || scenario.pickConflicts.some(c => !auditPickConflict(c).good)) failures.push(`${tag}: pick conflicts incomplete or failed`);
      if (!distinctSamples(scenario.moveConflicts, DEFAULTS.moveConflicts) || scenario.moveConflicts.some(c => !auditMoveConflict(c).good)) failures.push(`${tag}: moves incomplete or lost (need 0/100)`);
      if (!scenario.v1AtActivation || !scenario.v1FinalSnapshot || JSON.stringify(scenario.v1AtActivation.filter(([k]) => k.startsWith('fantasy-draft-session'))) !== JSON.stringify(scenario.v1FinalSnapshot.filter(([k]) => k.startsWith('fantasy-draft-session')))) failures.push(`${tag}: v1 bytes changed after activation`);
      if (!scenario.bursts?.reconcile || !auditReconcileBurst(scenario.bursts.reconcile).good) failures.push(`${tag}: reconcile-during-picks burst failed`);
      if (tag === 'tabs' && !auditMockBurst(scenario.bursts?.mock).good) failures.push(`${tag}: mock auto-advance + user pick burst failed`);
      if (tag === 'extension-granted') {
        if (!scenario.panel?.openedLocalWorkspace || !scenario.panel.reloadRecovered || scenario.panel.actorWrites !== 2 * meta.commandsPerActor * 15 / 2) failures.push(`${tag}: panel did not write its half through the real UI`);
      }
    } else if (NEGATIVE.includes(tag)) {
      if (!scenario.blocked || !auditBlocked(scenario.blocked).good) failures.push(`${tag}: blocked-write proof failed`);
    }
  }
  if (!completeReceiptLedger(results)) failures.push('Per-command receipt ledger is incomplete');
  const open = [];
  const lifecycle = (results.scenarios ?? []).find(s => s.label === 'tabs')?.lifecycle;
  if (!lifecycle?.length || lifecycle.some(row => !row.nativeVisibility?.proven)) open.push('native hidden->visible re-read not proven on a headed browser');
  return { passes: failures.length === 0, failures, open };
}

/** Amendment 9 Tier 2. Recompute scores from raw receipts and observations. */
export function evaluateTier2(results) {
  const failures = [];
  try {
    const meta = results.metadata;
    if (!meta.finished || !meta.sourceStable || !meta.sourceHashes || !meta.sourceHashesEnd || JSON.stringify(meta.sourceHashes) !== JSON.stringify(meta.sourceHashesEnd)) failures.push('Sources changed or run unfinished');
    if ((meta.env?.VITE_STORAGE_ACTIVATION ?? 'idb') !== 'idb' || meta.env?.VITE_PERSISTENCE_HARNESS !== undefined || meta.env?.VITE_DEMO_MODE !== undefined || !meta.catalogFixture?.schemaDecoded || meta.catalogFixture.identityCount !== 900) failures.push('Wrong environment or unvalidated catalog');
    if (meta.suites !== 1 || meta.seeds !== 1 || meta.commandsPerActor !== 300) failures.push('Wrong Tier 2 workload size');
    if (results.fatal || results.pageErrors.length || results.scenarioErrors.length || results.cleanupErrors.length) failures.push('Runner, page, scenario or cleanup error');
    if (JSON.stringify(results.scenarios.map(row => row.label).sort()) !== JSON.stringify([...SCENARIOS].sort())) failures.push('Requires all four affected scenarios');
    for (const scenario of results.scenarios) {
      const tag = scenario.label;
      if (POSITIVE.includes(tag)) {
        const activation = scenario.activation;
        if (!activation?.completed || !activation.readOnlyBeforeConfirm || !activation.secondTabNoPrompt || !activation.v1RetainedByteIdentical || !activation.buttonDisabledBeforeCheckbox || activation.tombstoneBefore) failures.push(`${tag}: activation incomplete`);
        if (scenario.runs.length !== 1 || !sessionPasses(auditSession(scenario.runs[0]), 600) || scenario.runs[0].notSavedVisible.some(Boolean)) failures.push(`${tag}: 600-command DOM workload failed`);
        if (!distinctSamples(scenario.pickConflicts, 20) || scenario.pickConflicts.some(row => !auditPickConflict(row).good)) failures.push(`${tag}: pick conflicts incomplete or failed`);
        if (!distinctSamples(scenario.moveConflicts, 20) || scenario.moveConflicts.some(row => !auditMoveConflict(row).good)) failures.push(`${tag}: moves incomplete or failed`);
        if (!scenario.bursts.reconcile || !auditReconcileBurst(scenario.bursts.reconcile).good) failures.push(`${tag}: reconcile burst failed`);
        if (tag === 'tabs' && !auditMockBurst(scenario.bursts.mock).good) failures.push(`${tag}: mock burst failed`);
        if (!scenario.v1AtActivation || !scenario.v1FinalSnapshot || JSON.stringify(scenario.v1AtActivation.filter(([k]) => k.startsWith('fantasy-draft-session'))) !== JSON.stringify(scenario.v1FinalSnapshot.filter(([k]) => k.startsWith('fantasy-draft-session')))) failures.push(`${tag}: v1 changed`);
        if (tag === 'extension-granted' && (!scenario.panel?.openedLocalWorkspace || !scenario.panel.reloadRecovered || scenario.panel.actorWrites !== 300)) failures.push(`${tag}: actual panel writer incomplete`);
      } else if (!auditBlocked(scenario.blocked).good) failures.push(`${tag}: negative scenario failed`);
    }
    if (!completeReceiptLedger(results)) failures.push('Incomplete per-command receipt ledger');
  } catch (error) { failures.push(`Incomplete raw evidence: ${error.message}`); }
  return { passes: !failures.length, failures, open: ['native hidden->visible re-read remains open unless separately proven'] };
}
