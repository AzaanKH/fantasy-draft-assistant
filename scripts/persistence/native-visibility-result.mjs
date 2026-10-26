export function nativeVisibilityExitCode(result) {
  const complete = ['tab-switch', 'minimize-restore'].every(path => {
    const trials = result.trials.filter(trial => trial.path === path);
    return trials.length === 5 && trials.every(trial => trial.passes);
  });
  return result.error || result.verdict !== 'PROVEN' || !complete || result.trials.length !== 10 ||
    result.pageErrors.length || result.cleanup.some(row => typeof row === 'object' && row !== null && 'error' in row) ? 1 : 0;
}
