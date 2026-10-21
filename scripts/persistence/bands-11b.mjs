import { audit, auditConflict } from './audit.mjs';

const baselines = {
  tabs: { lost: 3893, commands: 9000, worst: 270 },
  'extension-granted': { lost: 3589, commands: 9000, worst: 264 },
};
const labels = [...Object.keys(baselines), 'extension-no-permission', 'hostname-split'];
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function auditConflict11b(kind, issued, snapshots, settled, shared = true) {
  const checks = auditConflict(kind, issued, snapshots, settled);
  if (!shared) {
    const partitions = snapshots.map((snapshot, actor) => auditConflict(kind, [issued[actor]],
      [snapshot, snapshot], [settled[actor]]));
    return { ...checks, good: partitions.every(row => row.good) &&
      snapshots.every((snapshot, actor) => same(snapshot, settled[actor])) };
  }
  const good = kind === 'pick'
    ? checks.acknowledged >= 1 && checks.acknowledged <= 2 && checks.kept >= 1 &&
      checks.converged && checks.unique && !checks.errors
    : checks.good && auditConflict(kind, issued, settled).good &&
      settled.every(snapshot => same(snapshot.shortlist, snapshots[0].shortlist));
  return { ...checks, good };
}

export function check11bBands(results) {
  const failures = [];
  const comparisons = [];
  const require = (condition, message) => { if (!condition) failures.push(message); };
  require(Boolean(results.metadata?.finished) && !results.fatal, 'Matrix must finish without a fatal error');
  require(results.pageErrors?.length === 0 && results.scenarioErrors?.length === 0, 'No page or scenario errors');
  require(results.metadata?.suites === 3 && results.metadata?.seeds === 5 &&
    results.metadata?.commandsPerActor === 300, '11b requires three suites, five seeds, and 300 commands per actor');
  require(same(results.scenarios?.map(row => row.label).sort(), [...labels].sort()), '11b requires all four scenarios exactly once');

  for (const scenario of results.scenarios || []) {
    const prefix = scenario.label;
    const baseline = baselines[prefix];
    const shared = Boolean(baseline);
    require(scenario.peerMarker === (shared ? 'tab' : null), `${prefix}: storage-sharing marker`);
    require(scenario.runs.length === 15 && new Set(scenario.runs.map(run => `${run.suite}:${run.seed}`)).size === 15 &&
      scenario.runs.every(run => run.suite >= 1 && run.suite <= 3 && run.seed >= 1 && run.seed <= 5 &&
        Number.isInteger(run.suite) && Number.isInteger(run.seed)), `${prefix}: complete suite/seed schedule`);
    let lost = 0;
    let worst = 0;
    for (const run of scenario.runs) {
      const name = `${prefix} ${run.suite}/${run.seed}`;
      const checks = checkEffects(run, name, shared, false);
      lost += checks.lost;
      worst = Math.max(worst, checks.lost);
      require(same(checks.beforeMissing, checks.missing[0]), `${name}: no new reload loss`);
    }
    if (baseline) {
      const deltaPercentagePoints = (lost - baseline.lost) / baseline.commands * 100;
      comparisons.push({ scenario: prefix, lost, commands: baseline.commands, baselineLost: baseline.lost,
        deltaPercentagePoints, worst, maxWorst: baseline.worst + 30 });
      require(Math.abs(lost - baseline.lost) <= 450, `${prefix}: aggregate loss outside +/-5 percentage points`);
      require(worst <= baseline.worst + 30, `${prefix}: per-run loss exceeds baseline worst +30`);
    }
    if (!scenario.sequentialControl) require(false, `${prefix}: missing sequential control`);
    else checkEffects(scenario.sequentialControl, `${prefix} sequential`, shared, true);

    for (const kind of ['pick', 'move']) {
      const samples = (scenario.conflicts || []).filter(row => row.kind === kind);
      require(samples.length === 20 && new Set(samples.map(row => row.sample)).size === 20 &&
        samples.every(row => Number.isInteger(row.sample) && row.sample >= 1 && row.sample <= 20),
      `${prefix}: requires 20 distinct ${kind} samples`);
      for (const sample of samples) {
        const name = `${prefix} ${kind} ${sample.sample}`;
        require(sample.issued.length === 2 && sample.settled.length === 2 && sample.afterReload.length === 2,
          `${name}: two actors and snapshots`);
        checkStorage(sample, 'settled', 'stored', name, shared);
        checkStorage(sample, 'afterReload', 'afterStored', name, shared);
        require(auditConflict11b(kind, sample.issued, sample.afterReload, sample.settled, shared).good,
          `${name}: conflict invariant`);
      }
    }
    require((scenario.conflicts || []).length === 40, `${prefix}: only pick and move conflict samples`);
  }
  return { passes: failures.length === 0, failures, comparisons };

  function checkEffects(run, name, shared, sequential) {
    const checks = audit(run.issued, run.afterReload, run.beforeReload);
    require(checks.commands === 600 && checks.acknowledged === 600 && !checks.rejected &&
      !checks.errors && checks.unique, `${name}: 600 acknowledgements, no errors or duplicates`);
    require(run.beforeReload.length === 2 && run.afterReload.length === 2, `${name}: two snapshots before and after reload`);
    checkStorage(run, 'beforeReload', 'stored', name, shared);
    checkStorage(run, 'afterReload', 'afterStored', name, shared);
    if (shared) {
      require(checks.converged, `${name}: common settled session`);
      if (sequential) require(checks.lost === 0, `${name}: must retain 600/600`);
    } else {
      require(!checks.converged && checks.unionMissing.length === 0 && same(checks.keptByTarget, [300, 300]),
        `${name}: separate partitions must retain 300 each and 600 in union`);
      for (let actor = 0; actor < 2; actor++) {
        const own = audit(run.issued.slice(actor * 300, (actor + 1) * 300),
          [run.afterReload[actor], run.afterReload[actor]]);
        require(own.acknowledged === 300 && own.lost === 0, `${name}: actor ${actor} retains its own commands`);
      }
    }
    return checks;
  }

  function checkStorage(run, snapshotsKey, storageKey, name, shared) {
    const snapshots = run[snapshotsKey];
    const stored = run[storageKey];
    require(stored?.length === 2, `${name}: retained ${storageKey}`);
    if (!stored || stored.length !== 2) return;
    for (let actor = 0; actor < 2; actor++) {
      const state = snapshots[actor];
      const record = stored[actor];
      const head = record.head;
      require(Boolean(head) && same(state.picks, head.draftHistory) && same(state.shortlist, head.shortlistedPlayerIds),
        `${name}: ${snapshotsKey} matches stored state for actor ${actor}`);
      require(typeof record.rawHead === 'string' && same(JSON.parse(record.rawHead), head) &&
        record.journals.every(row => typeof row.rawValue === 'string' && same(JSON.parse(row.rawValue), row.value)),
      `${name}: original storage bytes for actor ${actor}`);
      require(state.mode === 'live' && same(state.identity, run.capabilities?.[actor]?.initial.identity) &&
        same(state.identity, head?.identity), `${name}: live session identity for actor ${actor}`);
    }
    require(same(stored[0].head, stored[1].head) === shared, `${name}: ${shared ? 'common' : 'distinct'} stored sessions`);
  }
}
