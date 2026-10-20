import { baselineRuleIds } from './agent-lint-rules.mjs';

export function countBaseline(results, root) {
  const counts = {};
  for (const result of results) {
    const file = result.filePath.slice(root.length + 1).replaceAll('\\', '/');
    for (const message of result.messages) {
      if (!baselineRuleIds.includes(message.ruleId)) continue;
      counts[file] ??= {};
      counts[file][message.ruleId] = (counts[file][message.ruleId] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export function compareBaseline(actual, baseline, directories) {
  const failures = [];
  for (const file of new Set([...Object.keys(actual), ...Object.keys(baseline)])) {
    if (!directories.includes(file.split('/')[0])) continue;
    const saved = baseline[file];
    const current = actual[file] ?? {};
    for (const rule of new Set([...Object.keys(current), ...Object.keys(saved?.counts ?? {})])) {
      const count = current[rule] ?? 0;
      const allowed = saved?.counts[rule] ?? 0;
      if (count > allowed) {
        failures.push(`${file}: ${rule} rose from ${allowed} to ${count}. Fix the new violation; use a shared decoder or public package export as applicable.`);
      } else if (count < allowed) {
        failures.push(`${file}: ${rule} baseline is stale (${allowed} saved, ${count} found). Lower or remove this entry in eslint-baseline.json.`);
      }
    }
    if (saved && (!saved.reason?.trim() || Object.keys(saved.counts).length === 0 ||
        Object.entries(saved.counts).some(([rule, count]) => !baselineRuleIds.includes(rule) || !Number.isInteger(count) || count < 1))) {
      failures.push(`${file}: invalid baseline. Keep positive counts for known rules and document a reason, or remove the entry.`);
    }
  }
  return failures;
}
