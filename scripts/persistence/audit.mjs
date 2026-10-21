export function audit(issued, snapshots, beforeReload = []) {
  const acknowledged = issued.filter(row => row.receipt.accepted);
  const present = (snapshot, cmd) => cmd.type === 'pick'
    ? snapshot.picks.some(pick => pick.pickNumber === cmd.slot && pick.playerId === cmd.player)
    : snapshot.shortlist.includes(cmd.player);
  const missing = snapshots.map(snapshot => acknowledged.filter(row => !present(snapshot, row.cmd)).map(row => row.cmd.id));
  const unionMissing = acknowledged.filter(row => !snapshots.some(snapshot => present(snapshot, row.cmd))).map(row => row.cmd.id);
  const canonical = snapshot => JSON.stringify({ picks: snapshot.picks.map(pick => [pick.pickNumber, pick.playerId]).sort((a, b) => a[0] - b[0]),
    shortlist: snapshot.shortlist });
  const beforeMissing = beforeReload.length ? acknowledged.filter(row => !present(beforeReload[0], row.cmd)).map(row => row.cmd.id) : null;
  return { beforeMissing, commands: issued.length, acknowledged: acknowledged.length, rejected: issued.length - acknowledged.length,
    kept: acknowledged.length - missing[0].length, lost: missing[0].length, missing, unionMissing,
    keptByTarget: missing.map(rows => acknowledged.length - rows.length),
    converged: canonical(snapshots[0]) === canonical(snapshots[1]),
    unique: snapshots.every(snapshot => new Set(snapshot.picks.map(pick => pick.playerId)).size === snapshot.picks.length &&
      new Set(snapshot.picks.map(pick => pick.pickNumber)).size === snapshot.picks.length &&
      new Set(snapshot.shortlist).size === snapshot.shortlist.length),
    errors: [...beforeReload, ...snapshots].reduce((sum, snapshot) => sum + snapshot.errors.length, 0) };
}

export function summarize(scenarios) {
  return scenarios.map(scenario => scenario.runs.reduce((row, run) => ({ ...row,
    commands: row.commands + run.checks.commands, acknowledged: row.acknowledged + run.checks.acknowledged,
    rejected: row.rejected + run.checks.rejected, kept: row.kept + run.checks.kept, lost: row.lost + run.checks.lost,
    absentFromBoth: row.absentFromBoth + run.checks.unionMissing.length,
    errors: row.errors + run.checks.errors, nonconverged: row.nonconverged + Number(!run.checks.converged),
    invariantFailures: row.invariantFailures + Number(!run.checks.unique),
  }), { scenario: scenario.label, commands: 0, acknowledged: 0, rejected: 0, kept: 0, lost: 0,
    absentFromBoth: 0, errors: 0, nonconverged: 0, invariantFailures: 0,
    sequentialFailures: scenario.sequentialControl ? Number(!successful(scenario.sequentialControl.checks)) : 0,
    conflictFailures: (scenario.conflicts || []).filter(row => !row.checks.good).length,
    conflictAcknowledged: (scenario.conflicts || []).reduce((sum, row) => sum + row.checks.acknowledged, 0),
    conflictLostPicks: (scenario.conflicts || []).filter(row => row.kind === 'pick').reduce((sum, row) => sum + row.checks.lost, 0),
  }));
}

function successful(checks) {
  return !checks.lost && !checks.rejected && !checks.errors && checks.converged && checks.unique;
}

export function auditConflict(kind, issued, snapshots, beforeReload = []) {
  const acknowledged = issued.filter(row => row.receipt.accepted);
  if (kind === 'pick') {
    const checks = audit(issued, snapshots, beforeReload);
    return { ...checks, good: acknowledged.length === 1 && !checks.lost && !checks.errors && checks.converged && checks.unique };
  }
  const queue = snapshots[0].shortlist;
  const converged = snapshots.every(snapshot => JSON.stringify(snapshot.shortlist) === JSON.stringify(queue));
  const permutation = [...queue].sort().join('|') === 'p0|p1|p2|p3';
  const acceptedDestination = acknowledged.some(row => queue[row.cmd.toIndex] === row.cmd.player);
  const errors = [...beforeReload, ...snapshots].reduce((sum, snapshot) => sum + snapshot.errors.length, 0);
  return { acknowledged: acknowledged.length, converged, permutation, acceptedDestination, errors,
    good: acknowledged.length > 0 && converged && permutation && acceptedDestination && !errors };
}

export function failsGate(results) {
  return Boolean(results.fatal || results.pageErrors.length || (results.scenarioErrors || []).length ||
    results.summary.some(row => row.lost || row.rejected || row.errors || row.nonconverged || row.invariantFailures ||
      row.sequentialFailures || row.conflictFailures ||
      ['extension-no-permission', 'hostname-split'].includes(row.scenario) && row.acknowledged > 0));
}
